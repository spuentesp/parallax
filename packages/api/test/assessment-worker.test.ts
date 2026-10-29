import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { getAssessmentReport } from '../src/services/assessments.js';
import {
  AssessmentWorker,
  describeError,
  type ResolvedAssessmentRequest,
} from '../src/worker/assessment-worker.js';
import { canTransition, computeInputDigest, PARALLAX_POLICY_VERSION } from '../src/worker/state.js';

function makeDb(dir: string) {
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../drizzle'));
  return drizzle(sqlite, { schema });
}

const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  ordersS1: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  ordersS2: '0931d02684c2d1f6df7f0353f6e6bdd6c07ecc2c',
  billing: '972651746b73f234031e3eae3c7b71b5d255d0ef',
};

function resolved(
  orgId: string,
  base: string,
  head: string,
  opts?: { excluded?: string[] },
): ResolvedAssessmentRequest {
  const others: Record<string, string> = { billing: SHAS.billing };
  const excluded = (opts?.excluded ?? []).map((repo) => ({ repo, reason: 'excluded' }));
  const excludedNames = new Set(excluded.map((e) => e.repo));
  const baseRepos: Record<string, string> = {};
  const headRepos: Record<string, string> = {};
  for (const [name, sha] of Object.entries(others)) {
    if (excludedNames.has(name)) continue;
    baseRepos[name] = sha;
    headRepos[name] = sha;
  }
  baseRepos.orders = base;
  headRepos.orders = head;
  return {
    orgId,
    manifest: {
      base: { repos: baseRepos },
      head: { repos: headRepos },
      configured: ['billing', 'orders'],
      excluded,
      configHash: null,
    },
  };
}

describe('AssessmentWorker', () => {
  let dir: string;
  let db: ReturnType<typeof makeDb>;
  let worker: AssessmentWorker;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-worker-'));
    db = makeDb(dir);
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
    worker = new AssessmentWorker(db, { getLain: async () => createLainMock() });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates an assessment with QUEUED status', async () => {
    const result = await worker.create(resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1));
    expect(result.created).toBe(true);
    expect(result.assessment.status).toBe('QUEUED');
    expect(result.assessment.orgId).toBe('org_demo');
    expect(result.assessment.inputDigest.startsWith('sha256_')).toBe(true);
  });

  it('idempotency: same resolved manifest returns same assessment (P INV 4)', async () => {
    const input = resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1);
    const first = await worker.create(input);
    const second = await worker.create(input);
    expect(second.created).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);
    const rows = await db.select().from(schema.assessment);
    expect(rows).toHaveLength(1);
  });

  it('different head SHA creates a new assessment', async () => {
    const a = await worker.create(resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1));
    const b = await worker.create(resolved('org_demo', SHAS.ordersBase, SHAS.ordersS2));
    expect(a.assessment.id).not.toBe(b.assessment.id);
  });

  it('transitions QUEUED → SNAPSHOTTING → ANALYZING → READY', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const s1 = await worker.transition(assessment.id, 'SNAPSHOTTING');
    expect(s1.status).toBe('SNAPSHOTTING');
    const s2 = await worker.transition(assessment.id, 'ANALYZING');
    expect(s2.status).toBe('ANALYZING');
    const s2b = await worker.transition(assessment.id, 'EXPLAINING');
    expect(s2b.status).toBe('EXPLAINING');
    const s3 = await worker.transition(assessment.id, 'READY', { engineJson: '{}' });
    expect(s3.status).toBe('READY');
    expect(s3.completedAt).toBeGreaterThan(0);
  });

  it('rejects invalid transitions', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    await expect(worker.transition(assessment.id, 'READY')).rejects.toThrow(/invalid transition/);
  });

  it('emits events on transitions', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const received: string[] = [];
    worker.subscribe(assessment.id, (e) => received.push(e.type));
    await worker.transition(assessment.id, 'SNAPSHOTTING');
    expect(received).toContain('transition');
    const events = await worker.events(assessment.id);
    expect(events.length).toBeGreaterThanOrEqual(2); // created + transition
  });

  it('run() drives the state machine with the engine and persists every artifact', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const final = await worker.run(assessment.id);
    // El mock deja 'reports' como unreviewed → el informe es honesto: PARTIAL.
    expect(['READY', 'PARTIAL']).toContain(final.status);
    expect(final.baseId).toMatch(/^snap_/);
    expect(final.headId).toMatch(/^snap_/);
    expect(final.engineJson).toBeTruthy();
    expect(final.coverageJson).toBeTruthy();

    const manifest = JSON.parse(final.manifestJson) as {
      snapshots?: { base: string; head: string };
    };
    expect(manifest.snapshots?.base).toBe(final.baseId);
    expect(manifest.snapshots?.head).toBe(final.headId);

    const engine = JSON.parse(final.engineJson ?? '{}') as {
      diff?: { changes?: Array<{ kind?: string; field?: string }> };
    };
    expect(engine.diff?.changes?.some((c) => c.kind === 'FieldRemoved')).toBe(true);

    const coverage = JSON.parse(final.coverageJson ?? '{}') as {
      complete?: boolean;
      missing?: string[];
      scope?: { unreviewed?: Array<{ repo?: string; reason?: string }> };
    };
    expect(coverage.complete).toBe(false);
    expect(coverage.scope?.unreviewed?.some((n) => n.repo === 'reports')).toBe(true);
    // INV 3: la omisión del motor queda declarada, no silenciada.
    expect(coverage.missing?.some((m) => m.includes('reports'))).toBe(true);
    if (final.status === 'PARTIAL') {
      expect(coverage.missing?.length).toBeGreaterThan(0);
    }

    const steps = await db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.assessmentId, assessment.id));
    const byStep = new Map(steps.map((s) => [s.step, s.state]));
    expect(byStep.get('snapshot')).toBe('done');
    expect(byStep.get('analyze')).toBe('done');
    expect(byStep.get('explain')).toBe('done');

    const explanations = await db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, assessment.id));
    expect(explanations).toHaveLength(1);
    // Sin modelo configurado (P08): el fallo es visible, no un silencio.
    expect(explanations[0]?.status).toBe('failed:no_model_configured');
    expect(explanations[0]?.model).toBe('none');
  });

  it('run() is idempotent on a terminal assessment', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const first = await worker.run(assessment.id);
    const second = await worker.run(assessment.id);
    expect(second.status).toBe(first.status);
    expect(second.completedAt).toBe(first.completedAt);
  });

  it('G3: an injected explain runs in EXPLAINING and engine findings stay untouched (INV 2)', async () => {
    const seen: Array<{ viewId: string; engineFindings: unknown[] }> = [];
    const g3worker = new AssessmentWorker(db, {
      getLain: async () => createLainMock(),
      explain: async (args) => {
        seen.push({ viewId: args.viewId, engineFindings: args.engineFindings });
        return {
          status: 'available',
          model: 'fake/nemotron',
          payload: {
            narrative: 'Todo Verified',
            engine_finding_classes: [],
          },
        };
      },
    });
    const { assessment } = await g3worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const final = await g3worker.run(assessment.id);
    expect(['READY', 'PARTIAL']).toContain(final.status);
    expect(seen).toHaveLength(1);
    // La vista de la explicación es el head fijado por el análisis.
    expect(seen[0]?.viewId).toBe(final.headId);

    const explanations = await db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, assessment.id));
    expect(explanations[0]?.status).toBe('available');
    expect(explanations[0]?.model).toBe('fake/nemotron');
    expect(explanations[0]?.payload).toContain('Todo Verified');

    // INV 2: el engine_json del motor sigue intacto — la prosa "Todo Verified"
    // no reescribe ninguna clasificación: los cambios son exactamente los del
    // motor (FieldRemoved sin impacto promovido).
    const rec = await g3worker.get(assessment.id);
    const engine = JSON.parse(rec?.engineJson ?? '{}') as {
      diff?: { changes?: Array<{ kind?: string; impact?: { class?: string } }> };
    };
    const changes = engine.diff?.changes ?? [];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.kind === 'FieldRemoved')).toBe(true);
    expect(changes.every((c) => c.impact?.class !== 'Verified')).toBe(true);
    // El payload del modelo y el artefacto del motor viven en columnas distintas.
    expect(rec?.engineJson).not.toContain('Todo Verified');
  });

  it('G3: an explain failure is recorded as failed status, never destroying the report', async () => {
    const g3worker = new AssessmentWorker(db, {
      getLain: async () => createLainMock(),
      explain: async () => {
        throw new Error('Nemotron HTTP 500');
      },
    });
    const { assessment } = await g3worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const final = await g3worker.run(assessment.id);
    expect(['READY', 'PARTIAL']).toContain(final.status);
    const explanations = await db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, assessment.id));
    expect(explanations[0]?.status).toBe('failed:explain_error');
    expect(explanations[0]?.payload).toContain('Nemotron HTTP 500');
    // El informe estructural existe pese al fallo del modelo (P08).
    expect(final.engineJson).toBeTruthy();
  });

  it('recovery resumes non-terminal assessments through the runner (INV 5)', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    await worker.transition(assessment.id, 'SNAPSHOTTING');
    // Simulate restart: fresh worker (and fresh engine client) on the same DB.
    const worker2 = new AssessmentWorker(db, { getLain: async () => createLainMock() });
    const recovered = await worker2.recover();
    expect(recovered).toContain(assessment.id);
    const after = await worker2.get(assessment.id);
    expect(['READY', 'PARTIAL']).toContain(after?.status);
    expect(after?.engineJson).toBeTruthy();
    // No se crea un segundo trabajo para el mismo manifiesto.
    const rows = await db.select().from(schema.assessment);
    expect(rows).toHaveLength(1);
  });

  it('recovery leaves terminal assessments untouched and readable', async () => {
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    const done = await worker.run(assessment.id);
    const worker2 = new AssessmentWorker(db, { getLain: async () => createLainMock() });
    const recovered = await worker2.recover();
    expect(recovered).not.toContain(assessment.id);
    const after = await worker2.get(assessment.id);
    expect(after?.status).toBe(done.status);
    expect(after?.engineJson).toBe(done.engineJson);
  });

  it('fails with the cause when no engine is configured', async () => {
    const bare = new AssessmentWorker(db);
    const { assessment } = await bare.create(resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1));
    const final = await bare.run(assessment.id);
    expect(final.status).toBe('FAILED');
    expect(final.engineJson).toContain('no LAIN configured for workspace');
  });

  it('canTransition returns correct values', () => {
    expect(canTransition('QUEUED', 'SNAPSHOTTING')).toBe(true);
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('READY', 'ANALYZING')).toBe(false);
    expect(canTransition('ANALYZING', 'FAILED')).toBe(true);
  });

  it('computeInputDigest is deterministic, SHA-256 and model-free', () => {
    const manifest = {
      base: { orders: SHAS.ordersBase, billing: SHAS.billing },
      head: { orders: SHAS.ordersS1, billing: SHAS.billing },
    };
    const input = { manifest, analyzerVersion: '0.9.1', configHash: 'cfg1' };
    const d1 = computeInputDigest(input);
    const d2 = computeInputDigest(input);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^sha256_[0-9a-f]{64}$/);
    // Key order does not matter.
    const reordered = {
      manifest: {
        base: { billing: SHAS.billing, orders: SHAS.ordersBase },
        head: { billing: SHAS.billing, orders: SHAS.ordersS1 },
      },
      analyzerVersion: '0.9.1',
      configHash: 'cfg1',
    };
    expect(computeInputDigest(reordered)).toBe(d1);
    // Different SHA → different digest.
    expect(
      computeInputDigest({
        ...input,
        manifest: { ...manifest, head: { ...manifest.head, orders: SHAS.ordersS2 } },
      }),
    ).not.toBe(d1);
    // Different analyzer version or policy → different digest.
    expect(computeInputDigest({ ...input, analyzerVersion: '0.9.2' })).not.toBe(d1);
    expect(computeInputDigest({ ...input, policyVersion: '2' })).not.toBe(d1);
    expect(PARALLAX_POLICY_VERSION).toBe('1');
  });
});

describe('AssessmentWorker analyze step — which view each finding is traced in', () => {
  let dir: string;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-worker-trace-'));
    db = makeDb(dir);
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const change = (kind: string, service: string, key: string, extra: object = {}) => ({
    kind,
    endpoint: { service, key },
    impact: { class: 'NeedsInvestigation', reasons: ['x'] },
    ...extra,
  });

  it('traces a removed endpoint in the BASE view, an added one in head, and skips consumer-side changes', async () => {
    const seen: Array<{ key: string; snapshot: string }> = [];
    const mock = createLainMock();
    const lain = {
      ...mock,
      async diffContracts(req: Parameters<typeof mock.diffContracts>[0]) {
        const d = await mock.diffContracts(req);
        return {
          ...d,
          changes: [
            change('ConsumerEndpointUnmatched', 'billing', 'http:GET /orders/{}', {
              side: 'consumer',
            }),
            change('EndpointRemoved', 'orders', 'http:GET /orders/{}'),
            change('EndpointAdded', 'orders', 'http:POST /orders/bulk'),
          ],
        };
      },
      async traceImpact(req: Parameters<typeof mock.traceImpact>[0]) {
        const from = req.from as { endpoint: { key: string } };
        seen.push({ key: from.endpoint.key, snapshot: req.snapshot });
        return mock.traceImpact(req);
      },
    } as unknown as typeof mock;
    const worker = new AssessmentWorker(db, { getLain: async () => lain });
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    await worker.run(assessment.id);
    const rec = await worker.get(assessment.id);

    expect(rec?.baseId).toBeTruthy();
    expect(rec?.headId).toBeTruthy();
    expect(rec?.baseId).not.toBe(rec?.headId);
    expect(seen).toEqual([
      { key: 'http:GET /orders/{}', snapshot: rec?.baseId },
      { key: 'http:POST /orders/bulk', snapshot: rec?.headId },
    ]);
    const cov = JSON.parse(rec?.coverageJson ?? '{}') as { missing?: string[] };
    // Ningún hueco de cobertura por trazar en la vista equivocada.
    expect((cov.missing ?? []).filter((m) => m.startsWith('trace_impact'))).toEqual([]);
  });

  it('declares the contracts it did not trace instead of cutting the list silently', async () => {
    const traced: string[] = [];
    const mock = createLainMock();
    const many = Array.from({ length: 11 }, (_, i) =>
      change('EndpointAdded', 'orders', `http:POST /orders/bulk${String(i)}`),
    );
    const lain = {
      ...mock,
      async diffContracts(req: Parameters<typeof mock.diffContracts>[0]) {
        const d = await mock.diffContracts(req);
        return { ...d, changes: many };
      },
      async traceImpact(req: Parameters<typeof mock.traceImpact>[0]) {
        traced.push((req.from as { endpoint: { key: string } }).endpoint.key);
        return mock.traceImpact(req);
      },
    } as unknown as typeof mock;
    const worker = new AssessmentWorker(db, { getLain: async () => lain });
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    await worker.run(assessment.id);
    const rec = await worker.get(assessment.id);
    const cov = JSON.parse(rec?.coverageJson ?? '{}') as { missing?: string[]; complete?: boolean };
    expect(traced).toHaveLength(8);
    expect((cov.missing ?? []).find((m) => m.startsWith('trace_impact skipped'))).toBe(
      'trace_impact skipped for 3 of 11 changed contracts (limit 8): their impact is not traced',
    );
    // Con trazas sin hacer, el informe no puede presentarse como completo.
    expect(rec?.status).toBe('PARTIAL');
  });

  it('records an engine failure in the coverage with its code and message, not [object Object]', async () => {
    const mock = createLainMock();
    const lain = {
      ...mock,
      async diffContracts(req: Parameters<typeof mock.diffContracts>[0]) {
        const d = await mock.diffContracts(req);
        return { ...d, changes: [change('EndpointAdded', 'orders', 'http:POST /orders/bulk')] };
      },
      async traceImpact() {
        // El adaptador lanza objetos planos {code, message}, no instancias de Error.
        throw { code: 'LainUnavailable', message: 'endpoint is not present in the selected view' };
      },
    } as unknown as typeof mock;
    const worker = new AssessmentWorker(db, { getLain: async () => lain });
    const { assessment } = await worker.create(
      resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1),
    );
    await worker.run(assessment.id);
    const rec = await worker.get(assessment.id);
    const cov = JSON.parse(rec?.coverageJson ?? '{}') as { missing?: string[] };
    const gap = (cov.missing ?? []).find((m) => m.startsWith('trace_impact failed'));
    expect(gap).toBe(
      'trace_impact failed for orders http:POST /orders/bulk: LainUnavailable: endpoint is not present in the selected view',
    );
    expect(rec?.status).toBe('PARTIAL');
  });
});

describe('AssessmentWorker — code impact step (PR review)', () => {
  let dir: string;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-codeimpact-'));
    db = makeDb(dir);
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const PR = { owner: 'acme', repo: 'orders', number: 7, repoId: 'orders', name: 'orders' };
  const PATCH = '@@ -9,2 +9,2 @@\n def charge():\n-    return 1\n+    return 2';
  const symbolsOf = JSON.stringify([
    {
      global_id: 'orders:Function:src/pay.py:charge:7',
      kind: 'Function',
      name: 'charge',
      path: 'src/pay.py',
      repo_id: 'orders',
    },
  ]);

  /** El motor: contratos del mock, y las cuatro respuestas de código de una revisión. */
  const lainWithCode = () => {
    const mock = createLainMock();
    return {
      ...mock,
      async codeTool(tool: string) {
        const text =
          tool === 'get_capabilities'
            ? JSON.stringify({
                repositories: [{ id: 'orders', last_indexed_commit: SHAS.ordersBase }],
              })
            : tool === 'search_org'
              ? symbolsOf
              : tool === 'find_symbol'
                ? '1. `11111111-2222-3333-4444-555555555555` function src/pay.py:8 anchor=0.5'
                : '## assess_change: charge\n\n## Direct dependents\n\n- **checkout** (src/checkout.py) calls it at line 4\n\n## Test coverage\n\nNo test calls this symbol, directly or through its callers.\n\n## Risk summary\n\nDirect: 1; transitive: 3; verdict: **medium**.';
        return { text };
      },
    } as unknown as ReturnType<typeof createLainMock>;
  };

  const request = (withPr: boolean): ResolvedAssessmentRequest => {
    const r = resolved('org_demo', SHAS.ordersBase, SHAS.ordersS1);
    return withPr ? { ...r, manifest: { ...r.manifest, pr: PR } } : r;
  };

  it('reads the PR files, reviews the code, records the step and puts the result in the report', async () => {
    const asked: unknown[] = [];
    const worker = new AssessmentWorker(db, {
      getLain: async () => lainWithCode(),
      github: {
        async listFilesAtCommits(ref, base, head) {
          asked.push({ ref, base, head });
          return {
            files: [
              { path: 'src/pay.py', status: 'modified', additions: 1, deletions: 1, patch: PATCH },
            ],
            truncated: false,
          };
        },
      },
    });
    const { assessment } = await worker.create(request(true));
    await worker.run(assessment.id);

    expect(asked).toEqual([
      {
        ref: { owner: 'acme', repo: 'orders', number: 7 },
        base: SHAS.ordersBase,
        head: SHAS.ordersS1,
      },
    ]);
    const steps = await db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.assessmentId, assessment.id));
    expect(steps.find((x) => x.step === 'code_impact')?.state).toBe('done');

    const report = await getAssessmentReport(db, assessment.id);
    expect(report?.codeImpact?.symbols).toHaveLength(1);
    expect(report?.codeImpact?.symbols[0]).toMatchObject({
      name: 'charge',
      path: 'src/pay.py',
      direct: 1,
      transitive: 3,
      risk: 'medium',
      untested: true,
    });
    // Los contratos siguen siendo lo suyo: la revisión de código no los toca.
    expect(report?.findings.length).toBeGreaterThan(0);
    expect(report?.codeImpact?.index.matchesBase).toBe(true);
  });

  it('a failing GitHub read is a declared gap and the contract report still completes', async () => {
    const worker = new AssessmentWorker(db, {
      getLain: async () => lainWithCode(),
      github: {
        async listFilesAtCommits() {
          throw new Error('GitHub down');
        },
      },
    });
    const { assessment } = await worker.create(request(true));
    const done = await worker.run(assessment.id);

    expect(done.status).toBe('PARTIAL');
    const cov = JSON.parse(done.coverageJson ?? '{}') as { missing?: string[] };
    expect(cov.missing).toContain('code impact failed: GitHub down');
    const engine = JSON.parse(done.engineJson ?? '{}') as { diff?: unknown; codeImpact?: unknown };
    expect(engine.diff).toBeDefined();
    expect(engine.codeImpact).toBeNull();
    const steps = await db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.assessmentId, assessment.id));
    expect(steps.find((x) => x.step === 'code_impact')?.state).toBe('failed');
  });

  it('an evaluation that did not come from a PR has no code review and no step', async () => {
    const worker = new AssessmentWorker(db, {
      getLain: async () => lainWithCode(),
      github: {
        async listFilesAtCommits() {
          throw new Error('must not be called');
        },
      },
    });
    const { assessment } = await worker.create(request(false));
    const done = await worker.run(assessment.id);
    expect(done.status).not.toBe('FAILED');
    const steps = await db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.assessmentId, assessment.id));
    expect(steps.map((x) => x.step)).not.toContain('code_impact');
    expect((await getAssessmentReport(db, assessment.id))?.codeImpact).toBeUndefined();
  });

  it('distinguishes PR and manual assessments of the same commits', async () => {
    const worker = new AssessmentWorker(db, { getLain: async () => lainWithCode() });
    const a = await worker.create(request(true));
    const b = await worker.create(request(false));
    expect(b.created).toBe(true);
    expect(b.assessment.id).not.toBe(a.assessment.id);
  });
});

describe('describeError', () => {
  it('reads Error instances, engine error objects, and anything else', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError({ code: 'X', message: 'm' })).toBe('X: m');
    expect(describeError({ message: 'only message' })).toBe('only message');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(undefined)).toBe('undefined');
  });
});
