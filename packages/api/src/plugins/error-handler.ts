import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { randomBytes } from 'node:crypto';
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

function traceId(): string {
  return randomBytes(8).toString('hex');
}

export default fp(
  async (fastify) => {
    fastify.setErrorHandler((err, req, reply) => {
      const tid = traceId();
      req.log.error({ err, traceId: tid }, 'request error');

      if (err instanceof ZodError) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'request validation failed',
          errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          traceId: tid,
        });
      }
      if ((err as { validation?: unknown }).validation) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: (err as Error).message,
          traceId: tid,
        });
      }
      if (err instanceof SyntaxError && 'body' in (err as object)) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'malformed JSON body (Review Focus #4)',
          traceId: tid,
        });
      }
      const lainResult = LainCallError.safeParse(err);
      if (lainResult.success) {
        const status = lainCodeToStatus[lainResult.data.code] ?? 500;
        return reply.code(status).send({ ...lainResult.data, status, traceId: tid });
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
