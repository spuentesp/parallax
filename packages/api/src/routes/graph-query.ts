import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import {
  type MergedResult,
  mergeAnswers,
  PipelineBody,
  PipelineError,
  preparePipeline,
  type RepoAnswer,
  readAnswer,
} from '../graph-query/pipeline.js';
import { isLainCallError } from '../lain-adapter/errors.js';

// Consulta estructurada sobre el grafo del motor, de sólo lectura (ver graph-query/pipeline.ts).
// El motor exige `repo_id` en una federación: se pregunta en cada repo y se juntan las
// respuestas. Un repo que falla no tumba el resto: queda anotado y el alcance lo dice.

const params = z.object({ id: z.string().min(1) });
const CONCURRENCY = 4;

export interface GraphQueryDto extends MergedResult {
  source: 'lain';
  /** Repos que respondieron y repos que fallaron, con el motivo del motor. */
  scope: { analyzed: string[]; failed: Array<{ repo: string; error: string }> };
  elapsedMs: number;
}

async function mapPool<T, R>(items: readonly T[], size: number, fn: (i: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export const graphQueryRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/workspaces/:id/graph-query',
    { config: { scopes: ['read'] }, schema: { params } },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof params>;
      const body = PipelineBody.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: body.error.issues
            .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
            .join('; '),
        });
      }
      let prepared: ReturnType<typeof preparePipeline>;
      try {
        prepared = preparePipeline(body.data.ops);
      } catch (e) {
        if (e instanceof PipelineError) {
          return reply
            .code(400)
            .send({ type: 'about:blank', title: 'Bad Request', status: 400, detail: e.message });
        }
        throw e;
      }

      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, id))
        .limit(1);
      if (!ws[0])
        return reply.code(404).send({ type: 'about:blank', title: 'Not Found', status: 404 });
      if (!ws[0].lainUrl) {
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'this workspace has no LAIN server configured',
        });
      }

      const started = Date.now();
      try {
        const adapter = await app.lainClientFor({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 60_000,
        });
        // Los repos son los que el motor tiene en su federación, no los de la base de datos.
        const cov = (await adapter.getCoverage({ snapshot: 'live' })) as {
          repos?: Array<{ repo?: unknown }>;
        };
        const engineRepos = (cov.repos ?? []).flatMap((r) =>
          typeof r.repo === 'string' ? [r.repo] : [],
        );
        const repos = body.data.repos
          ? engineRepos.filter((r) => body.data.repos?.includes(r))
          : engineRepos;
        if (repos.length === 0) {
          return reply.code(409).send({
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'the engine reports no repositories to query',
          });
        }

        const results = await mapPool(repos, CONCURRENCY, async (repo) => {
          try {
            const raw = await adapter.queryGraph({
              snapshot: 'live',
              repo_id: repo,
              query: { explain: true, ops: prepared.engineOps },
            });
            return { repo, answer: readAnswer(repo, raw) as RepoAnswer | null, error: null };
          } catch (e) {
            const msg = isLainCallError(e) ? e.message : e instanceof Error ? e.message : 'failed';
            return { repo, answer: null, error: msg };
          }
        });

        const answers = results.flatMap((r) => (r.answer ? [r.answer] : []));
        const failed = results.flatMap((r) => (r.error ? [{ repo: r.repo, error: r.error }] : []));
        // Todos fallan con la misma razón: es la consulta, no el motor. Se devuelve tal cual.
        if (answers.length === 0) {
          const first = failed[0]?.error ?? 'the engine did not answer';
          const sameReason = failed.every((f) => f.error === first);
          return reply.code(sameReason ? 400 : 502).send({
            type: 'about:blank',
            title: sameReason ? 'Bad Request' : 'Bad Gateway',
            status: sameReason ? 400 : 502,
            detail: first,
          });
        }
        const dto: GraphQueryDto = {
          source: 'lain',
          ...mergeAnswers(prepared, answers),
          scope: { analyzed: answers.map((a) => a.repo), failed },
          elapsedMs: Date.now() - started,
        };
        return dto;
      } catch (e) {
        return reply.code(502).send({
          type: 'about:blank',
          title: 'Bad Gateway',
          status: 502,
          detail: isLainCallError(e) ? e.message : 'lain unreachable',
        });
      }
    },
  );
};
