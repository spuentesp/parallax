// POST /api/query — pregunta de arquitectura respondida por el investigador
// Nemotron (G3). Usa el LAIN del workspace (como el assessment worker), no el
// adapter global: el investigador sólo es creíble sobre la vista real del
// workspace. Sin modelo configurado, el análisis estructural sigue disponible
// y explanation_status hace el fallo visible (P08).

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { investigate, serializeExplanation } from '../agent/investigator.js';
import { type MapFocus, mapFocusFromClaims } from '../agent/map-focus.js';
import { investigatorModel } from '../agent/model.js';
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
      cutShort: z.boolean(),
    })
    .nullable(),
  tool_calls: z.array(z.unknown()),
  model: z.string().nullable(),
  // Afirmaciones tipadas con el veredicto del motor. Una contradicha no cambia
  // explanation_status: se señala aquí y en el resumen.
  claims: z.array(z.unknown()),
  // A dónde llevar al usuario en el mapa: sólo lo que un recibo del motor respalda.
  map_focus: z
    .object({
      seed: z.string(),
      ids: z.array(z.string()),
      relations: z.array(
        z.object({
          consumer: z.string(),
          provider: z.string(),
          polarity: z.enum(['present', 'absent']),
          uses: z.number(),
          endpoints: z.array(z.string()),
          complete: z.boolean(),
        }),
      ),
      query: z.string(),
    })
    .nullable(),
  claims_summary: z.object({
    total: z.number(),
    verified: z.number(),
    contradicted: z.number(),
    unverifiable: z.number(),
    supported: z.number(),
    unsupported: z.number(),
  }),
});

const NO_CLAIMS = {
  total: 0,
  verified: 0,
  contradicted: 0,
  unverifiable: 0,
  supported: 0,
  unsupported: 0,
};

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

      const model = investigatorModel(app.config);
      if (!model) {
        // Fallo visible, no un silencio: la explicación no existe y el motivo
        // queda en el estado (INV: nunca fingir que el modelo explicó).
        return {
          answer:
            'Nemotron no está configurado (NEBIUS_TOKEN): no hay explicación del modelo. El análisis estructural del workspace sigue disponible en topology.',
          explanation_status: 'failed:no_model_configured',
          topology,
          evidence: [],
          citations: { accepted: [], rejected: [] },
          budget: null,
          tool_calls: [],
          model: null,
          claims: [],
          claims_summary: NO_CLAIMS,
          map_focus: null,
        };
      }

      const result = await investigate({
        question,
        lain,
        model: model.provider,
        view: 'live',
        budget: model.budget,
        endpointLabel: model.settings.baseUrl,
      });

      // El foco sólo puede nombrar nodos que el MAPA tiene: se valida contra el
      // mismo grafo cacheado que sirve /map/view. Un workspace sin LAIN propio
      // (el investigador usó el adapter por defecto) o con el LAIN caído no
      // tiene mapa al que apuntar.
      const mapGraph = await app.orgGraphs.load(orgId, false);
      const focus: MapFocus | null = mapGraph.ok
        ? mapFocusFromClaims(result.claims, new Set(mapGraph.graph.nodes.map((n) => n.id)))
        : null;

      // Serialización INV 2: la prosa del modelo no toca datos del motor; el
      // payload queda listo para auditoría (modelo, endpoint, prompt_version).
      const payload = serializeExplanation(result, {
        question,
        endpointLabel: model.settings.baseUrl,
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
          cutShort: result.budget.cutShort,
        },
        tool_calls: result.toolCallLog,
        model: result.effectiveModel,
        claims: result.claims,
        claims_summary: result.claimsSummary,
        map_focus: focus,
      };
    },
  );
};
