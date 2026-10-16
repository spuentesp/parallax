import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import {
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../src/worker/assessment-worker.js';
import { isTerminal } from '../src/worker/state.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

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

describe('AssessmentWorker deterministic clock (DST seam)', () => {
  it('honors the injected clock and sleep — no real timers, reproducible stamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parallax-clock-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'test.db'));
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    runMigrations(sqlite, join(__dirname, '../drizzle'));
    const db = drizzle(sqlite, { schema });
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: 0 });

    let tick = 1_000_000;
    const sleeps: number[] = [];
    // El mock real deja el snapshot 'pending' ~100ms: con sleep inyectado el
    // poll de awaitSnapshot corre sin esperar tiempo real.
    const worker = new AssessmentWorker(db, {
      getLain: async () => createLainMock(),
      now: () => (tick += 1),
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    const started = Date.now();
    const created = await worker.create(REQUEST);
    const record = await worker.run(created.assessment.id);
    await worker.drain();
    const elapsed = Date.now() - started;

    expect(isTerminal(record.status)).toBe(true);
    // Los timestamps salen del reloj inyectado (DST), no de Date.now().
    expect(created.assessment.createdAt).toBeGreaterThan(1_000_000);
    expect(created.assessment.createdAt).toBeLessThan(1_010_000);
    expect(record.completedAt).toBeGreaterThan(1_000_000);
    // El sleep inyectado fue usado (poll del snapshot) y nada esperó timers reales.
    expect(sleeps.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
  });
});
