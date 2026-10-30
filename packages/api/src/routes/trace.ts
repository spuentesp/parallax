// POST /api/workspaces/:id/trace[/stream] — el trazado de punta a punta de un contrato
// (ver ../trace/). Mismo flujo de progreso en vivo que /api/query/stream.

import { TraceFlowBody } from '@parallax/shared/domain';
import type { TraceFlowResponse } from '@parallax/shared/lain';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ProgressEvent } from '../agent/investigator.js';
import { investigatorModel } from '../agent/model.js';
import * as schema from '../db/schema.js';
import { createWindowLimiter } from '../rate-limit.js';
import { traceFlow } from '../trace/flow.js';
import type { TraceResult } from '../trace/schema.js';
import { buildSeed } from '../trace/seed.js';
import { traceEndToEnd } from '../trace/tracer.js';

const TRACES_PER_HOUR = 8;
const Body = z.object({ key: z.string().min(1).max(300), service: z.string().min(1).optional() });
const Params = z.object({ id: z.string().min(1) });
type Body = z.infer<typeof Body>;

type Outcome =
  | { status: 200; body: TraceResult | TraceFlowResponse }
  | { status: number; body: unknown; headers?: Record<string, string> };
type Handler = (
  token: string,
  workspaceId: string,
  body: unknown,
  onProgress?: (event: ProgressEvent) => void,
) => Promise<Outcome>;

export const traceRoutes: FastifyPluginAsync = async (app) => {
  const limiter = createWindowLimiter({ limit: TRACES_PER_HOUR, windowMs: 3_600_000 });

  const take = (token: string, workspaceId: string): Outcome | null => {
    const taken = limiter.take(`${token}:${workspaceId}`);
    if (taken.ok) return null;
    return {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(taken.retryAfterMs / 1000)) },
      body: {
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: `Traces can be started ${TRACES_PER_HOUR} times per hour per workspace.`,
      },
    };
  };

  const lainUrlFor = async (workspaceId: string): Promise<string | Outcome> => {
    const ws = await app.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
      .limit(1);
    if (!ws[0]) return { status: 404, body: { code: 'NotFound', detail: 'workspace not found' } };
    if (!ws[0].lainUrl) {
      return {
        status: 409,
        body: { code: 'NoMap', detail: 'this workspace has no LAIN server configured' },
      };
    }
    return ws[0].lainUrl;
  };

  const handle: Handler = async (token, workspaceId, rawBody, onProgress) => {
    const limited = take(token, workspaceId);
    if (limited) return limited;
    const body = rawBody as Body;
    const graph = await app.orgGraphs.load(workspaceId, false);
    if (!graph.ok) {
      return graph.source === 'none'
        ? { status: 404, body: { code: 'NotFound', detail: 'workspace not found' } }
        : {
            status: 409,
            body: {
              code: 'NoMap',
              detail:
                graph.source === 'unconfigured'
                  ? 'this workspace has no LAIN server configured'
                  : `the map is unavailable: ${graph.error ?? graph.source}`,
            },
          };
    }
    const seed = buildSeed(graph.graph, body.key, body.service);
    if (!seed) {
      return {
        status: 404,
        body: { code: 'ContractNotFound', detail: `no contract "${body.key}" in this map` },
      };
    }
    const model = investigatorModel(app.config);
    if (!model) {
      return {
        status: 409,
        body: { code: 'NoModel', detail: 'Nemotron is not configured (NEBIUS_TOKEN)' },
      };
    }
    const lainUrl = await lainUrlFor(workspaceId);
    if (typeof lainUrl !== 'string') return lainUrl;
    const lain = await app.lainClientFor({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });
    const result = await traceEndToEnd({
      seed,
      lain,
      model: model.provider,
      // El recorrido exige leer código de verdad: el modelo grande lo hace mucho mejor que el rápido.
      modelRole: 'planner',
      maxTokens: model.settings.maxTokens,
      ...(model.settings.thinking !== undefined ? { thinking: model.settings.thinking } : {}),
      ...(onProgress ? { onProgress } : {}),
    });
    return { status: 200, body: result };
  };

  const handleFlow: Handler = async (token, workspaceId, rawBody, onProgress) => {
    const limited = take(token, workspaceId);
    if (limited) return limited;
    const lainUrl = await lainUrlFor(workspaceId);
    if (typeof lainUrl !== 'string') return lainUrl;
    const lain = await app.lainClientFor({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });
    const body = rawBody as TraceFlowBody;
    onProgress?.({ type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 1, forced: false });
    const started = Date.now();
    try {
      const result = await traceFlow(lain, body);
      onProgress?.({
        type: 'tool',
        tool: 'trace_flow',
        summary: JSON.stringify(body.from),
        ok: true,
        ms: Date.now() - started,
      });
      return { status: 200, body: result };
    } catch (error) {
      onProgress?.({
        type: 'tool',
        tool: 'trace_flow',
        summary: JSON.stringify(body.from),
        ok: false,
        ms: Date.now() - started,
        note: error instanceof Error ? error.message : 'failed',
      });
      throw error;
    }
  };

  const send = (reply: FastifyReply, outcome: Outcome) => {
    for (const [key, value] of Object.entries(
      (outcome as { headers?: Record<string, string> }).headers ?? {},
    ))
      reply.header(key, value);
    return reply.code(outcome.status).send(outcome.body);
  };

  app.post(
    '/api/workspaces/:id/trace',
    { config: { scopes: ['read'] }, schema: { params: Params, body: Body } },
    async (req, reply) =>
      send(
        reply,
        await handle(
          req.authToken?.token ?? 'anonymous',
          (req.params as { id: string }).id,
          req.body,
        ),
      ),
  );

  app.post(
    '/api/workspaces/:id/trace/flow',
    { config: { scopes: ['read'] }, schema: { params: Params, body: TraceFlowBody } },
    async (req, reply) =>
      send(
        reply,
        await handleFlow(
          req.authToken?.token ?? 'anonymous',
          (req.params as { id: string }).id,
          req.body,
        ),
      ),
  );

  const registerStream = (
    path: string,
    bodySchema: typeof Body | typeof TraceFlowBody,
    handler: Handler,
  ) => {
    app.post(
      path,
      { config: { scopes: ['read'] }, schema: { params: Params, body: bodySchema } },
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
          const out = await handler(
            req.authToken?.token ?? 'anonymous',
            (req.params as { id: string }).id,
            req.body,
            (event) => emit('progress', event),
          );
          if (out.status !== 200) {
            if (!opened) return send(reply, out);
            emit('error', out.body);
          } else {
            emit('result', out.body);
          }
        } catch (error) {
          if (!opened) throw error;
          emit('error', {
            code: 'InternalError',
            detail: error instanceof Error ? error.message : 'failed',
          });
        }
        reply.raw.end();
        return reply;
      },
    );
  };

  registerStream('/api/workspaces/:id/trace/stream', Body, handle);
  registerStream('/api/workspaces/:id/trace/flow/stream', TraceFlowBody, handleFlow);
};
