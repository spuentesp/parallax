import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type ContractDetailDto, contractKindOf, normalizeContract } from '../contract-detail.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';

// Detalle de un contrato del workspace: proveedor, campos y quién lee cada uno,
// tal como los devuelve `get_contract` de LAIN.

const params = z.object({ id: z.string().min(1) });
const query = z.object({ key: z.string().min(1), service: z.string().min(1).optional() });

export const contractDetailRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/workspaces/:id/contracts/detail',
    { config: { scopes: ['read'] }, schema: { params, querystring: query } },
    async (req): Promise<ContractDetailDto> => {
      const { id } = req.params as z.infer<typeof params>;
      const { key, service } = req.query as z.infer<typeof query>;
      const empty = (source: ContractDetailDto['source'], error?: string): ContractDetailDto => ({
        source,
        ...(error ? { error } : {}),
        key,
        service: service ?? null,
        kind: contractKindOf(key),
        providers: [],
        schemas: [],
        consumers: [],
      });

      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]?.lainUrl) return empty('unconfigured');
      try {
        const adapter = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 30_000,
        });
        const raw = await adapter.getContract({
          snapshot: 'live',
          key,
          ...(service ? { service } : {}),
        });
        return normalizeContract(key, service ?? null, raw);
      } catch (e) {
        return empty('error', isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
  );
};
