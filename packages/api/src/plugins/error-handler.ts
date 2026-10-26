import { randomBytes } from 'node:crypto';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const lainCodeToStatus: Record<string, number> = {
  NotImplemented: 501,
  LainUnavailable: 503,
  SnapshotNotReady: 409,
  ApiVersionMismatch: 500,
  AnalyzerVersionMismatch: 500,
  ToolSchemaMismatch: 400,
  IncompatibleView: 400,
};

export default fp(
  async (fastify) => {
    fastify.setErrorHandler((err, req, reply) => {
      const tid = randomBytes(8).toString('hex');
      req.log.error({ err, traceId: tid }, 'request error');

      if (err instanceof ZodError || (err as { validation?: unknown }).validation) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'request validation failed',
          errors:
            err instanceof ZodError
              ? err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
              : [(err as Error).message],
          traceId: tid,
        });
      }
      const lainResult = LainCallError.safeParse(err);
      if (lainResult.success) {
        const status = lainCodeToStatus[lainResult.data.code] ?? 500;
        return reply.code(status).send({ ...lainResult.data, status, traceId: tid });
      }
      // Errores 4xx de Fastify (cuerpo JSON mal formado, tipo de contenido no admitido)
      // son del cliente: se responden con su propio código, no como 500.
      const clientStatus = (err as { statusCode?: unknown }).statusCode;
      if (typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
        return reply.code(clientStatus).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: clientStatus,
          detail: (err as Error).message,
          traceId: tid,
        });
      }
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'unexpected error',
        traceId: tid,
      });
    });
  },
  { name: 'error-handler' },
);
