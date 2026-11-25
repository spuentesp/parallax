import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { githubReaderFor } from '../github/reader.js';
import { createPrRequestGate, parseAllowlist } from '../services/pr-requests.js';

// POST /api/pr-requests: pedir el análisis de un PR (scope `request`). Un token con sólo
// `read` + `request` puede pedir esto y nada más: no alcanza POST /api/assessments (scope `write`).
export const prRequestRoutes: FastifyPluginAsync = async (app) => {
  const gate = createPrRequestGate({
    db: app.db,
    worker: app.assessmentWorker,
    analyzerVersion: app.lain.analyzerVersion,
    github: githubReaderFor(app.config),
    allowlist: parseAllowlist(app.config.requestAllowlist),
    gitBase: app.config.githubGitBase ?? 'https://github.com',
    onRunError: (err, assessmentId) =>
      app.log.error({ err, assessmentId }, 'requested assessment failed'),
  });

  app.post(
    '/api/pr-requests',
    {
      config: { scopes: ['request'] },
      schema: { body: z.object({ prUrl: z.string().min(1).max(300) }) },
    },
    async (req, reply) => {
      const { prUrl } = req.body as { prUrl: string };
      const out = await gate(prUrl);
      const { code, ...body } = out;
      if (code === 429)
        reply.header(
          'retry-after',
          String((out as { retryAfterSeconds: number }).retryAfterSeconds),
        );
      return reply.code(code).send(body);
    },
  );
};
