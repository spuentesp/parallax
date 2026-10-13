import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal('ok'),
            version: z.string(),
            lainAdapter: z.enum(['mock', 'real']),
            apiVersion: z.string(),
            analyzerVersion: z.string(),
          }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: '0.1.0',
      lainAdapter: app.config.lainAdapter,
      apiVersion: app.lain.apiVersion,
      analyzerVersion: app.lain.analyzerVersion,
    }),
  );
};
