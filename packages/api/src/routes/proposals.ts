import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (msg: string) =>
  LainCallError.parse({ code: 'NotImplemented', message: msg, doc: SPEC_DOC });

export const proposalRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/proposals',
    {
      config: { scopes: ['write'] },
      schema: { body: z.object({ question: z.string().min(1), orgId: z.string().min(1) }) },
    },
    async () => {
      throw notImpl('POST /api/proposals lands in subproject 5');
    },
  );

  app.get(
    '/api/proposals/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      throw notImpl(
        `GET /api/proposals/${(req.params as { id: string }).id} lands in subproject 5`,
      );
    },
  );
};
