import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (what: string) =>
  LainCallError.parse({ code: 'NotImplemented', message: what, doc: SPEC_DOC });

export const publicationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/publications',
    {
      config: { scopes: ['publish'] },
      schema: {
        body: z.object({ assessmentId: z.string().min(1), target: z.string().min(1) }),
      },
    },
    async () => {
      throw notImpl('POST /publications lands in subproject 6 (outbox + GitHub reconciliation)');
    },
  );
};
