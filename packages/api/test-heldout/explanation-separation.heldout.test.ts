import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { detectClassificationConflicts, serializeExplanation } from '../src/agent/investigator.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { getAssessmentReport } from '../src/services/assessments.js';
import {
  AssessmentWorker,
  type ExplainOutcome,
  type ResolvedAssessmentRequest,
} from '../src/worker/assessment-worker.js';
import { createInstantLain } from '../test/prop/worker-lain-stub.js';

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

describe('composición: el modelo nunca renombra las clases del motor (INV 2)', () => {
  it('persiste classes del motor verbatim y hace visible el desacuerdo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-explain-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'test.db'));
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    runMigrations(sqlite, join(__dirname, '../drizzle'));
    const db = drizzle(sqlite, { schema });
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });

    // Motor falso con findings en la forma {endpoint, impact} que consumen el
    // worker (filtro de trazas) y serializeExplanation: el escenario base del
    // mock usa otro vocabulario ({kind, service, field}) y esa divergencia es
    // material para el red-team, no de este test.
    const engineChanges = [
      {
        endpoint: { key: 'http:GET /orders/{id}', service: 'orders' },
        impact: { class: 'Verified' },
      },
      {
        endpoint: { key: 'http:GET /billing', service: 'billing' },
        impact: { class: 'NeedsInvestigation' },
      },
    ];
    const instant = createInstantLain();
    const stub = {
      ...instant,
      async diffContracts(): Promise<never> {
        return { changes: engineChanges, compatible_changes: 1 } as never;
      },
    };

    // El explain inyectado recibe los findings del motor y devuelve un payload
    // cuya narrativa DISCREPA del motor (el modelo afirma NoKnownImpact).
    let capturedEngineFindings: unknown[] = [];
    const explain = async (args: {
      orgId: string;
      viewId: string;
      question: string;
      engineFindings: unknown[];
    }): Promise<ExplainOutcome> => {
      capturedEngineFindings = args.engineFindings;
      const first = args.engineFindings[0] as { endpoint?: { key?: string } } | undefined;
      const key = first?.endpoint?.key ?? 'unknown-endpoint';
      const payload = serializeExplanation(
        {
          promptVersion: 'v1',
          effectiveModel: 'test-model',
          answer: `${key} is NoKnownImpact.`,
          citations: [],
          conflictingClaims: [],
          budget: { maxToolCalls: 8, toolCallsUsed: 0 },
          toolCallLog: [],
          modelLog: [],
          errors: [],
        } as never,
        { question: args.question, engineFindings: args.engineFindings },
      );
      return { status: 'available', model: 'test-model', payload };
    };

    const worker = new AssessmentWorker(db, {
      getLain: async () => stub,
      explain,
    });
    const created = await worker.create(REQUEST);
    const record = await worker.run(created.assessment.id);
    await worker.drain();

    const report = await getAssessmentReport(db, created.assessment.id);
    expect(report).not.toBeNull();
    if (report === null) return;
    expect(report.explanation.status).toBe('available');

    // INV 2: engine_finding_classes copia impact.class verbatim del motor.
    const stored = await db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, created.assessment.id));
    expect(stored.length).toBe(1);
    const payload = JSON.parse(stored[0]?.payload ?? 'null') as {
      engine_finding_classes: Array<{ endpoint: string; class: string }>;
    };
    const engineClasses = capturedEngineFindings.map(
      (f) => (f as { impact?: { class?: string } }).impact?.class,
    );
    expect(payload.engine_finding_classes.map((c) => c.class)).toEqual(engineClasses);
    expect(engineClasses.length).toBeGreaterThan(0);

    // El desacuerdo es visible, no silenciado: se detecta contra el hallazgo
    // real del motor, con la clase que el motor declaró.
    const firstFinding = capturedEngineFindings[0] as {
      endpoint?: { key?: string; service?: string };
      impact?: { class?: string };
    };
    const answer = `${firstFinding.endpoint?.key} is NoKnownImpact.`;
    const conflicts = detectClassificationConflicts(answer, capturedEngineFindings);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]?.claimedClass).not.toBe(conflicts[0]?.engineClass);
    expect(record.status === 'READY' || record.status === 'PARTIAL').toBe(true);
  });
});
