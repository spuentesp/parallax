import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { investigatorModel } from '../agent/model.js';
import * as schema from '../db/schema.js';
import { isLainCallError } from '../lain-adapter/errors.js';
import { createWindowLimiter } from '../rate-limit.js';
import type { RecommendModel } from '../recommendations/explain.js';
import { buildRecommendations } from '../recommendations/service.js';
import type { RecommendationsDto } from '../recommendations/types.js';

// Recomendaciones para rellenar la remediación de contratos. Sólo lee y propone:
// aplicar sigue siendo POST /contracts/remediation (escritura, con vista previa).
// El modelo cuesta, así que su uso tiene tope por hora; sin cupo (o sin modelo) se
// devuelve igualmente todo lo que valida el motor.

const MODEL_RUNS_PER_HOUR = 6;
const params = z.object({ id: z.string().min(1) });

const empty = (source: RecommendationsDto['source'], error?: string): RecommendationsDto => ({
  source,
  ...(error ? { error } : {}),
  recommendations: [],
  skipped: [],
  model: { used: false, name: null, note: null },
});

export const recommendationsRoutes: FastifyPluginAsync = async (app) => {
  const limiter = createWindowLimiter({ limit: MODEL_RUNS_PER_HOUR, windowMs: 3_600_000 });
  // Una sola ejecución por workspace a la vez: pulsar dos veces no lanza dos (cada una
  // consulta al motor decenas de veces y, con modelo, gasta cupo).
  const inflight = new Map<string, Promise<RecommendationsDto>>();

  async function compute(id: string, token: string): Promise<RecommendationsDto> {
    const ws = await app.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, id))
      .limit(1);
    if (!ws[0]?.lainUrl) return empty('unconfigured');
    const lainUrl = ws[0].lainUrl;
    try {
      const report = await app.looseEnds.list(id, {});
      if (report.source !== 'lain') {
        return empty(report.source, report.error ?? 'the engine could not list loose ends');
      }
      const adapter = await app.lainClientFor({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });
      const m = investigatorModel(app.config);
      const model: RecommendModel | null = m
        ? {
            name: m.settings.plannerModel,
            complete: (messages, opts) => m.provider.complete(messages, opts),
          }
        : null;
      // El cupo sólo se gasta si hay modelo al que llamar.
      const modelAllowed = model === null || limiter.take(`${token}:${id}`).ok;
      const built = await buildRecommendations({
        adapter,
        items: report.items,
        model,
        modelAllowed,
      });
      return { source: 'lain', ...built };
    } catch (e) {
      return empty('error', isLainCallError(e) ? e.message : 'lain unreachable');
    }
  }

  app.post(
    '/api/workspaces/:id/contracts/recommendations',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req): Promise<RecommendationsDto> => {
      const { id } = req.params as z.infer<typeof params>;
      const running = inflight.get(id);
      if (running) return running;
      const run = compute(id, req.authToken?.token ?? 'anonymous');
      inflight.set(id, run);
      try {
        return await run;
      } finally {
        inflight.delete(id);
      }
    },
  );
};
