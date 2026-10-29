import fp from 'fastify-plugin';
import { createLainClient, getLainClient, type LainClientConfig } from '../lain-adapter/client.js';
import { createLainMock } from '../lain-adapter/mock.js';
import type { LainAdapter } from '../lain-adapter/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Cliente LAIN de un workspace (pool real); los tests inyectan el motor aquí. */
    lainClientFor: (config: LainClientConfig) => Promise<LainAdapter>;
  }
}

export default fp(
  async (fastify) => {
    let adapter: ReturnType<typeof createLainMock>;
    if (fastify.config.lainAdapter === 'real') {
      const lainUrl = fastify.config.lainUrl;
      if (lainUrl === undefined) {
        throw new Error('LAIN_URL is required when LAIN_ADAPTER=real');
      }
      adapter = await createLainClient({ lainUrl, apiVersion: '1' });
    } else {
      adapter = createLainMock();
    }
    fastify.decorate('lain', adapter);
    fastify.decorate('lainClientFor', getLainClient);
  },
  { name: 'lain-adapter' },
);
