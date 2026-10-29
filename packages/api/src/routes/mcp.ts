import type { FastifyPluginAsync } from 'fastify';
import { githubReaderFor } from '../github/reader.js';
import { buildMcpServer, buildTransport } from '../mcp/transport/http-sse.js';

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  if (app.config.mcpTransport !== 'http-sse') return;

  // Mismos servicios que las rutas HTTP: worker y DB compartidos (P09).
  const server = buildMcpServer({
    db: app.db,
    worker: app.assessmentWorker,
    lain: app.lain,
    github: githubReaderFor(app.config),
  });
  const transport = buildTransport();
  await server.connect(transport as Parameters<typeof server.connect>[0]);

  app.post('/mcp', async (req, reply) => {
    const message = req.body as { method?: unknown; params?: { name?: unknown } } | null;
    if (
      message?.method === 'tools/call' &&
      message.params?.name === 'parallax_assess_pr' &&
      !req.authToken?.scopes.includes('write')
    ) {
      return reply.code(403).send({ error: 'write scope required to start an assessment' });
    }
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.hijack();
  });
  app.get('/mcp/sse', async (req, reply) => {
    await transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
  });
  app.delete('/mcp', async (req, reply) => {
    await transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
  });

  app.addHook('onClose', async () => {
    await transport.close();
    await server.close();
  });
};
