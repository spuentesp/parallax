import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { AssessmentWorker } from '../src/worker/assessment-worker.js';
import { canTransition, computeInputDigest } from '../src/worker/state.js';

function makeDb(dir: string) {
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../drizzle'));
  return drizzle(sqlite, { schema });
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
    worker = new AssessmentWorker(db);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates an assessment with QUEUED status', async () => {
    const result = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
    expect(result.created).toBe(true);
    expect(result.assessment.status).toBe('QUEUED');
    expect(result.assessment.orgId).toBe('org_demo');
  });

  it('idempotency: same input returns same assessment (P INV 4)', async () => {
    const input = { orgId: 'org_demo', repo: 'orders', base: 'b5bf29a', head: 'afece23' };
    const first = await worker.create(input);
    const second = await worker.create(input);
    expect(second.created).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);
  });

  it('different input creates a new assessment', async () => {
    const a = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
    const b = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: '0931d02',
    });
    expect(a.assessment.id).not.toBe(b.assessment.id);
  });

  it('transitions QUEUED → SNAPSHOTTING → ANALYZING → READY', async () => {
    const { assessment } = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
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
    const { assessment } = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
    await expect(worker.transition(assessment.id, 'READY')).rejects.toThrow(/invalid transition/);
  });

  it('emits events on transitions', async () => {
    const { assessment } = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
    const received: string[] = [];
    worker.subscribe(assessment.id, (e) => received.push(e.type));
    await worker.transition(assessment.id, 'SNAPSHOTTING');
    expect(received).toContain('transition');
    const events = await worker.events(assessment.id);
    expect(events.length).toBeGreaterThanOrEqual(2); // created + transition
  });

  it('recovery: stuck SNAPSHOTTING assessments become FAILED after restart', async () => {
    const { assessment } = await worker.create({
      orgId: 'org_demo',
      repo: 'orders',
      base: 'b5bf29a',
      head: 'afece23',
    });
    await worker.transition(assessment.id, 'SNAPSHOTTING');
    // Simulate restart: create a new worker on the same db
    const worker2 = new AssessmentWorker(db);
    const recovered = await worker2.recover();
    expect(recovered).toContain(assessment.id);
    const after = await worker2.get(assessment.id);
    expect(after?.status).toBe('FAILED');
  });

  it('canTransition returns correct values', () => {
    expect(canTransition('QUEUED', 'SNAPSHOTTING')).toBe(true);
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('READY', 'ANALYZING')).toBe(false);
    expect(canTransition('ANALYZING', 'FAILED')).toBe(true);
  });

  it('computeInputDigest is deterministic', () => {
    const input = { orgId: 'o', repo: 'r', base: 'b', head: 'h' };
    expect(computeInputDigest(input)).toBe(computeInputDigest(input));
    expect(computeInputDigest(input)).not.toBe(computeInputDigest({ ...input, head: 'h2' }));
  });
});
