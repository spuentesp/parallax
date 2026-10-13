import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import errorHandler from './plugins/error-handler.js';
import lainAdapterPlugin from './plugins/lain-adapter.js';
import { healthRoutes } from './routes/health.js';
import { orgsRoutes } from './routes/orgs.js';
import type { AppConfig } from './config.js';
import './plugins/db.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);

  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(dbPlugin);
  await app.register(lainAdapterPlugin);

  await app.register(healthRoutes);
  await app.register(orgsRoutes);
  return app;
}
