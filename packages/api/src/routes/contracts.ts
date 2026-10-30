import { ContractApplyBody } from '@parallax/shared/domain';
import { ListServiceRefsArgs } from '@parallax/shared/lain';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import type { LainAdapter } from '../lain-adapter/types.js';

const Params = z.object({ id: z.string().min(1) });
const ServiceRefsQuery = ListServiceRefsArgs.extend({
  suggestions: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  min_score: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const HttpRoutesQuery = z.object({
  repo: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
});

class ContractRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const contractRoutes: FastifyPluginAsync = async (app) => {
  const withLain = async (
    workspaceId: string,
    reply: FastifyReply,
    run: (lain: LainAdapter) => Promise<unknown>,
  ) => {
    try {
      const [ws] = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, workspaceId))
        .limit(1);
      if (!ws) throw new ContractRouteError(404, 'NotFound', 'workspace not found');
      if (!ws.lainUrl) {
        throw new ContractRouteError(409, 'NoMap', 'this workspace has no LAIN server configured');
      }
      const lain = await app.lainClientFor({
        lainUrl: ws.lainUrl,
        apiVersion: '1',
        timeoutMs: 30_000,
      });
      return await run(lain);
    } catch (error) {
      if (error instanceof ContractRouteError) {
        return reply.code(error.status).send({ code: error.code, detail: error.message });
      }
      throw error;
    }
  };

  app.get(
    '/api/workspaces/:id/service-refs',
    { config: { scopes: ['read'] }, schema: { params: Params, querystring: ServiceRefsQuery } },
    async (req, reply) =>
      withLain((req.params as { id: string }).id, reply, (lain) =>
        lain.listServiceRefs(req.query as ListServiceRefsArgs),
      ),
  );

  app.get(
    '/api/workspaces/:id/http-routes',
    { config: { scopes: ['read'] }, schema: { params: Params, querystring: HttpRoutesQuery } },
    async (req, reply) =>
      withLain((req.params as { id: string }).id, reply, (lain) =>
        lain.listContracts({ snapshot: 'live', kind: 'http', ...(req.query as HttpRoutesQuery) }),
      ),
  );

  app.post(
    '/api/workspaces/:id/contracts/remediation',
    { config: { scopes: ['write'] }, schema: { params: Params, body: ContractApplyBody } },
    async (req, reply) =>
      withLain((req.params as { id: string }).id, reply, (lain) =>
        lain.applyContractContext(req.body as ContractApplyBody),
      ),
  );
};

type HttpRoutesQuery = z.infer<typeof HttpRoutesQuery>;
