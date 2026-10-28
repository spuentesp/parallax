import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-recovery-'));
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
    excluded: [],
    configHash: null,
  },
};

describe('composición: crash simulado → recover → READY legible', () => {
  it('reanuda trabajos no terminales y nunca re-ejecuta uno terminado', async () => {
    const { worker } = await makeHarness();
    const created = await worker.create(REQUEST);

    // Crash simulado: el trabajo queda en SNAPSHOTTING (no terminal).
    await worker.transition(created.assessment.id, 'SNAPSHOTTING');
    const resumed = await worker.recover();
    expect(resumed).toContain(created.assessment.id);

    const after = await worker.get(created.assessment.id);
    expect(after).not.toBeNull();
    if (after === null) return;
    expect(isTerminal(after.status)).toBe(true);

    // INV 5: un READY/PARTIAL legible no vuelve a ejecutarse.
    const completedAt = after.completedAt;
    const resumedAgain = await worker.recover();
    expect(resumedAgain).not.toContain(created.assessment.id);
    const final = await worker.get(created.assessment.id);
    expect(final?.status).toBe(after.status);
    expect(final?.completedAt).toBe(completedAt);
    await worker.drain();
  });
});
