// Publicación de comentarios.
//
// DRY RUN: esta superficie NO publica nada. El usuario pidió explícitamente
// "no se te ocurra hacer un PR real", así que la publicación no está
// implementada y no puede contactar GitHub. Lo que sí existe es la vista
// previa (GET /api/assessments/:id/comment-preview), que se genera localmente.
//
// Cuando se decida implementarla, será una operación explícita autorizada por
// repositorio (§6), con marcador estable por assessment y destino, y estado
// UNCERTAIN si la respuesta se pierde (§13) — nunca automática.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LainCallError } from '../lain-adapter/errors.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

export const publicationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/publications',
    {
      config: { scopes: ['publish'] },
      schema: {
        body: z.object({ assessmentId: z.string().min(1), target: z.string().min(1) }),
      },
    },
    async () => {
      throw LainCallError.parse({
        code: 'NotImplemented',
        message:
          'publication is out of scope for the dry run: nothing is ever sent to GitHub. Use GET /api/assessments/:id/comment-preview instead.',
        doc: SPEC_DOC,
      });
    },
  );
};
