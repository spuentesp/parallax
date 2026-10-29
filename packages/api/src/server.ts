import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
// Plugins
import assessmentWorkerPlugin from './plugins/assessment-worker.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import errorHandler from './plugins/error-handler.js';
import lainAdapterPlugin from './plugins/lain-adapter.js';
import orgGraphPlugin from './plugins/org-graph.js';
import { assessmentRoutes } from './routes/assessments.js';
import { ciRoutes } from './routes/ci.js';
import { conversationRoutes } from './routes/conversations.js';
import { docsRoutes } from './routes/docs.js';
// API routes (all under /api/)
import { healthRoutes } from './routes/health.js';
import { implementationRoutes } from './routes/implementation.js';
import { looseEndsRoutes } from './routes/loose-ends.js';
import { mapRoutes } from './routes/map.js';
// MCP + Web
import { mcpRoutes } from './routes/mcp.js';
import { officialDocsRoutes } from './routes/official-docs.js';
import { orgsRoutes } from './routes/orgs.js';
import { proposalRoutes } from './routes/proposals.js';
import { publicationRoutes } from './routes/publications.js';
import { queryRoutes } from './routes/query.js';
import { traceRoutes } from './routes/trace.js';
import { webRoutes } from './routes/web.js';
import { whoamiRoutes } from './routes/whoami.js';
import { workspaceRoutes } from './routes/workspaces.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);

  // Order matters: error-handler first, then auth, then db, then lain.
  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(dbPlugin);
  await app.register(lainAdapterPlugin);
  await app.register(orgGraphPlugin);
  await app.register(assessmentWorkerPlugin);

  // API routes.
  await app.register(healthRoutes);
  await app.register(orgsRoutes);
  await app.register(assessmentRoutes);
  await app.register(proposalRoutes);
  await app.register(publicationRoutes);
  await app.register(queryRoutes);
  await app.register(workspaceRoutes);
  await app.register(mapRoutes);
  await app.register(conversationRoutes);
  await app.register(looseEndsRoutes);
  await app.register(implementationRoutes);
  await app.register(docsRoutes);
  await app.register(officialDocsRoutes);
  await app.register(traceRoutes);
  await app.register(whoamiRoutes);
  await app.register(ciRoutes);

  // MCP (http-sse transport).
  await app.register(mcpRoutes);

  // Web bundle (must be last: its notFoundHandler is the SPA fallback).
  await app.register(webRoutes);

  return app;
}
