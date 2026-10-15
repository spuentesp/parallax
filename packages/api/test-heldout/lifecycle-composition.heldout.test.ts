import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { buildCommentPreview } from '../src/github/comment-preview.js';
import { getAssessmentReport } from '../src/services/assessments.js';
import {
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../src/worker/assessment-worker.js';
import { isTerminal } from '../src/worker/state.js';
import { createInstantLain } from '../test/prop/worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

async function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../drizzle'));
  const db = drizzle(sqlite, { schema });
  await db
    .insert(schema.workspace)
    .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  const worker = new AssessmentWorker(db, { getLain: async () => createInstantLain() });
  return { worker, db, dir };
}

const REQUEST: ResolvedAssessmentRequest = {
  orgId: 'org_demo',
  manifest: {
    base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
    head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
    configured: ['orders'],
    excluded: [{ repo: 'legacy', reason: 'excluded' }],
    configHash: null,
  },
};

describe('composición: ciclo completo create → run → report → comment preview', () => {
  it('mantiene identidad, INV 3 e INV 4 a través de todas las capas', async () => {
    const { worker, db } = await makeHarness();

    // INV 4: el segundo create con el mismo input reutiliza el trabajo.
    const first = await worker.create(REQUEST);
    const second = await worker.create(REQUEST);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);

    const record = await worker.run(first.assessment.id);
    await worker.drain();
    expect(isTerminal(record.status)).toBe(true);
    expect(['READY', 'PARTIAL']).toContain(record.status);

    // El log de eventos tiene seqs únicos y estrictamente crecientes.
    const events = await worker.events(first.assessment.id);
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // Composición con services + github: el informe y el preview coinciden.
    const report = await getAssessmentReport(db, first.assessment.id);
    expect(report).not.toBeNull();
    if (report === null) return;
    const preview = buildCommentPreview(report);
    expect(preview.evaluated.assessmentId).toBe(first.assessment.id);
    expect(preview.markdown.length).toBeGreaterThan(0);

    // INV 3 visible en ambas capas: la exclusión nunca es "revisado".
    const coverage = report.coverage as {
      complete: boolean;
      scope: { reviewed: string[]; excluded: Array<{ repo: string; reason: string }> };
    };
    expect(coverage.scope.reviewed).not.toContain('legacy');
    expect(coverage.scope.excluded.map((n) => n.repo)).toContain('legacy');
    expect(preview.coverage.notReviewed.map((n) => n.repo)).toContain('legacy');
  });
});
