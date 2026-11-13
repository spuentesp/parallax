import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type CoverageBreakdown, classifyLooseEnds } from '../coverage/breakdown.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';

// Qué es cada cabo suelto de un workspace (ver coverage/breakdown.ts). Sólo lee: la
// clasificación sale de las categorías ya asignadas y de preguntar al motor
// (`check_binding`, puro) por los candidatos de lo que está en código de producto.

const params = z.object({ id: z.string().min(1) });

export interface CoverageBreakdownDto extends CoverageBreakdown {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
}

const none = (source: CoverageBreakdownDto['source'], error?: string): CoverageBreakdownDto => ({
  source,
  ...(error ? { error } : {}),
  classes: [],
  byKey: {},
  total: 0,
  gaps: 0,
});

export const coverageBreakdownRoutes: FastifyPluginAsync = async (app) => {
  // Una a la vez por workspace: abrir la página dos veces no pregunta dos veces al motor.
  const inflight = new Map<string, Promise<CoverageBreakdownDto>>();

  async function compute(id: string): Promise<CoverageBreakdownDto> {
    const ws = await app.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, id))
      .limit(1);
    if (!ws[0]?.lainUrl) return none('unconfigured');
    try {
      const report = await app.looseEnds.list(id, {});
      if (report.source !== 'lain') {
        return none(report.source, report.error ?? 'the engine could not list loose ends');
      }
      const adapter = await app.lainClientFor({
        lainUrl: ws[0].lainUrl,
        apiVersion: '1',
        timeoutMs: 30_000,
      });
      return { source: 'lain', ...(await classifyLooseEnds(adapter, report.items)) };
    } catch (e) {
      return none('error', isLainCallError(e) ? e.message : 'lain unreachable');
    }
  }

  app.get(
    '/api/workspaces/:id/coverage/breakdown',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req): Promise<CoverageBreakdownDto> => {
      const { id } = req.params as z.infer<typeof params>;
      const running = inflight.get(id);
      if (running) return running;
      const run = compute(id);
      inflight.set(id, run);
      try {
        return await run;
      } finally {
        inflight.delete(id);
      }
    },
  );
};
