// Servicio de evaluaciones — la única puerta de entrada para crear y leer
// informes. Las rutas HTTP y las tools MCP llaman a estas mismas funciones,
// de modo que identidad, hallazgos y cobertura coinciden siempre (P09).

import type {
  AssessmentFinding,
  AssessmentReport,
  PresentedCoverage,
} from '@parallax/shared/domain';
import { AssessmentRequestBody } from '@parallax/shared/domain';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import type { GitHubReader, PrSummary } from '../github/reader.js';
import { LainCallError } from '../lain-adapter/errors.js';
import type {
  AssessmentRecord,
  AssessmentWorker,
  ResolvedAssessmentRequest,
} from '../worker/assessment-worker.js';
import { computeInputDigest } from '../worker/state.js';

type Db = BetterSQLite3Database<typeof schema>;

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

// El contrato del request vive en @parallax/shared: única fuente de verdad
// para API y web (nadie lo reescribe a mano).
export { AssessmentRequestBody };

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// §4: un mismo idempotency_key con otro cuerpo se rechaza.
export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

// Modelo servido por HTTP/MCP: derivado del contrato compartido (z.infer).
export type AssessmentApiModel = AssessmentReport;

// El nombre LAIN de un repo es el basename de su ruta local o URI: el motor
// identifica los repos del snapshot por el id del directorio del fixture.
export function repoDisplayName(repo: { uri: string; local: string | null }): string {
  const raw = (repo.local ?? repo.uri).split('/').filter(Boolean).pop() ?? repo.uri;
  return raw.endsWith('.git') ? raw.slice(0, -4) : raw;
}

function _notImplemented(what: string): never {
  throw LainCallError.parse({ code: 'NotImplemented', message: what, doc: SPEC_DOC });
}

// §5: el PR aporta base/head; los demás repos del workspace usan el mismo
// manifiesto de commits en ambas vistas. Los repos sin SHA quedan fuera del
// alcance con causa explícita (INV 3: la omisión es visible).
export async function resolveAssessmentRequest(
  db: Db,
  body: AssessmentRequestBody,
  analyzerVersion: string,
  deps: { github?: GitHubReader } = {},
): Promise<{ request: ResolvedAssessmentRequest; digest: string; pr?: PrSummary }> {
  if ('prUrl' in body) {
    // Dry run: el adapter sólo lee. Resuelve la URL a SHAs, nunca publica.
    if (!deps.github) {
      throw new NotFoundError(
        'PR URL resolution needs the GitHub reader; it is read-only and posts nothing',
      );
    }
    const pr = await deps.github.fetchPr(body.prUrl);
    // El PR identifica el repo como owner/repo; el manifiesto usa el nombre
    // del workspace. Se resuelve aquí para que no haya dos vocabularios.
    const repoRows = await db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.workspaceId, body.orgId));
    const slug = `${pr.ref.owner}/${pr.ref.repo}`.toLowerCase();
    const match = repoRows.find((r) => {
      const uri = r.uri.toLowerCase();
      return uri.includes(slug) || repoDisplayName(r).toLowerCase() === pr.ref.repo.toLowerCase();
    });
    if (!match) {
      throw new NotFoundError(`PR repo ${slug} is not configured in workspace ${body.orgId}`);
    }
    return resolveAssessmentRequest(
      db,
      {
        repo: repoDisplayName(match),
        base: pr.baseSha,
        head: pr.headSha,
        orgId: body.orgId,
        ...(body.configHash !== undefined ? { configHash: body.configHash } : {}),
        ...(body.excludeRepos !== undefined ? { excludeRepos: body.excludeRepos } : {}),
        ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
      },
      analyzerVersion,
      deps,
    ).then((r) => ({ ...r, pr }));
  }

  const ws = await db
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, body.orgId))
    .limit(1);
  if (!ws[0]) throw new NotFoundError(`workspace ${body.orgId} not found`);

  const repos = await db.select().from(schema.repo).where(eq(schema.repo.workspaceId, body.orgId));
  const prRepo = body.repo;
  const baseSha = body.base.toLowerCase();
  const headSha = body.head.toLowerCase();

  const excluded: Array<{ repo: string; reason: string }> = (body.excludeRepos ?? [])
    .filter((repo) => repo !== prRepo)
    .map((repo) => ({ repo, reason: 'excluded' }));
  const excludedNames = new Set(excluded.map((e) => e.repo));

  const configured = new Set<string>([prRepo]);
  const baseRepos: Record<string, string> = {};
  const headRepos: Record<string, string> = {};
  for (const repo of repos) {
    const name = repoDisplayName(repo);
    configured.add(name);
    if (name === prRepo) continue;
    if (excludedNames.has(name)) continue;
    if (!repo.sha) {
      excluded.push({ repo: name, reason: 'unpinned_sha' });
      excludedNames.add(name);
      continue;
    }
    baseRepos[name] = repo.sha.toLowerCase();
    headRepos[name] = repo.sha.toLowerCase();
  }
  baseRepos[prRepo] = baseSha;
  headRepos[prRepo] = headSha;

  const manifest = {
    base: { repos: baseRepos },
    head: { repos: headRepos },
    configured: [...configured].sort(),
    excluded,
    configHash: body.configHash ?? null,
  };
  const digest = computeInputDigest({
    manifest: { base: baseRepos, head: headRepos },
    configHash: body.configHash ?? null,
    analyzerVersion,
  });
  return { request: { orgId: body.orgId, manifest }, digest };
}

export async function createAssessment(deps: {
  db: Db;
  worker: AssessmentWorker;
  body: AssessmentRequestBody;
  analyzerVersion: string;
  /** Lector de GitHub, sólo para resolver una URL de PR a SHAs. Nunca escribe. */
  github?: GitHubReader;
}): Promise<{ assessment: AssessmentRecord; created: boolean; pr?: PrSummary }> {
  const { db, worker, body, analyzerVersion, github } = deps;
  const { request, digest, pr } = await resolveAssessmentRequest(db, body, analyzerVersion, {
    ...(github ? { github } : {}),
  });

  if (body.idempotencyKey) {
    const bound = await worker.findIdempotencyKey(body.idempotencyKey);
    if (bound) {
      if (bound.digest !== digest) {
        throw new IdempotencyConflictError(
          `idempotency_key ${body.idempotencyKey} was used with a different request body`,
        );
      }
      const existing = await worker.get(bound.assessmentId);
      if (existing) return { assessment: existing, created: false, ...(pr ? { pr } : {}) };
    }
  }

  const result = await worker.create(request);
  if (body.idempotencyKey && result.created) {
    await worker.recordIdempotencyKey(result.assessment.id, body.idempotencyKey, digest);
  }
  return { ...result, ...(pr ? { pr } : {}) };
}

function parseJson(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Resumen para el listado: sin el output crudo del motor, que pesa y sólo
// hace falta al abrir un informe.
export async function listAssessments(
  db: Db,
  opts: { orgId?: string } = {},
): Promise<
  Array<{
    id: string;
    orgId: string;
    status: string;
    inputDigest: string;
    findingCount: number;
    coverageComplete: boolean;
    coverageSummary: string | null;
    createdAt: number;
    completedAt: number | null;
  }>
> {
  const rows = opts.orgId
    ? await db
        .select()
        .from(schema.assessment)
        .where(eq(schema.assessment.orgId, opts.orgId))
        .orderBy(schema.assessment.createdAt)
    : await db.select().from(schema.assessment).orderBy(schema.assessment.createdAt);

  return rows.map((r) => {
    const engine = parseJson(r.engineJson) as { diff?: { changes?: unknown[] } } | null;
    const coverage = parseJson(r.coverageJson) as { complete?: boolean; summary?: string } | null;
    return {
      id: r.id,
      orgId: r.orgId,
      status: r.status,
      inputDigest: r.inputDigest,
      findingCount: Array.isArray(engine?.diff?.changes) ? engine.diff.changes.length : 0,
      coverageComplete: coverage?.complete ?? false,
      coverageSummary: coverage?.summary ?? null,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  });
}

export async function getAssessmentRecord(db: Db, id: string): Promise<AssessmentRecord | null> {
  const row = await db
    .select()
    .from(schema.assessment)
    .where(eq(schema.assessment.id, id))
    .limit(1);
  return row[0]
    ? {
        id: row[0].id as AssessmentRecord['id'],
        orgId: row[0].orgId as AssessmentRecord['orgId'],
        inputDigest: row[0].inputDigest,
        status: row[0].status as AssessmentRecord['status'],
        baseId: row[0].baseId,
        headId: row[0].headId,
        manifestJson: row[0].manifestJson,
        engineJson: row[0].engineJson,
        coverageJson: row[0].coverageJson,
        createdAt: row[0].createdAt,
        completedAt: row[0].completedAt,
      }
    : null;
}

// El informe completo y persistido: identidad, hallazgos del motor, cobertura
// presentada y evidencia. Es lo único que HTTP y MCP sirven (P09).
export async function getAssessmentReport(db: Db, id: string): Promise<AssessmentApiModel | null> {
  const rec = await getAssessmentRecord(db, id);
  if (!rec) return null;

  const engine = parseJson(rec.engineJson) as {
    diff?: { changes?: unknown[] };
    error?: string;
  } | null;
  const coverage = parseJson(rec.coverageJson) as PresentedCoverage;
  const manifest = parseJson(rec.manifestJson);

  const evidenceRows = await db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.assessmentId, id));
  const explanationRows = await db
    .select()
    .from(schema.explanation)
    .where(eq(schema.explanation.assessmentId, id));
  const latestExplanation = explanationRows.sort((a, b) => b.revision - a.revision)[0];

  // El borde del motor: los cambios llegan como JSON y se tipan contra el
  // contrato compartido (AssessmentFinding) aquí, y en ningún otro lado.
  const findings: AssessmentFinding[] =
    engine && typeof engine === 'object' && Array.isArray(engine.diff?.changes)
      ? (engine.diff.changes as AssessmentFinding[])
      : [];

  return {
    id: rec.id,
    orgId: rec.orgId,
    inputDigest: rec.inputDigest,
    status: rec.status,
    baseId: rec.baseId,
    headId: rec.headId,
    manifest,
    findings,
    engine,
    coverage,
    evidence: evidenceRows.map((e) => ({
      id: e.id,
      viewId: e.viewId,
      repo: e.repo,
      sha: e.sha,
      path: e.path,
      range: parseJson(e.rangeJson),
      hash: e.hash,
    })),
    explanation: latestExplanation
      ? {
          status: latestExplanation.status,
          revision: latestExplanation.revision,
          model: latestExplanation.model,
        }
      : { status: 'pending', revision: null, model: null },
    createdAt: rec.createdAt,
    completedAt: rec.completedAt,
  };
}
