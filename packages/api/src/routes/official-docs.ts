// /api/workspaces/:id/official-docs — la lista de documentación oficial del workspace
// (palabra clave de librería → dominios) que web_search consulta primero. Vive en la base de
// datos y se siembra con valores por defecto; aquí se lee, se amplía y se recorta.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DOMAIN, InvalidOfficialDoc, WORD } from '../docs/official.js';

const params = z.object({ id: z.string().min(1) });
const wordParams = z.object({ id: z.string().min(1), word: z.string().regex(WORD) });

export const officialDocsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/workspaces/:id/official-docs',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req) => {
      const { id } = req.params as { id: string };
      const entries = app.officialDocs.list(id);
      return { entries, count: entries.length };
    },
  );

  app.post(
    '/api/workspaces/:id/official-docs',
    {
      config: { scopes: ['write'] },
      schema: {
        params,
        body: z
          .object({
            word: z.string().regex(WORD),
            domains: z.array(z.string().regex(DOMAIN)).min(1).max(20),
          })
          .strict(),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { word: string; domains: string[] };
      try {
        const added = app.officialDocs.add(id, body.word, body.domains);
        return reply.code(added > 0 ? 201 : 200).send({ added });
      } catch (e) {
        if (e instanceof InvalidOfficialDoc)
          return reply.code(400).send({ code: 'BadRequest', detail: e.message });
        throw e;
      }
    },
  );

  app.delete(
    '/api/workspaces/:id/official-docs/:word',
    {
      config: { scopes: ['write'] },
      schema: {
        params: wordParams,
        querystring: z.object({ domain: z.string().regex(DOMAIN).optional() }),
      },
    },
    async (req, reply) => {
      const { id, word } = req.params as { id: string; word: string };
      const { domain } = req.query as { domain?: string };
      const removed = app.officialDocs.remove(id, word, domain);
      if (removed === 0) return reply.code(404).send({ code: 'NotFound', detail: 'no such entry' });
      return { removed };
    },
  );

  // Descarta lo que el workspace cambió y vuelve a la lista por defecto.
  app.post(
    '/api/workspaces/:id/official-docs/reset',
    { config: { scopes: ['write'] }, schema: { params } },
    async (req) => {
      const { id } = req.params as { id: string };
      app.officialDocs.reset(id);
      return { entries: app.officialDocs.list(id).length };
    },
  );
};
