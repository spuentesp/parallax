// GET /api/workspaces/:id/docs — la documentación que los repos traen, localizada y leída en
// el motor (ver ../docs/discover.ts). Se reutiliza 30 min por workspace: son decenas de
// lecturas pequeñas.

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deriveLainRepoId } from '../code-graph.js';
import * as schema from '../db/schema.js';
import { type DocEntry, discoverDocs } from '../docs/discover.js';
import { isLainCallError } from '../lain-adapter/errors.js';

const TTL_MS = 30 * 60_000;

export const docsRoutes: FastifyPluginAsync = async (app) => {
  // Re-lee los checkouts y reconstruye el índice (tras un pull).
  app.post(
    '/api/workspaces/:id/docs/reindex',
    { config: { scopes: ['write'] }, schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req) => ({ repos: await app.docs.ensure((req.params as { id: string }).id, true) }),
  );
  const cache = new Map<string, { at: number; value: DocEntry[] }>();
  app.get(
    '/api/workspaces/:id/docs',
    { config: { scopes: ['read'] }, schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]) return reply.code(404).send({ code: 'NotFound', detail: 'workspace not found' });
      // Primero el índice local (checkout del repo): no depende del motor ni de su latencia.
      await app.docs.ensure(id).catch(() => undefined);
      if (app.docs.has(id)) return { source: 'index' as const, docs: app.docs.list(id) };
      if (!ws[0].lainUrl) return { source: 'unconfigured' as const, docs: [] };
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < TTL_MS) return { source: 'lain' as const, docs: hit.value };
      try {
        const client = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const repos = await app.db
          .select()
          .from(schema.repo)
          .where(eq(schema.repo.workspaceId, id));
        const per = await Promise.all(repos.map((r) => discoverDocs(client, deriveLainRepoId(r))));
        const docs = per.flat();
        cache.set(id, { at: Date.now(), value: docs });
        return { source: 'lain' as const, docs };
      } catch (e) {
        return {
          source: 'error' as const,
          docs: [],
          error: isLainCallError(e) ? e.message : 'lain unreachable',
        };
      }
    },
  );
};
