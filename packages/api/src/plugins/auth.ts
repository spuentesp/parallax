import fp from 'fastify-plugin';

const EXEMPT_PATHS = new Set(['/health']);

function isExempt(url: string): boolean {
  if (EXEMPT_PATHS.has(url)) return true;
  // Static web bundle is public; everything else requires a bearer token.
  return url === '/app' || url.startsWith('/app/');
}

export default fp(
  async (fastify) => {
    const tokensByValue = new Map(fastify.config.authTokens.map((t) => [t.token, t]));

    fastify.addHook('onRequest', async (request, reply) => {
      const url = request.routeOptions?.url ?? request.url;
      if (isExempt(url)) return;

      const header = request.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        reply
          .code(401)
          .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'missing bearer token' });
        return reply;
      }
      const token = header.slice('Bearer '.length).trim();
      if (token.length === 0) {
        reply
          .code(401)
          .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'empty bearer token' });
        return reply;
      }
      const found = tokensByValue.get(token);
      if (!found) {
        reply
          .code(401)
          .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'unknown token' });
        return reply;
      }
      request.authToken = found;

      const required = (request.routeOptions?.config as { scopes?: string[] } | undefined)?.scopes;
      if (
        required &&
        !required.every((s) => found.scopes.includes(s as (typeof found.scopes)[number]))
      ) {
        reply
          .code(403)
          .send({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'insufficient scope' });
        return reply;
      }
    });
  },
  { name: 'auth' },
);
