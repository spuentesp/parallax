import type { FastifyPluginAsync } from 'fastify';
import { buildMcpServer, buildTransport } from '../mcp/transport/http-sse.js';

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  if (app.config.mcpTransport !== 'http-sse') return;

  // Mismos servicios que las rutas HTTP: worker y DB compartidos (P09).
  const server = buildMcpServer({ db: app.db, worker: app.assessmentWorker, lain: app.lain });
  const transport = buildTransport();
  await server.connect(transport as Parameters<typeof server.connect>[0]);

  app.post('/mcp', async (req, reply) => {
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
