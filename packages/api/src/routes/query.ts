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
import { buildHistory } from '../conversation/history.js';
import {
  ConversationFullError,
  createConversationStore,
  MAX_TURNS_PER_CONVERSATION,
  ownerOf,
} from '../conversation/store.js';
import { createWorkspaceLainResolver } from '../lain-adapter/workspace.js';
import { createWindowLimiter } from '../rate-limit.js';
import { buildEndpointTopology, type TopologyViewData } from '../topology.js';

const QueryRequest = z.object({
  question: z.string().min(1),
  orgId: z.string().min(1),
  /** Continúa esa conversación (debe ser del mismo token y workspace); sin ella, abre una nueva. */
  conversationId: z.string().min(1).optional(),
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
      rounds: z.number().optional(),
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
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
  // La conversación a la que pertenece este turno (null si no se guardó).
  conversation: z.object({ id: z.string(), seq: z.number() }).nullable(),
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
  const perHour = app.config.queryRateLimitPerHour ?? 0;
  const limiter = perHour > 0 ? createWindowLimiter({ limit: perHour, windowMs: 3_600_000 }) : null;
  const conversations = createConversationStore(app.db);
  const resolveWorkspaceLain = createWorkspaceLainResolver({
    db: app.db,
    defaultAdapter: app.lain,
  });

  app.post(
    '/api/query',
    {
      config: { scopes: ['read'] },
      schema: {
        body: QueryRequest,
        response: {
          200: QueryResponse,
          404: z.object({ code: z.string(), detail: z.string() }),
          409: z.object({ code: z.string(), detail: z.string() }),
          429: z.object({
            type: z.string(),
            title: z.string(),
            status: z.number(),
            detail: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const taken = limiter?.take(req.authToken?.token ?? 'anonymous');
      if (taken && !taken.ok) {
        const minutes = Math.ceil(taken.retryAfterMs / 60_000);
        return reply
          .code(429)
          .header('retry-after', String(Math.ceil(taken.retryAfterMs / 1000)))
          .send({
            type: 'about:blank',
            title: 'Too Many Requests',
            status: 429,
            detail: `Question limit reached for this access token (${perHour} per hour). Try again in about ${minutes} min.`,
          });
      }
      const { question, orgId, conversationId } = req.body as z.infer<typeof QueryRequest>;
      const owner = ownerOf(req.authToken?.token ?? 'anonymous');

      // Una conversación ajena (o de otro workspace) no existe para quien pregunta.
      const prior = conversationId ? await conversations.get(owner, conversationId, orgId) : null;
      if (conversationId && !prior) {
        return reply.code(404).send({ code: 'NotFound', detail: 'conversation not found' });
      }
      if (prior && prior.turns.length >= MAX_TURNS_PER_CONVERSATION) {
        return reply.code(409).send({
          code: 'ConversationFull',
          detail: `this conversation reached ${MAX_TURNS_PER_CONVERSATION} turns: start a new one`,
        });
      }
      const history = prior ? buildHistory(prior.turns) : undefined;
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
          conversation: null,
        };
      }

      const result = await investigate({
        nudgeSubmit: true,
        ...(history ? { history } : {}),
        question,
        lain,
        model: model.provider,
        view: 'live',
        budget: model.budget,
        maxTokens: model.settings.maxTokens,
        ...(model.settings.thinking !== undefined ? { thinking: model.settings.thinking } : {}),
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

      // El turno se guarda con lo que el motor dijo de cada afirmación: es lo que
      // alimenta el libro de hechos del siguiente.
      let saved: { id: string; seq: number } | null = null;
      try {
        const conv = prior?.conversation ?? (await conversations.start(owner, orgId, question));
        const seq = await conversations.append(conv.id, {
          question,
          answer: result.answer ?? '',
          status: result.explanationStatus,
          claims: result.claims,
          focus,
          model: result.effectiveModel,
        });
        saved = { id: conv.id, seq };
      } catch (e) {
        // La respuesta ya se calculó: no se pierde por no poder guardarla.
        if (!(e instanceof ConversationFullError)) req.log.warn({ err: e }, 'turn not saved');
      }

      return {
        conversation: saved,
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
          rounds: result.budget.rounds,
          promptTokens: result.budget.promptTokens,
          completionTokens: result.budget.completionTokens,
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
