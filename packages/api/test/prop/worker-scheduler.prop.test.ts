import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { getLainMockCalls, resetLainMock } from '../../src/lain-adapter/record.js';
import type { LainAdapter } from '../../src/lain-adapter/types.js';
import {
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../../src/worker/assessment-worker.js';
import { isTerminal } from '../../src/worker/state.js';
import { arbRequest } from './arbitraries.js';
import { fcDefaults } from './harness.js';
import { createInstantLain } from './worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-sched-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../../drizzle'));
  return drizzle(sqlite, { schema });
}

describe('AssessmentWorker interleaving properties', () => {
  it('concurrent create() with the same request: exactly one created (INV 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        arbRequest,
        async (sched: fc.Scheduler, request: ResolvedAssessmentRequest) => {
          const db = makeDb();
          await db
            .insert(schema.workspace)
            .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
          // El punto de intercalación es la costura inyectada getLain.
          const scheduledGetLain = sched.scheduleFunction(
            async (_orgId: string): Promise<LainAdapter> => createInstantLain(),
          );
          const worker = new AssessmentWorker(db, { getLain: scheduledGetLain });

          const [a, b] = await sched.waitFor(
            Promise.all([worker.create(request), worker.create(request)]),
          );

          const createdCount = [a, b].filter((r) => r.created).length;
          expect(createdCount).toBe(1);
          expect(a.assessment.id).toBe(b.assessment.id);
          expect(a.assessment.status).toBe('QUEUED');
          await worker.drain();
        },
      ),
      fcDefaults({ numRuns: 25 }),
    );
  }, 30_000);

  it('concurrent run() is single-execution and yields unique increasing event seqs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        arbRequest,
        async (sched: fc.Scheduler, request: ResolvedAssessmentRequest) => {
          resetLainMock();
          const db = makeDb();
          await db
            .insert(schema.workspace)
            .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
          const scheduledGetLain = sched.scheduleFunction(
            async (_orgId: string): Promise<LainAdapter> => createInstantLain(),
          );
          const worker = new AssessmentWorker(db, { getLain: scheduledGetLain });
          const created = await sched.waitFor(worker.create(request));

          const [r1, r2] = await sched.waitFor(
            Promise.all([worker.run(created.assessment.id), worker.run(created.assessment.id)]),
          );

          expect(r1.status).toBe(r2.status);
          expect(isTerminal(r1.status)).toBe(true);
          // Un run sano sobre el mock nunca termina FAILED: READY o PARTIAL.
          expect(['READY', 'PARTIAL']).toContain(r1.status);
          // INV 4: una sola ejecución por trabajo en vuelo — el motor ve el
          // análisis exactamente una vez aunque run() se invoque dos veces.
          const diffCalls = getLainMockCalls().filter((c) => c.tool === 'diff_contracts');
          expect(diffCalls.length).toBe(1);
          const events = await worker.events(created.assessment.id);
          const seqs = events.map((e) => e.seq);
          expect(new Set(seqs).size).toBe(seqs.length); // sin eventos duplicados
          expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
          await worker.drain();
        },
      ),
      fcDefaults({ numRuns: 25 }),
    );
  }, 30_000);
});
