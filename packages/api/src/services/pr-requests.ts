import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { fetchPrRefs, PrRefsError } from '../git/pr-refs.js';
import { type GitHubReader, PrUrlError, parsePrUrl } from '../github/reader.js';
import type { AssessmentWorker } from '../worker/assessment-worker.js';
import {
  createAssessment,
  type Db,
  listAssessments,
  NotFoundError,
  repoDisplayName,
} from './assessments.js';

// Pedir el análisis de un PR desde fuera (el panel de Jira). Es la única forma de trabajo que un
// visitante puede disparar, así que está acotada: sólo repos de una lista, un análisis a la vez en
// todo el servidor, una pausa tras un fallo y un tope por hora. Cada negativa dice por qué.

const IN_FLIGHT = new Set(['QUEUED', 'SNAPSHOTTING', 'ANALYZING', 'EXPLAINING']);
const DONE = new Set(['READY', 'PARTIAL']);
// Un análisis "en curso" más viejo que esto se considera huérfano (el servidor se reinició a medias).
const STALE_IN_FLIGHT_MS = 20 * 60_000;
// Tras un fallo el motor sigue indexando un rato: no se acepta trabajo nuevo todavía.
const COOLDOWN_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
export const MAX_REQUESTS_PER_HOUR = 6;

export type PrRequestOutcome =
  | { code: 200; status: 'exists'; assessmentId: string }
  | { code: 202; status: 'running' | 'started'; assessmentId: string }
  | { code: 400; status: 'invalid'; detail: string }
  | { code: 403; status: 'disabled' | 'not-allowed'; detail: string }
  | { code: 404; status: 'repo-not-configured'; detail: string }
  | {
      code: 429;
      status: 'busy' | 'cooling-down' | 'rate-limited';
      detail: string;
      retryAfterSeconds: number;
    }
  | { code: 502; status: 'git-fetch-failed'; detail: string };

// "owner/repo=workspaceId,owner/repo=workspaceId" -> owner/repo (minúsculas) -> workspaceId
export function parseAllowlist(text: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (text ?? '').split(',')) {
    const [slug, ws] = part.split('=').map((s) => s.trim());
    if (slug && ws && /^[\w.-]+\/[\w.-]+$/.test(slug)) out.set(slug.toLowerCase(), ws);
  }
  return out;
}

export function createPrRequestGate(deps: {
  db: Db;
  worker: AssessmentWorker;
  analyzerVersion: string;
  github: GitHubReader;
  allowlist: Map<string, string>;
  gitBase: string;
  now?: () => number;
  onRunError?: (err: unknown, assessmentId: string) => void;
}) {
  const now = deps.now ?? Date.now;
  const accepted: number[] = [];

  return async function request(prUrl: string): Promise<PrRequestOutcome> {
    if (deps.allowlist.size === 0) {
      return {
        code: 403,
        status: 'disabled',
        detail: 'requesting analyses is not enabled on this server',
      };
    }
    let ref: ReturnType<typeof parsePrUrl>;
    try {
      ref = parsePrUrl(prUrl);
    } catch (e) {
      if (e instanceof PrUrlError) return { code: 400, status: 'invalid', detail: e.message };
      throw e;
    }
    const slug = `${ref.owner}/${ref.repo}`;
    const orgId = deps.allowlist.get(slug.toLowerCase());
    if (!orgId) {
      return {
        code: 403,
        status: 'not-allowed',
        detail: `${slug} is not on the list of repositories that can be analysed on request`,
      };
    }

    // 1. Lo que ya existe no se vuelve a hacer.
    const mine = await listAssessments(deps.db, { pr: ref });
    const done = mine
      .filter((a) => DONE.has(a.status))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (done) return { code: 200, status: 'exists', assessmentId: done.id };
    const t = now();
    const running = mine.find(
      (a) => IN_FLIGHT.has(a.status) && t - a.createdAt < STALE_IN_FLIGHT_MS,
    );
    if (running) return { code: 202, status: 'running', assessmentId: running.id };

    // 2. Límites globales: un análisis a la vez, pausa tras un fallo, tope por hora.
    const all = await listAssessments(deps.db, {});
    const other = all.find((a) => IN_FLIGHT.has(a.status) && t - a.createdAt < STALE_IN_FLIGHT_MS);
    if (other) {
      return {
        code: 429,
        status: 'busy',
        detail: 'another analysis is running; try again in a few minutes',
        retryAfterSeconds: 120,
      };
    }
    const lastFail = all
      .filter((a) => a.status === 'FAILED')
      .map((a) => a.completedAt ?? a.createdAt)
      .sort((a, b) => b - a)[0];
    if (lastFail !== undefined && t - lastFail < COOLDOWN_MS) {
      return {
        code: 429,
        status: 'cooling-down',
        detail: 'the last analysis failed and the engine is still settling; try again later',
        retryAfterSeconds: Math.ceil((COOLDOWN_MS - (t - lastFail)) / 1000),
      };
    }
    while (accepted.length > 0 && t - (accepted[0] as number) >= HOUR_MS) accepted.shift();
    if (accepted.length >= MAX_REQUESTS_PER_HOUR) {
      return {
        code: 429,
        status: 'rate-limited',
        detail: `at most ${String(MAX_REQUESTS_PER_HOUR)} analyses can be requested per hour`,
        retryAfterSeconds: Math.ceil((HOUR_MS - (t - (accepted[0] as number))) / 1000),
      };
    }

    // 3. Resolver el PR y traer sus commits como ramas del checkout que lee el motor.
    const pr = await deps.github.fetchPr(prUrl);
    const repos = await deps.db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.workspaceId, orgId));
    const match = repos.find(
      (r) =>
        r.uri.toLowerCase().includes(slug.toLowerCase()) ||
        repoDisplayName(r).toLowerCase() === ref.repo.toLowerCase(),
    );
    if (!match?.local) {
      return {
        code: 404,
        status: 'repo-not-configured',
        detail: `${slug} has no local checkout in workspace ${orgId}`,
      };
    }
    try {
      await fetchPrRefs({
        localDir: match.local,
        remoteBase: deps.gitBase,
        owner: ref.owner,
        repo: ref.repo,
        number: ref.number,
        baseSha: pr.baseSha,
        headSha: pr.headSha,
      });
    } catch (e) {
      if (e instanceof PrRefsError)
        return { code: 502, status: 'git-fetch-failed', detail: e.message };
      throw e;
    }

    // 4. El camino normal. Un intento fallido anterior ocupa el mismo digest: se varía configHash.
    const attempts = mine.filter((a) => a.status === 'FAILED').length;
    try {
      const { assessment } = await createAssessment({
        db: deps.db,
        worker: deps.worker,
        body: { prUrl, orgId, configHash: `request-${String(attempts + 1)}` },
        analyzerVersion: deps.analyzerVersion,
        github: deps.github,
      });
      accepted.push(t);
      void deps.worker
        .run(assessment.id)
        .catch((err: unknown) => deps.onRunError?.(err, assessment.id));
      return { code: 202, status: 'started', assessmentId: assessment.id };
    } catch (e) {
      if (e instanceof NotFoundError)
        return { code: 404, status: 'repo-not-configured', detail: e.message };
      throw e;
    }
  };
}
