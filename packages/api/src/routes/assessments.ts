import { AssessmentInput } from '@parallax/shared/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (what: string) =>
  LainCallError.parse({ code: 'NotImplemented', message: what, doc: SPEC_DOC });

export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/assessments',
    {
      config: { scopes: ['write'] },
      schema: {
        body: AssessmentInput,
        response: { 501: z.unknown() },
      },
    },
    async () => {
      throw notImpl('POST /assessments lands in subproject 3 (AssessmentWorker state machine)');
    },
  );

  app.get(
    '/assessments/:id',
    { config: { scopes: ['read'] }, schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req) => {
      const id = (req.params as { id: string }).id;
      throw notImpl(`GET /assessments/${id} lands in subproject 3`);
    },
  );

  app.get(
    '/assessments/:id/events',
    { config: { scopes: ['read'] }, schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req) => {
      const id = (req.params as { id: string }).id;
      throw notImpl(`GET /assessments/${id}/events (SSE) lands in subproject 3`);
    },
  );
};
