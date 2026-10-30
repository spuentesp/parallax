import { FastifyInstance } from 'fastify';
import { EntryConfig } from '@parallax/mcp';

interface ConfigRouteOptions {
  config: EntryConfig;
}

export default async function configRoute(
  fastify: FastifyInstance,
  options: ConfigRouteOptions,
) {
  fastify.get('/config', async () => {
    return {
      disableLsp: options.config.disableLsp,
      lspLean: options.config.lspLean,
      indexTimeout: options.config.indexTimeout,
    };
  });

  fastify.post('/config', async (request, reply) => {
    const { disableLsp, lspLean, indexTimeout } = request.body as {
      disableLsp?: boolean;
      lspLean?: boolean;
      indexTimeout?: number;
    };

    // In a real implementation, you would update the config here
    // For now, we'll just return the updated values
    return {
      disableLsp,
      lspLean,
      indexTimeout,
    };
  });
}