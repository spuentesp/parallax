import fp from 'fastify-plugin';
import { createLainClient } from '../lain-adapter/client.js';
import { createLainMock } from '../lain-adapter/mock.js';

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
  },
  { name: 'lain-adapter' },
);
