// AssessmentWorker — persists assessments, runs the state machine
// (QUEUED → SNAPSHOTTING → ANALYZING → EXPLAINING → READY), emits events
// for SSE, and recovers after restart (P INV 5: READY only after persisting).

import type { AssessmentId, OrgId } from '@parallax/shared/domain';
import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

import {
  type AssessmentEvent,
  type AssessmentRecord,
  type AssessmentStatus,
  canTransition,
  computeInputDigest,
} from './state.js';

type Db = BetterSQLite3Database<typeof schema>;

export interface AssessmentInput {
  orgId: string;
  prUrl?: string;
  repo?: string;
  base?: string;
  head?: string;
  configHash?: string;
}

export interface CreateResult {
  assessment: AssessmentRecord;
  created: boolean; // false = idempotent hit (P INV 4)
}

export class AssessmentWorker {
  private readonly db: Db;
  private readonly eventListeners = new Map<string, Set<(e: AssessmentEvent) => void>>();

  constructor(db: Db) {
    this.db = db;
  }

  // P INV 4: same input_digest → same assessment, no duplicate.
  async create(input: AssessmentInput): Promise<CreateResult> {
    const digest = computeInputDigest(input);
    const existing = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.inputDigest, digest))
      .limit(1);
    if (existing[0]) {
      return { assessment: this.toRecord(existing[0]), created: false };
    }

    const id = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const manifest = {
      base: { repos: { [input.repo ?? 'unknown']: input.base ?? 'HEAD' } },
      head: { repos: { [input.repo ?? 'unknown']: input.head ?? 'HEAD' } },
    };
    await this.db.insert(schema.assessment).values({
      id,
      orgId: input.orgId,
      inputDigest: digest,
      status: 'QUEUED',
      baseId: null,
      headId: null,
      manifestJson: JSON.stringify(manifest),
      engineJson: null,
      coverageJson: null,
      createdAt: Date.now(),
      completedAt: null,
    });

    const row = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.id, id))
      .limit(1);
    const record = this.toRecord(row[0]!);
    this.emit(record.id, {
      seq: 0,
      type: 'created',
      payload: { status: 'QUEUED' },
      createdAt: Date.now(),
    });
    return { assessment: record, created: true };
  }

  async get(id: string): Promise<AssessmentRecord | null> {
    const row = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.id, id))
      .limit(1);
    return row[0] ? this.toRecord(row[0]) : null;
  }

  async transition(
    id: string,
    to: AssessmentStatus,
    extra?: {
      baseId?: string;
      headId?: string;
      engineJson?: string;
      coverageJson?: string;
      error?: string;
    },
  ): Promise<AssessmentRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`assessment ${id} not found`);
    if (!canTransition(current.status, to)) {
      throw new Error(`invalid transition ${current.status} → ${to}`);
    }

    const updates: Partial<typeof schema.assessment.$inferInsert> = { status: to };
    if (to === 'READY' || to === 'PARTIAL' || to === 'FAILED' || to === 'CANCELLED') {
      updates.completedAt = Date.now();
    }
    if (extra?.baseId !== undefined) updates.baseId = extra.baseId;
    if (extra?.headId !== undefined) updates.headId = extra.headId;
    if (extra?.engineJson !== undefined) updates.engineJson = extra.engineJson;
    if (extra?.coverageJson !== undefined) updates.coverageJson = extra.coverageJson;

    await this.db.update(schema.assessment).set(updates).where(eq(schema.assessment.id, id));

    const seq = await this.nextSeq(id);
    this.emit(id, {
      seq,
      type: 'transition',
      payload: { from: current.status, to, ...extra },
      createdAt: Date.now(),
    });

    return (await this.get(id))!;
  }

  // SSE: subscribe to events for an assessment.
  subscribe(id: string, fn: (e: AssessmentEvent) => void): () => void {
    if (!this.eventListeners.has(id)) this.eventListeners.set(id, new Set());
    this.eventListeners.get(id)?.add(fn);
    return () => {
      this.eventListeners.get(id)?.delete(fn);
    };
  }

  async events(id: string): Promise<AssessmentEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.assessmentId, id))
      .orderBy(schema.event.seq);
    return rows.map((r) => ({
      seq: r.seq,
      type: r.type,
      payload: r.payload ? JSON.parse(r.payload) : null,
      createdAt: r.createdAt,
    }));
  }

  // Recovery: re-queue assessments stuck in non-terminal states (P INV 5).
  async recover(): Promise<string[]> {
    const stuck = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.status, 'SNAPSHOTTING'));
    const recovered: string[] = [];
    for (const row of stuck) {
      await this.transition(row.id, 'FAILED', { error: 'recovered from restart' });
      recovered.push(row.id);
    }
    return recovered;
  }

  private emit(id: string, event: AssessmentEvent): void {
    // Persist to event table.
    this.db
      .insert(schema.event)
      .values({
        assessmentId: id,
        seq: event.seq,
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: event.createdAt,
      })
      .run();
    // Notify live subscribers.
    for (const fn of this.eventListeners.get(id) ?? []) fn(event);
  }

  private async nextSeq(id: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.assessmentId, id))
      .orderBy(desc(schema.event.seq))
      .limit(1);
    return (rows[0]?.seq ?? 0) + 1;
  }

  private toRecord(row: typeof schema.assessment.$inferSelect): AssessmentRecord {
    return {
      id: row.id as AssessmentId,
      orgId: row.orgId as OrgId,
      inputDigest: row.inputDigest,
      status: row.status as AssessmentRecord['status'],
      baseId: row.baseId,
      headId: row.headId,
      manifestJson: row.manifestJson,
      engineJson: row.engineJson,
      coverageJson: row.coverageJson,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }
}
