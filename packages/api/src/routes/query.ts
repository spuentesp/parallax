// POST /api/query — pregunta de arquitectura respondida por el investigador
// Nemotron (G3). Usa el LAIN del workspace (como el assessment worker), no el
// adapter global: el investigador sólo es creíble sobre la vista real del
// workspace. Sin modelo configurado, el análisis estructural sigue disponible
// y explanation_status hace el fallo visible (P08).

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { investigate, serializeExplanation } from '../agent/investigator.js';
import { NemotronProvider } from '../agent/nemotron.js';
import { investigatorSettings } from '../config.js';
import { createWorkspaceLainResolver } from '../lain-adapter/workspace.js';
import { buildEndpointTopology, type TopologyViewData } from '../topology.js';

const QueryRequest = z.object({
  question: z.string().min(1),
  orgId: z.string().min(1),
});

const QueryResponse = z.object({
  answer: z.string(),
  explanation_status: z.string(),
  topology: z.object({
    nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string() })),
    edges: z.array(
      z.object({
        source: z.string(),
        target: z.string(),
        label: z.string().optional(),
        kind: z.string(),
      }),
    ),
  }),
  evidence: z.array(z.unknown()),
  citations: z.object({
    accepted: z.array(z.string()),
    rejected: z.array(z.object({ ref: z.string(), reason: z.string() })),
  }),
  budget: z
    .object({
      maxToolCalls: z.number(),
      maxModelMs: z.number(),
      toolCallsUsed: z.number(),
      modelMsUsed: z.number(),
      exhausted: z.boolean(),
    })
    .nullable(),
  tool_calls: z.array(z.unknown()),
  model: z.string().nullable(),
});

const EMPTY_TOPOLOGY: TopologyViewData = { nodes: [], edges: [] };

export const queryRoutes: FastifyPluginAsync = async (app) => {
  const resolveWorkspaceLain = createWorkspaceLainResolver({
    db: app.db,
    defaultAdapter: app.lain,
  });

  app.post(
    '/api/query',
    {
      config: { scopes: ['read'] },
      schema: { body: QueryRequest, response: { 200: QueryResponse } },
    },
    async (req) => {
      const { question, orgId } = req.body as z.infer<typeof QueryRequest>;
      const lain = (await resolveWorkspaceLain(orgId)) ?? app.lain;

      // Análisis estructural SIEMPRE, con o sin modelo (P08): la topología
      // no depende de Nemotron.
      let topology: TopologyViewData = EMPTY_TOPOLOGY;
      try {
        topology = await buildEndpointTopology(lain);
      } catch {
        // Un LAIN caído no impide responder con explanation_status de fallo.
      }

      const token = app.config.nemotronToken;
      if (!token) {
        // Fallo visible, no un silencio: la explicación no existe y el motivo
        // queda en el estado (INV: nunca fingir que el modelo explicó).
        return {
          answer:
            'Nemotron no está configurado (NEMOTRON_TOKEN/NEBIUS_TOKEN): no hay explicación del modelo. El análisis estructural del workspace sigue disponible en topology.',
          explanation_status: 'failed:no_model_configured',
          topology,
          evidence: [],
          citations: { accepted: [], rejected: [] },
          budget: null,
          tool_calls: [],
          model: null,
        };
      }

      const settings = investigatorSettings(app.config);
      const nemotron = new NemotronProvider({
        baseUrl: settings.baseUrl,
        apiKey: token,
        plannerModel: settings.plannerModel,
        workerModel: settings.workerModel,
        timeoutMs: Math.min(60_000, settings.maxModelMs),
      });

      const result = await investigate({
        question,
        lain,
        model: nemotron,
        view: 'live',
        budget: {
          maxToolCalls: settings.maxToolCalls,
          maxModelMs: settings.maxModelMs,
        },
        endpointLabel: settings.baseUrl,
      });

      // Serialización INV 2: la prosa del modelo no toca datos del motor; el
      // payload queda listo para auditoría (modelo, endpoint, prompt_version).
      const payload = serializeExplanation(result, {
        question,
        endpointLabel: settings.baseUrl,
      });
      req.log.info(
        {
          explanation_status: result.explanationStatus,
          model: result.effectiveModel,
          tool_calls: result.toolCallLog.length,
          citations_accepted: result.citations.accepted.length,
          citations_rejected: result.citations.rejected.length,
          prompt_version: payload.prompt_version,
        },
        'investigator finished',
      );

      return {
        answer: result.answer ?? '',
        explanation_status: result.explanationStatus,
        topology,
        evidence: result.citations.accepted,
        citations: result.citations,
        budget: {
          maxToolCalls: result.budget.maxToolCalls,
          maxModelMs: result.budget.maxModelMs,
          toolCallsUsed: result.budget.toolCallsUsed,
          modelMsUsed: result.budget.modelMsUsed,
          exhausted: result.budget.exhausted,
        },
        tool_calls: result.toolCallLog,
        model: result.effectiveModel,
      };
    },
  );
};
