import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type CoverageLedgerDto, normalizeLedger } from '../coverage/ledger.js';
import { scopeToWorkspace } from '../coverage/scope.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';

const params = z.object({ id: z.string().min(1) });

const none = (source: CoverageLedgerDto['source'], error?: string): CoverageLedgerDto => ({
  source,
  ...(error ? { error } : {}),
  complete: null,
  external: [],
  schemalessEndpoints: 0,
  staleBindings: 0,
  repos: [],
  gaps: {
    unresolvedConsumers: 0,
    ambiguous: 0,
    unresolvedRefs: 0,
    urlDefaults: 0,
    blindSpotSites: 0,
  },
});

// El registro de cobertura del motor (`get_coverage`): sólo lectura.
export const coverageLedgerRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/workspaces/:id/coverage/ledger',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req): Promise<CoverageLedgerDto> => {
      const { id } = req.params as z.infer<typeof params>;
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]?.lainUrl) return none('unconfigured');
      try {
        const adapter = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 30_000,
        });
        const raw = (await adapter.getCoverage({ snapshot: 'live' })) as Record<string, unknown>;
        const rows = await app.db.select().from(schema.repo).where(eq(schema.repo.workspaceId, id));
        const repos = Array.isArray(raw.repos)
          ? scopeToWorkspace(
              raw.repos as Array<{ repo?: unknown }>,
              (r) => (typeof r?.repo === 'string' ? r.repo : null),
              rows,
            )
          : raw.repos;
        return { source: 'lain', ...normalizeLedger({ ...raw, repos }) };
      } catch (e) {
        return none('error', isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
  );
};
