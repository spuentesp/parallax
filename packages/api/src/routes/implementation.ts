// GET /api/workspaces/:id/map/implementation?key=<contrato>&repo=<repo de LAIN>
// "¿Qué código implementa este endpoint?": búsqueda por nombre en el índice de
// código (ver ../implementation.ts). Sólo bajo demanda: son 2–4 consultas al motor.

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deriveLainRepoId } from '../code-graph.js';
import * as schema from '../db/schema.js';
import { findImplementation } from '../implementation.js';
import { isLainCallError } from '../lain-adapter/errors.js';

export const implementationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/workspaces/:id/map/implementation',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ key: z.string().min(1).max(300), repo: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { key, repo } = req.query as { key: string; repo: string };
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]) return reply.code(404).send({ code: 'NotFound', detail: 'workspace not found' });
      const repos = await app.db.select().from(schema.repo).where(eq(schema.repo.workspaceId, id));
      // Sólo repos del propio workspace (mismo alcance que el grafo de código).
      if (!repos.some((r) => deriveLainRepoId(r) === repo)) {
        return reply
          .code(400)
          .send({ code: 'BadRequest', detail: `repo '${repo}' is not part of this workspace` });
      }
      if (!ws[0].lainUrl) return { source: 'unconfigured' as const };
      try {
        const client = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        return { source: 'lain' as const, result: await findImplementation(client, { key, repo }) };
      } catch (e) {
        return {
          source: 'error' as const,
          error: isLainCallError(e) ? e.message : 'lain unreachable',
        };
      }
    },
  );
};
