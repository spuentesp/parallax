// Cabos sueltos de un workspace: lo que el motor no pudo atar y lo que ató sólo
// por heurística, con qué es cada uno (regla por ruta, o juicio de Nemotron
// leyendo el código — rotulado como tal). GET lee; POST lanza la clasificación.

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { investigatorModel } from '../agent/model.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';
import { createLooseEndsService } from '../loose-ends/service.js';
import { createLooseEndStore } from '../loose-ends/store.js';
import { createWindowLimiter } from '../rate-limit.js';

const ASSESS_PER_HOUR = 4;

const plugin: FastifyPluginAsync = async (app) => {
  const limiter = createWindowLimiter({ limit: ASSESS_PER_HOUR, windowMs: 3_600_000 });
  const service = createLooseEndsService({
    store: createLooseEndStore(app.db),
    async getAdapter(workspaceId) {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, workspaceId))
        .limit(1);
      if (!ws[0]?.lainUrl) return null;
      try {
        return await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 30_000,
        });
      } catch (e) {
        throw new Error(isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
    model() {
      const m = investigatorModel(app.config);
      if (!m) return null;
      return {
        name: m.settings.plannerModel,
        complete: (messages, opts) => m.provider.complete(messages, opts),
      };
    },
  });
  app.decorate('looseEnds', service);

  const params = z.object({ id: z.string().min(1) });

  app.get(
    '/api/workspaces/:id/loose-ends',
    {
      config: { scopes: ['read'] },
      schema: { params, querystring: z.object({ refresh: z.string().optional() }).loose() },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof params>;
      const refresh = (req.query as { refresh?: string }).refresh === '1';
      return service.list(id, { refresh });
    },
  );

  app.post(
    '/api/workspaces/:id/loose-ends/assess',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof params>;
      const taken = limiter.take(`${req.authToken?.token ?? 'anonymous'}:${id}`);
      if (!taken.ok) {
        return reply
          .code(429)
          .header('retry-after', String(Math.ceil(taken.retryAfterMs / 1000)))
          .send({
            type: 'about:blank',
            title: 'Too Many Requests',
            status: 429,
            detail: `Classification can be started ${ASSESS_PER_HOUR} times per hour per workspace.`,
          });
      }
      const started = await service.assess(id);
      return reply.code(started === 'no_model' ? 409 : 202).send({ status: started });
    },
  );
};

// fastify-plugin: `app.looseEnds` es visible fuera de este módulo (tests, scripts).
export const looseEndsRoutes = fp(plugin, { name: 'loose-ends-routes' });

declare module 'fastify' {
  interface FastifyInstance {
    looseEnds: ReturnType<typeof createLooseEndsService>;
  }
}
