import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    config: import('../config.js').AppConfig;
    lain: import('../lain-adapter/types.js').LainAdapter;
  }
  interface FastifyRequest {
    authToken?: import('../config.js').AuthToken;
  }
}

export default fp(
  async (fastify) => {
    const tokensByValue = new Map(fastify.config.authTokens.map((t) => [t.token, t]));

    fastify.addHook('onRequest', async (request, reply) => {
      const routeConfig = request.routeOptions?.config as
        | { public?: boolean; scopes?: string[] }
        | undefined;
      if (routeConfig?.public) return;
      // Non-API, non-MCP routes are public (SPA, assets).
      const url = request.url;
      if (!url.startsWith('/api/') && !url.startsWith('/mcp')) return;

      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        return reply.code(401).send({
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'missing bearer token',
        });
      }
      const token = header.slice(7).trim();
      const found = tokensByValue.get(token);
      if (!found) {
        return reply.code(401).send({
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'unknown token',
        });
      }
      request.authToken = found;

      const required = routeConfig?.scopes;
      if (required && !required.every((s) => found.scopes.includes(s as never))) {
        return reply.code(403).send({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'insufficient scope',
        });
      }
    });
  },
  { name: 'auth' },
);
