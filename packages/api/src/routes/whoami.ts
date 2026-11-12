import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// Quién es el portador del token: lo usa la SPA para validar el acceso y para
// saber si la sesión es de sólo lectura (p. ej. el enlace de demo de un juez).
export const whoamiRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/whoami',
    {
      // Sin `scopes`: cualquier token válido sirve; el hook de auth ya lo exige.
      config: {},
      schema: {
        response: {
          200: z.object({
            orgId: z.string(),
            scopes: z.array(z.string()),
            readOnly: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const t = req.authToken;
      const scopes = [...(t?.scopes ?? [])];
      return {
        orgId: t?.orgId ?? '',
        scopes,
        readOnly: !scopes.includes('write'),
      };
    },
  );
};
