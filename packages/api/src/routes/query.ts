// POST /api/query — pregunta de arquitectura respondida por el investigador
// Nemotron (G3). Usa el LAIN del workspace (como el assessment worker), no el
// adapter global: el investigador sólo es creíble sobre la vista real del
// workspace. Sin modelo configurado, el análisis estructural sigue disponible
// y explanation_status hace el fallo visible (P08).

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { investigate, type ProgressEvent, serializeExplanation } from '../agent/investigator.js';
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
import { blastRadius, blastSentence } from '../roadmap/blast.js';
import { detectRoadmap } from '../roadmap/intent.js';
import { buildEndpointTopology, type TopologyViewData } from '../topology.js';
import { buildSeed } from '../trace/seed.js';
import { traceEndToEnd } from '../trace/tracer.js';

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
  // Cuando la pregunta pedía el recorrido de un dato o el radio de impacto de un cambio, la
  // respuesta lleva el resultado estructurado (se dibuja en el chat) además de la prosa.
  roadmap: z.unknown().optional(),
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
  // La topología estructural cambia poco: se reutiliza unos minutos por workspace.
  const TOPOLOGY_TTL_MS = 5 * 60_000;
  const topologyCache = new Map<string, { at: number; value: TopologyViewData }>();
  const topologyFor = async (
    orgId: string,
    build: () => Promise<TopologyViewData>,
  ): Promise<TopologyViewData> => {
    const hit = topologyCache.get(orgId);
    if (hit && Date.now() - hit.at < TOPOLOGY_TTL_MS) return hit.value;
    try {
      const value = await build();
      topologyCache.set(orgId, { at: Date.now(), value });
      return value;
    } catch {
      // Un LAIN caído no impide responder con explanation_status de fallo.
      return EMPTY_TOPOLOGY;
    }
  };
  const resolveWorkspaceLain = createWorkspaceLainResolver({
    db: app.db,
    defaultAdapter: app.lain,
    createClient: (cfg) => app.lainClientFor(cfg),
  });

  type Outcome =
    | { status: 200; body: z.infer<typeof QueryResponse> }
    | { status: number; body: unknown; headers?: Record<string, string> };

  /**
   * La consulta entera, sin tocar la respuesta HTTP: la ruta JSON y la de streaming
   * (progreso en vivo) la comparten. Los fallos de antes del modelo (límite, conversación
   * ajena o llena) se devuelven como resultado, no se lanzan.
   */
  const handle = async (
    req: FastifyRequest,
    onProgress?: (e: ProgressEvent) => void,
  ): Promise<Outcome> => {
    const taken = limiter?.take(req.authToken?.token ?? 'anonymous');
    if (taken && !taken.ok) {
      const minutes = Math.ceil(taken.retryAfterMs / 60_000);
      return {
        status: 429,
        headers: { 'retry-after': String(Math.ceil(taken.retryAfterMs / 1000)) },
        body: {
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: `Question limit reached for this access token (${perHour} per hour). Try again in about ${minutes} min.`,
        },
      };
    }
    const { question, orgId, conversationId } = req.body as z.infer<typeof QueryRequest>;
    const owner = ownerOf(req.authToken?.token ?? 'anonymous');

    // Una conversación ajena (o de otro workspace) no existe para quien pregunta.
    const prior = conversationId ? await conversations.get(owner, conversationId, orgId) : null;
    if (conversationId && !prior) {
      return { status: 404, body: { code: 'NotFound', detail: 'conversation not found' } };
    }
    if (prior && prior.turns.length >= MAX_TURNS_PER_CONVERSATION) {
      return {
        status: 409,
        body: {
          code: 'ConversationFull',
          detail: `this conversation reached ${MAX_TURNS_PER_CONVERSATION} turns: start a new one`,
        },
      };
    }
    const history = prior ? buildHistory(prior.turns) : undefined;
    const lain = (await resolveWorkspaceLain(orgId)) ?? app.lain;

    // Análisis estructural SIEMPRE, con o sin modelo (P08): la topología
    // no depende de Nemotron.
    // Se pide ya y se espera al final: no retrasa al investigador (en Saleor son ~10 s
    // de lecturas pesadas), y se reutiliza unos minutos entre preguntas.
    const topologyP = topologyFor(orgId, () => buildEndpointTopology(lain));

    // "Trace X end to end" / "what breaks if I change X": con un contrato nombrado sin
    // ambigüedad, la respuesta es el recorrido o el radio de impacto, no una improvisación.
    const roadmapGraph = await app.orgGraphs.load(orgId, false);
    const intent = roadmapGraph.ok ? detectRoadmap(question, roadmapGraph.graph) : null;
    const saveTurn = async (answer: string, status: string, model: string | null) => {
      try {
        const conv = prior?.conversation ?? (await conversations.start(owner, orgId, question));
        const seq = await conversations.append(conv.id, {
          question,
          answer,
          status,
          claims: [],
          focus: null,
          model,
        });
        return { id: conv.id, seq };
      } catch (e) {
        if (!(e instanceof ConversationFullError)) req.log.warn({ err: e }, 'turn not saved');
        return null;
      }
    };
    const roadmapBody = async (
      answer: string,
      status: string,
      roadmap: unknown,
      modelName: string | null,
      budget: z.infer<typeof QueryResponse>['budget'],
    ): Promise<Outcome> => ({
      status: 200,
      body: {
        conversation: await saveTurn(answer, status, modelName),
        answer,
        explanation_status: status,
        topology: await topologyP,
        evidence: [],
        citations: { accepted: [], rejected: [] },
        budget,
        tool_calls: [],
        model: modelName,
        claims: [],
        claims_summary: NO_CLAIMS,
        map_focus: null,
        roadmap,
      },
    });
    if (roadmapGraph.ok && intent?.kind === 'blast') {
      const blast = blastRadius(roadmapGraph.graph, intent.key, intent.service);
      if (blast) {
        return roadmapBody(blastSentence(blast), 'available', { kind: 'blast', blast }, null, null);
      }
    }

    const model = investigatorModel(app.config);
    if (roadmapGraph.ok && intent?.kind === 'trace' && model) {
      const seed = buildSeed(roadmapGraph.graph, intent.key, intent.service);
      if (seed) {
        const trace = await traceEndToEnd({
          seed,
          lain,
          model: model.provider,
          maxTokens: model.settings.maxTokens,
          modelRole: 'planner',
          ...(model.settings.thinking !== undefined ? { thinking: model.settings.thinking } : {}),
          ...(onProgress ? { onProgress } : {}),
        });
        const answer =
          trace.status === 'available'
            ? `${trace.summary}${trace.complete ? '' : ' The trail does not reach where the value ends; the gaps are marked.'}`
            : `I could not complete the trace of ${intent.key} (${trace.status.replace('failed:', '').replace(/_/g, ' ')}).`;
        return roadmapBody(
          answer,
          trace.status === 'available' ? 'available' : trace.status,
          { kind: 'trace', trace },
          'trace',
          null,
        );
      }
    }
    if (!model) {
      const topology = await topologyP;
      // Fallo visible, no un silencio: la explicación no existe y el motivo
      // queda en el estado (INV: nunca fingir que el modelo explicó).
      return {
        status: 200,
        body: {
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
        },
      };
    }

    if (!app.docs.has(orgId)) void app.docs.ensure(orgId).catch(() => undefined);
    const result = await investigate({
      nudgeSubmit: true,
      ...(history ? { history } : {}),
      question,
      lain,
      model: model.provider,
      view: 'live',
      budget: model.budget,
      // La documentación sale del índice local si el workspace lo tiene; si no, se indexa en
      // segundo plano para la siguiente pregunta (y el motor responde mientras tanto).
      ...(app.docs.has(orgId)
        ? {
            docs: (q: string, o?: { repo?: string; limit?: number }) =>
              app.docs.search(orgId, q, o),
          }
        : {}),
      maxTokens: model.settings.maxTokens,
      ...(model.settings.thinking !== undefined ? { thinking: model.settings.thinking } : {}),
      endpointLabel: model.settings.baseUrl,
      ...(onProgress ? { onProgress } : {}),
    });

    const topology = await topologyP;

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
      status: 200,
      body: {
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
      },
    };
  };

  const errorSchemas = {
    404: z.object({ code: z.string(), detail: z.string() }),
    409: z.object({ code: z.string(), detail: z.string() }),
    429: z.object({
      type: z.string(),
      title: z.string(),
      status: z.number(),
      detail: z.string(),
    }),
  };
  const send = (reply: FastifyReply, o: Outcome) => {
    for (const [k, v] of Object.entries(
      (o as { headers?: Record<string, string> }).headers ?? {},
    )) {
      reply.header(k, v);
    }
    return reply.code(o.status).send(o.body);
  };

  app.post(
    '/api/query',
    {
      config: { scopes: ['read'] },
      schema: { body: QueryRequest, response: { 200: QueryResponse, ...errorSchemas } },
    },
    async (req, reply) => send(reply, await handle(req)),
  );

  // Lo mismo, pero con el progreso EN VIVO (server-sent events): cada ronda del modelo,
  // cada lectura al motor y la comprobación de afirmaciones, y al final el resultado.
  // Un fallo de antes del modelo (límite, conversación ajena) responde JSON normal.
  app.post(
    '/api/query/stream',
    {
      config: { scopes: ['read'] },
      schema: { body: QueryRequest, response: errorSchemas },
    },
    async (req, reply) => {
      let opened = false;
      const emit = (event: string, data: unknown) => {
        if (!opened) {
          opened = true;
          reply.hijack();
          reply.raw.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
        }
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        const out = await handle(req, (e) => emit('progress', e));
        if (out.status !== 200) {
          // Aún no se abrió el flujo (los fallos previos al modelo no emiten progreso).
          if (!opened) return send(reply, out);
          emit('error', out.body);
        } else {
          emit('result', QueryResponse.parse(out.body));
        }
      } catch (e) {
        if (!opened) throw e;
        emit('error', { code: 'InternalError', detail: e instanceof Error ? e.message : 'failed' });
      }
      reply.raw.end();
      return reply;
    },
  );
};
