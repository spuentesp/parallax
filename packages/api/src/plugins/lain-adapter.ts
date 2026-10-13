import fp from 'fastify-plugin';
import { createLainClient } from '../lain-adapter/client.js';
import { createLainMock } from '../lain-adapter/mock.js';

export default fp(
  async (fastify) => {
    const adapter =
      fastify.config.lainAdapter === 'real'
        ? await createLainClient({
            lainUrl: fastify.config.lainUrl!,
            apiVersion: '1',
          })
        : createLainMock();
    fastify.decorate('lain', adapter);
  },
  { name: 'lain-adapter', dependencies: [] },
);
