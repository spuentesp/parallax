import { AssessmentInput } from '@parallax/shared/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (msg: string) =>
  LainCallError.parse({ code: 'NotImplemented', message: msg, doc: SPEC_DOC });

export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/assessments',
    {
      config: { scopes: ['write'] },
      schema: { body: AssessmentInput },
    },
    async () => {
      throw notImpl('POST /api/assessments lands in subproject 3');
    },
  );

  app.get(
    '/api/assessments/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      throw notImpl(
        `GET /api/assessments/${(req.params as { id: string }).id} lands in subproject 3`,
      );
    },
  );

  app.get(
    '/api/assessments/:id/events',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      throw notImpl(
        `GET /api/assessments/${(req.params as { id: string }).id}/events lands in subproject 3`,
      );
    },
  );
};
