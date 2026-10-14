// Servicio de evaluaciones — la única puerta de entrada para crear y leer
// informes. Las rutas HTTP y las tools MCP llaman a estas mismas funciones,
// de modo que identidad, hallazgos y cobertura coinciden siempre (P09).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { LainCallError } from '../lain-adapter/errors.js';
import {
  type AssessmentRecord,
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../worker/assessment-worker.js';
import { computeInputDigest } from '../worker/state.js';

type Db = BetterSQLite3Database<typeof schema>;

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

// Todo SHA se resuelve al admitir la solicitud (§5): un nombre de rama no
// funciona como identidad persistente.
const ResolvedSha = z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'expected a resolved commit SHA');

const OptionalAssessmentFields = {
  configHash: z.string().min(1).max(200).optional(),
  excludeRepos: z.array(z.string().min(1).max(200)).max(100).optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
};

export const AssessmentRequestBody = z.union([
  z.object({
    prUrl: z.string().url(),
    orgId: z.string().min(1),
    ...OptionalAssessmentFields,
  }),
  z.object({
    repo: z.string().min(1),
    base: ResolvedSha,
    head: ResolvedSha,
    orgId: z.string().min(1),
    ...OptionalAssessmentFields,
  }),
]);
export type AssessmentRequestBody = z.infer<typeof AssessmentRequestBody>;

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

export interface AssessmentApiModel {
  id: string;
  orgId: string;
  inputDigest: string;
  status: string;
  baseId: string | null;
  headId: string | null;
  manifest: unknown;
  findings: unknown[];
  engine: unknown;
  coverage: unknown;
  evidence: Array<{
    id: string;
    viewId: string;
    repo: string;
    sha: string;
    path: string;
    range: unknown;
    hash: string;
  }>;
  explanation: { status: string; revision: number | null; model: string | null };
  createdAt: number;
  completedAt: number | null;
}

// El nombre LAIN de un repo es el basename de su ruta local o URI: el motor
// identifica los repos del snapshot por el id del directorio del fixture.
export function repoDisplayName(repo: { uri: string; local: string | null }): string {
  const raw = (repo.local ?? repo.uri).split('/').filter(Boolean).pop() ?? repo.uri;
  return raw.endsWith('.git') ? raw.slice(0, -4) : raw;
}

function notImplemented(what: string): never {
  throw LainCallError.parse({ code: 'NotImplemented', message: what, doc: SPEC_DOC });
}

// §5: el PR aporta base/head; los demás repos del workspace usan el mismo
// manifiesto de commits en ambas vistas. Los repos sin SHA quedan fuera del
// alcance con causa explícita (INV 3: la omisión es visible).
export async function resolveAssessmentRequest(
  db: Db,
  body: AssessmentRequestBody,
  analyzerVersion: string,
): Promise<{ request: ResolvedAssessmentRequest; digest: string }> {
  if ('prUrl' in body) {
    notImplemented(
      'PR URL resolution requires the GitHub adapter (G4); send repo + resolved base/head SHAs',
    );
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
}): Promise<{ assessment: AssessmentRecord; created: boolean }> {
  const { db, worker, body, analyzerVersion } = deps;
  const { request, digest } = await resolveAssessmentRequest(db, body, analyzerVersion);

  if (body.idempotencyKey) {
    const bound = await worker.findIdempotencyKey(body.idempotencyKey);
    if (bound) {
      if (bound.digest !== digest) {
        throw new IdempotencyConflictError(
          `idempotency_key ${body.idempotencyKey} was used with a different request body`,
        );
      }
      const existing = await worker.get(bound.assessmentId);
      if (existing) return { assessment: existing, created: false };
    }
  }

  const result = await worker.create(request);
  if (body.idempotencyKey && result.created) {
    await worker.recordIdempotencyKey(result.assessment.id, body.idempotencyKey, digest);
  }
  return result;
}

function parseJson(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function getAssessmentRecord(db: Db, id: string): Promise<AssessmentRecord | null> {
  const row = await db.select().from(schema.assessment).where(eq(schema.assessment.id, id)).limit(1);
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
export async function getAssessmentReport(
  db: Db,
  id: string,
): Promise<AssessmentApiModel | null> {
  const rec = await getAssessmentRecord(db, id);
  if (!rec) return null;

  const engine = parseJson(rec.engineJson) as
    | { diff?: { changes?: unknown[] }; error?: string }
    | null;
  const coverage = parseJson(rec.coverageJson);
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

  const findings =
    engine && typeof engine === 'object' && Array.isArray(engine.diff?.changes)
      ? engine.diff.changes
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
      ? { status: latestExplanation.status, revision: latestExplanation.revision, model: latestExplanation.model }
      : { status: 'pending', revision: null, model: null },
    createdAt: rec.createdAt,
    completedAt: rec.completedAt,
  };
}
