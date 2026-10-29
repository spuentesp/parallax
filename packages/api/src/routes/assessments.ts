import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { buildCommentPreview } from '../github/comment-preview.js';
import { githubReaderFor, PrUrlError, parsePrUrl } from '../github/reader.js';
import {
  AssessmentRequestBody,
  createAssessment,
  getAssessmentReport,
  IdempotencyConflictError,
  listAssessments,
  NotFoundError,
} from '../services/assessments.js';

// §15 G2: el informe se persiste una sola vez y se sirve igual desde web y
// MCP. Estas rutas sólo leen lo persistido o encolan el trabajo; READY se
// anuncia después de guardar (INV 5).
export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/assessments',
    {
      config: { scopes: ['write'] },
      schema: { body: AssessmentRequestBody },
    },
    async (req, reply) => {
      const body = req.body as z.infer<typeof AssessmentRequestBody>;
      try {
        const { assessment, created, pr } = await createAssessment({
          db: app.db,
          worker: app.assessmentWorker,
          body,
          analyzerVersion: app.lain.analyzerVersion,
          github: githubReaderFor(app.config),
        });
        // El runner trabaja en segundo plano; el cliente observa el progreso
        // por GET y los eventos. La segunda llamada reutiliza la promesa en
        // vuelo: nunca hay dos trabajos activos para el mismo digest (INV 4).
        void app.assessmentWorker.run(assessment.id).catch((err: unknown) => {
          req.log.error({ err, assessmentId: assessment.id }, 'assessment run failed');
        });
        return reply.code(created ? 201 : 200).send({
          assessment,
          created,
          ...(pr ? { pr } : {}),
          dryRun: true,
        });
      } catch (e) {
        if (e instanceof IdempotencyConflictError) {
          return reply
            .code(409)
            .send({ type: 'about:blank', title: 'Conflict', status: 409, detail: e.message });
        }
        if (e instanceof NotFoundError) {
          return reply
            .code(404)
            .send({ type: 'about:blank', title: 'Not Found', status: 404, detail: e.message });
        }
        throw e;
      }
    },
  );

  // Listado de informes persistidos; opcionalmente por organización.
  app.get(
    '/api/assessments',
    {
      config: { scopes: ['read'] },
      schema: {
        querystring: z.object({ orgId: z.string().min(1).optional() }).loose(),
      },
    },
    async (req) => {
      const { orgId } = req.query as { orgId?: string };
      return { assessments: await listAssessments(app.db, orgId ? { orgId } : {}) };
    },
  );

  app.get(
    '/api/assessments/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const report = await getAssessmentReport(app.db, id);
      if (!report) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `assessment ${id} not found`,
        });
      }
      return { assessment: report };
    },
  );

  app.get(
    '/api/assessments/:id/events',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const exists = await app.assessmentWorker.get(id);
      if (!exists) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `assessment ${id} not found`,
        });
      }
      return { events: await app.assessmentWorker.events(id) };
    },
  );

  // Preview del comentario que se publicaría. DRY RUN: se genera localmente y
  // NUNCA se envía a GitHub. Conserva el SHA evaluado y los límites de
  // cobertura (§2), que es lo que hace revisable el informe antes de decidir.
  app.get(
    '/api/assessments/:id/comment-preview',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ evidence: z.coerce.boolean().optional() }).loose(),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { evidence } = req.query as { evidence?: boolean };
      const report = await getAssessmentReport(app.db, id);
      if (!report) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: `assessment ${id} not found`,
        });
      }
      return { preview: buildCommentPreview(report, { includeEvidence: evidence === true }) };
    },
  );

  // Resolver una URL de PR antes de iniciar nada: repositorio, base, head y
  // alcance (§2). Sólo lectura; no crea la evaluación.
  app.post(
    '/api/pr/resolve',
    {
      config: { scopes: ['read'] },
      schema: { body: z.object({ url: z.string().url() }) },
    },
    async (req, reply) => {
      const { url } = req.body as { url: string };
      try {
        parsePrUrl(url);
      } catch (e) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: e instanceof Error ? e.message : 'invalid PR url',
        });
      }
      const reader = githubReaderFor(app.config);
      try {
        const pr = await reader.fetchPr(url);
        return {
          pr,
          dryRun: true,
          note: 'Read-only: resolving a PR posts nothing to GitHub. Results are published only by the CI reporting a workspace turns on (commit status, optional comment).',
        };
      } catch (e) {
        const code = e instanceof PrUrlError ? e.code : 'http_error';
        return reply.code(code === 'not_found' ? 404 : 502).send({
          type: 'about:blank',
          title: code === 'not_found' ? 'Not Found' : 'Upstream Error',
          status: code === 'not_found' ? 404 : 502,
          detail: e instanceof Error ? e.message : 'GitHub read failed',
        });
      }
    },
  );
};
