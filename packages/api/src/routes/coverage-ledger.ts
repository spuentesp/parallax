import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type CoverageLedgerDto, normalizeLedger } from '../coverage/ledger.js';
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
        return {
          source: 'lain',
          ...normalizeLedger(await adapter.getCoverage({ snapshot: 'live' })),
        };
      } catch (e) {
        return none('error', isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
  );
};
