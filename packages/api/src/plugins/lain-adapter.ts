import fp from 'fastify-plugin';
import { createLainMock } from '../lain-adapter/mock.js';
import { createLainClient } from '../lain-adapter/client.js';

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
