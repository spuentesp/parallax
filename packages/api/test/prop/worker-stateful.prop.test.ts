import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import {
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../../src/worker/assessment-worker.js';
import {
  canonicalJson,
  isTerminal,
  type AssessmentStatus,
} from '../../src/worker/state.js';
import { arbRequest } from './arbitraries.js';
import { fcDefaults } from './harness.js';
import { createInstantLain } from './worker-lain-stub.js';

const dirs: string[] = [];

async function makeWorkerHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-stateful-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../../drizzle'));
  const db = drizzle(sqlite, { schema });
  await db
    .insert(schema.workspace)
    .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  const worker = new AssessmentWorker(db, { getLain: async () => createInstantLain() });
  return { worker, db, dir };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('instant lain stub', () => {
  it('run() reaches a terminal status without sleeping on the snapshot poll', async () => {
    const { worker } = await makeWorkerHarness();
    const created = await worker.create({
      orgId: 'org_demo',
      manifest: {
        base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
        head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
        configured: ['orders'],
        excluded: [],
        configHash: null,
      },
    });
    const record = await worker.run(created.assessment.id);
    expect(isTerminal(record.status)).toBe(true);
    await worker.drain();
  });
});

type Model = {
  byRequest: Map<string, string>; // canonicalJson(request) → assessmentId
  statusById: Map<string, AssessmentStatus>;
  terminalIds: Set<string>;
};
type Real = Awaited<ReturnType<typeof makeWorkerHarness>>;

// El modelo codifica invariantes de nivel especificación (INV 4, INV 5 y el
// log de transiciones), NUNCA el status terminal exacto que elige la
// implementación (READY vs PARTIAL): eso sería un test tautológico.
class CreateCmd implements fc.AsyncCommand<Model, Real> {
  private readonly key: string;
  constructor(private readonly request: ResolvedAssessmentRequest) {
    this.key = canonicalJson(request);
  }
  check(): boolean {
    return true;
  }
  async run(model: Model, real: Real): Promise<void> {
    const result = await real.worker.create(this.request);
    if (model.byRequest.has(this.key)) {
      // INV 4: el mismo input devuelve el mismo assessment, created:false.
      expect(result.created).toBe(false);
      expect(result.assessment.id).toBe(model.byRequest.get(this.key));
    } else {
      expect(result.created).toBe(true);
      expect(result.assessment.status).toBe('QUEUED');
      model.byRequest.set(this.key, result.assessment.id);
      model.statusById.set(result.assessment.id, 'QUEUED');
    }
  }
  toString(): string {
    return `create(${Object.keys(this.request.manifest.head.repos).join(',')})`;
  }
}

class RunCmd implements fc.AsyncCommand<Model, Real> {
  check(model: Model): boolean {
    return [...model.statusById.values()].some((s) => !isTerminal(s));
  }
  async run(model: Model, real: Real): Promise<void> {
    const open = [...model.statusById.entries()].find(([, s]) => !isTerminal(s));
    const id = open![0];
    const before = await real.worker.get(id);
    const record = await real.worker.run(id);
    // Invariante de spec: el run termina en un estado terminal.
    expect(isTerminal(record.status)).toBe(true);
    if (model.terminalIds.has(id)) {
      // INV 5: un registro terminal no se re-ejecuta (READY queda legible).
      expect(record.status).toBe(before!.status);
      expect(record.completedAt).toBe(before!.completedAt);
    }
    // Sólo transiciones legales en el log; seqs estrictamente crecientes y únicas.
    const events = await real.worker.events(id);
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    model.statusById.set(id, record.status);
    model.terminalIds.add(id);
  }
  toString(): string {
    return 'run()';
  }
}

class RecoverCmd implements fc.AsyncCommand<Model, Real> {
  check(model: Model): boolean {
    return model.byRequest.size > 0;
  }
  async run(model: Model, real: Real): Promise<void> {
    const resumed = await real.worker.recover();
    // Sólo se reanudan ids creados por este modelo (nunca ajenos).
    for (const id of resumed) {
      expect([...model.byRequest.values()]).toContain(id);
    }
  }
  toString(): string {
    return 'recover()';
  }
}

describe('AssessmentWorker stateful model-based properties', () => {
  it('holds INV 4 / INV 5 / legal event logs under generated command sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            arbRequest.map((input) => new CreateCmd(input) as fc.AsyncCommand<Model, Real>),
            fc.constant(new RunCmd() as fc.AsyncCommand<Model, Real>),
            fc.constant(new RecoverCmd() as fc.AsyncCommand<Model, Real>),
          ],
          { maxCommands: 6 },
        ),
        async (cmds: Iterable<fc.AsyncCommand<Model, Real>>) => {
          const real = await makeWorkerHarness();
          const model: Model = {
            byRequest: new Map(),
            statusById: new Map(),
            terminalIds: new Set(),
          };
          await fc.asyncModelRun(() => ({ model, real }), cmds);
          await real.worker.drain();
        },
      ),
      fcDefaults({ numRuns: 20 }),
    );
  }, 30_000);
});
