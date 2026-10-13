import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const notImpl = (what: string) =>
  LainCallError.parse({
    code: 'NotImplemented',
    message: what,
    doc: SPEC_DOC,
  });

export const orgsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/orgs',
    {
      config: { scopes: ['read'] },
      schema: { response: { 200: z.object({ orgs: z.array(z.unknown()) }) } },
    },
    async () => ({ orgs: [] }),
  );

  app.post(
    '/orgs',
    {
      config: { scopes: ['write'] },
      schema: {
        body: z.object({ name: z.string().min(1), lainUrl: z.string().url().optional() }),
        response: { 501: z.unknown() },
      },
    },
    async () => {
      throw notImpl('POST /orgs lands in subproject 2 (OrgManifest resolution + repos.yaml onboarding)');
    },
  );

  app.get(
    '/orgs/:orgId',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ orgId: z.string().min(1) }) },
    },
    async (req) => {
      throw notImpl(`GET /orgs/${req.params.orgId} lands in subproject 2`);
    },
  );
};
