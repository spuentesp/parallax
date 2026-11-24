import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deriveLainRepoId } from '../code-graph.js';
import { resolveSymbolLinks, type SymbolLinksDto } from '../code-links.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';

// Un símbolo y lo que lo une al resto: archivos que cambian con él y repos que lo
// alcanzan. Sólo lee: nada se crea ni se escribe.

const params = z.object({ id: z.string().min(1) });
const query = z.object({ repo: z.string().min(1), symbol: z.string().min(1) });

export const symbolLinksRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/workspaces/:id/graph/symbol-links',
    { config: { scopes: ['read'] }, schema: { params, querystring: query } },
    async (req, reply): Promise<SymbolLinksDto | undefined> => {
      const { id } = req.params as z.infer<typeof params>;
      const { repo, symbol } = req.query as z.infer<typeof query>;
      const none = (source: SymbolLinksDto['source'], error?: string): SymbolLinksDto => ({
        source,
        ...(error ? { error } : {}),
        symbol,
        repo,
        path: null,
        note: null,
        coChange: null,
        crossRepo: null,
        crossRepoNote: null,
      });
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]) {
        await reply.code(404).send({ code: 'NotFound', detail: 'workspace not found' });
        return undefined;
      }
      const repos = await app.db.select().from(schema.repo).where(eq(schema.repo.workspaceId, id));
      if (!new Set(repos.map((r) => deriveLainRepoId(r))).has(repo)) {
        await reply
          .code(400)
          .send({ code: 'BadRequest', detail: `repo '${repo}' is not part of this workspace` });
        return undefined;
      }
      if (!ws[0].lainUrl) return none('unconfigured');
      try {
        const adapter = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 30_000,
        });
        return await resolveSymbolLinks(adapter, repo, symbol);
      } catch (e) {
        return none('error', isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
  );
};
