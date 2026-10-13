import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

export const orgsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/orgs',
    {
      config: { scopes: ['read'] },
      schema: {
        response: { 200: z.object({ orgs: z.array(z.unknown()) }) },
      },
    },
    async () => ({ orgs: [] }),
  );
};
