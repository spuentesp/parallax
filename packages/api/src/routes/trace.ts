// POST /api/workspaces/:id/trace[/stream] — el trazado de punta a punta de un contrato
// (ver ../trace/). Mismo flujo de progreso en vivo que /api/query/stream.

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ProgressEvent } from '../agent/investigator.js';
import { investigatorModel } from '../agent/model.js';
import * as schema from '../db/schema.js';
import { createWindowLimiter } from '../rate-limit.js';
import type { TraceResult } from '../trace/schema.js';
import { buildSeed } from '../trace/seed.js';
import { traceEndToEnd } from '../trace/tracer.js';

const TRACES_PER_HOUR = 8;
const Body = z.object({ key: z.string().min(1).max(300), service: z.string().min(1).optional() });
const Params = z.object({ id: z.string().min(1) });

export const traceRoutes: FastifyPluginAsync = async (app) => {
  const limiter = createWindowLimiter({ limit: TRACES_PER_HOUR, windowMs: 3_600_000 });

  type Outcome =
    | { status: 200; body: TraceResult }
    | { status: number; body: unknown; headers?: Record<string, string> };

  const handle = async (
    token: string,
    workspaceId: string,
    body: z.infer<typeof Body>,
    onProgress?: (e: ProgressEvent) => void,
  ): Promise<Outcome> => {
    const taken = limiter.take(`${token}:${workspaceId}`);
    if (!taken.ok) {
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
    }
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
    // Mismo cliente (y mismo conducto de pruebas) que el mapa y los cabos sueltos.
    const ws = await app.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
      .limit(1);
    const lainUrl = ws[0]?.lainUrl;
    if (!lainUrl)
      return {
        status: 409,
        body: { code: 'NoMap', detail: 'this workspace has no LAIN server configured' },
      };
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

  const send = (reply: FastifyReply, o: Outcome) => {
    for (const [k, v] of Object.entries((o as { headers?: Record<string, string> }).headers ?? {}))
      reply.header(k, v);
    return reply.code(o.status).send(o.body);
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
          req.body as z.infer<typeof Body>,
        ),
      ),
  );

  app.post(
    '/api/workspaces/:id/trace/stream',
    { config: { scopes: ['read'] }, schema: { params: Params, body: Body } },
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
        const out = await handle(
          req.authToken?.token ?? 'anonymous',
          (req.params as { id: string }).id,
          req.body as z.infer<typeof Body>,
          (e) => emit('progress', e),
        );
        if (out.status !== 200) {
          if (!opened) return send(reply, out);
          emit('error', out.body);
        } else {
          emit('result', out.body);
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
