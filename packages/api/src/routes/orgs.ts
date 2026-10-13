import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (msg: string) =>
  LainCallError.parse({ code: 'NotImplemented', message: msg, doc: SPEC_DOC });

export const orgsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/orgs',
    {
      config: { scopes: ['read'] },
      schema: { response: { 200: z.object({ orgs: z.array(z.unknown()) }) } },
    },
    async () => ({ orgs: [] }),
  );

  app.post(
    '/api/orgs',
    {
      config: { scopes: ['write'] },
      schema: {
        body: z.object({ name: z.string().min(1), lainUrl: z.string().url().optional() }),
      },
    },
    async () => {
      throw notImpl('POST /api/orgs lands in subproject 2');
    },
  );

  app.get(
    '/api/orgs/:orgId',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ orgId: z.string().min(1) }) },
    },
    async (req) => {
      throw notImpl(
        `GET /api/orgs/${(req.params as { orgId: string }).orgId} lands in subproject 2`,
      );
    },
  );
};
