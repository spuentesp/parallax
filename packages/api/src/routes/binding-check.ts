import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';

// Validar un vínculo propuesto consumidor → endpoint (check_binding de LAIN).
// Es puro: no crea nada ni escribe en el workspace. Devuelve si el motor lo
// aceptaría y, si es así, la entrada de `repos.yaml#bindings` que lo confirmaría.

const params = z.object({ id: z.string().min(1) });
const body = z.object({
  consumer: z.string().min(1),
  endpoint: z.object({ key: z.string().min(1), service: z.string().min(1) }),
});

export interface BindingCheckDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  valid: boolean;
  reasons: string[];
  methodMatch: boolean;
  templateMatch: string;
  bindingsEntry: string | null;
}

export const bindingCheckRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/workspaces/:id/bindings/check',
    { config: { scopes: ['read'] }, schema: { params, body } },
    async (req): Promise<BindingCheckDto> => {
      const { id } = req.params as z.infer<typeof params>;
      const { consumer, endpoint } = req.body as z.infer<typeof body>;
      const none = (source: BindingCheckDto['source'], error?: string): BindingCheckDto => ({
        source,
        ...(error ? { error } : {}),
        valid: false,
        reasons: [],
        methodMatch: false,
        templateMatch: 'none',
        bindingsEntry: null,
      });
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0]?.lainUrl) return none('unconfigured');
      try {
        const adapter = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 30_000,
        });
        const r = await adapter.checkBinding({ snapshot: 'live', consumer, endpoint });
        return {
          source: 'lain',
          valid: r.valid,
          reasons: r.reasons.map(String),
          methodMatch: r.method_match,
          templateMatch: String(r.template_match),
          bindingsEntry: r.bindings_entry ?? null,
        };
      } catch (e) {
        return none('error', isLainCallError(e) ? e.message : 'lain unreachable');
      }
    },
  );
};
