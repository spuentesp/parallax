// AssessmentWorker — ejecuta el protocolo de evaluación sobre LAIN, persiste
// cada artefacto ANTES de anunciar el estado (INV 5) y reanuda trabajos
// interrumpidos tras un reinicio en lugar de fallarlos.

import { createHash } from 'node:crypto';
import type { AssessmentId, OrgId } from '@parallax/shared/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { presentCoverage, type LainCoverage } from '../coverage.js';
import type { LainAdapter } from '../lain-adapter/types.js';

import {
  type AssessmentEvent,
  type AssessmentRecord,
  type AssessmentStatus,
  PARALLAX_POLICY_VERSION,
  canTransition,
  computeInputDigest,
  isTerminal,
} from './state.js';

export type { AssessmentEvent, AssessmentRecord } from './state.js';

type Db = BetterSQLite3Database<typeof schema>;

const SNAPSHOT_WAIT_MS = 60_000;
const SNAPSHOT_POLL_MS = 200;
// Trazamos impacto sólo para los hallazgos principales: el resto queda como
// hallazgo del motor sin traza, visible en el informe.
const MAX_TRACE_TARGETS = 3;
const MAX_EVIDENCE_ROWS = 12;

export interface ResolvedManifest {
  base: { repos: Record<string, string> };
  head: { repos: Record<string, string> };
  configured: string[];
  excluded: Array<{ repo: string; reason: string }>;
  configHash: string | null;
  /** Snapshot ids de LAIN, escritos tras SNAPSHOTTING (§5). */
  snapshots?: { base: string; head: string };
}

export interface ResolvedAssessmentRequest {
  orgId: string;
  manifest: ResolvedManifest;
}

export interface CreateResult {
  assessment: AssessmentRecord;
  created: boolean; // false = idempotent hit (P INV 4)
}

export interface AssessmentWorkerDeps {
  lain?: LainAdapter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class AssessmentWorker {
  private readonly db: Db;
  private readonly lain: LainAdapter | undefined;
  private readonly eventListeners = new Map<string, Set<(e: AssessmentEvent) => void>>();
  private readonly inFlight = new Map<string, Promise<AssessmentRecord>>();

  constructor(db: Db, deps?: AssessmentWorkerDeps) {
    this.db = db;
    this.lain = deps?.lain;
  }

  // P INV 4: mismo manifiesto resuelto → misma evaluación, nunca un segundo
  // trabajo activo. El digest no contiene nada derivado del modelo (§4).
  async create(input: ResolvedAssessmentRequest): Promise<CreateResult> {
    const digest = computeInputDigest({
      manifest: {
        base: input.manifest.base.repos,
        head: input.manifest.head.repos,
      },
      configHash: input.manifest.configHash,
      analyzerVersion: this.lain?.analyzerVersion ?? 'unknown',
      policyVersion: PARALLAX_POLICY_VERSION,
    });
    const existing = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.inputDigest, digest))
      .limit(1);
    if (existing[0]) {
      return { assessment: this.toRecord(existing[0]), created: false };
    }

    const id = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await this.db.insert(schema.assessment).values({
        id,
        orgId: input.orgId,
        inputDigest: digest,
        status: 'QUEUED',
        baseId: null,
        headId: null,
        manifestJson: JSON.stringify(input.manifest),
        engineJson: null,
        coverageJson: null,
        createdAt: Date.now(),
        completedAt: null,
      });
    } catch {
      // Carrera con otra creación del mismo digest: gana la fila existente.
      const raced = await this.db
        .select()
        .from(schema.assessment)
        .where(eq(schema.assessment.inputDigest, digest))
        .limit(1);
      if (raced[0]) return { assessment: this.toRecord(raced[0]), created: false };
      throw new Error(`failed to insert assessment for digest ${digest}`);
    }

    const row = await this.db
      .select()
      .from(schema.assessment)
      .where(eq(schema.assessment.id, id))
      .limit(1);
    const record = this.toRecord(row[0]!);
    this.emit(record.id, {
      seq: await this.nextSeq(record.id),
      type: 'created',
      payload: { status: 'QUEUED', inputDigest: digest },
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

  // Vincula una idempotency_key externa al trabajo. Se persiste como evento
  // (§13: la tabla event es el registro durable de la solicitud).
  async recordIdempotencyKey(id: string, key: string, digest: string): Promise<void> {
    this.emit(id, {
      seq: await this.nextSeq(id),
      type: 'idempotency',
      payload: { key, digest },
      createdAt: Date.now(),
    });
  }

  async findIdempotencyKey(key: string): Promise<{ assessmentId: string; digest: string } | null> {
    const rows = await this.db.select().from(schema.event).where(eq(schema.event.type, 'idempotency'));
    for (const row of rows) {
      if (!row.payload) continue;
      const payload = JSON.parse(row.payload) as { key?: string; digest?: string };
      if (payload.key === key && payload.digest) {
        return { assessmentId: row.assessmentId, digest: payload.digest };
      }
    }
    return null;
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

    // Los artefactos viajan en la MISMA escritura que el estado: un lector
    // nunca ve READY sin el resultado persistido (INV 5).
    const updates: Partial<typeof schema.assessment.$inferInsert> = { status: to };
    if (to === 'READY' || to === 'PARTIAL' || to === 'FAILED' || to === 'CANCELLED') {
      updates.completedAt = Date.now();
    }
    if (extra?.baseId !== undefined) updates.baseId = extra.baseId;
    if (extra?.headId !== undefined) updates.headId = extra.headId;
    if (extra?.engineJson !== undefined) updates.engineJson = extra.engineJson;
    if (extra?.coverageJson !== undefined) updates.coverageJson = extra.coverageJson;

    await this.db.update(schema.assessment).set(updates).where(eq(schema.assessment.id, id));

    this.emit(id, {
      seq: await this.nextSeq(id),
      type: 'transition',
      payload: {
        from: current.status,
        to,
        ...(extra?.error !== undefined ? { error: extra.error } : {}),
      },
      createdAt: Date.now(),
    });

    return (await this.get(id))!;
  }

  // Ejecuta el protocolo hasta un estado terminal. Reentrada segura: dos
  // llamadas concurrentes del mismo proceso comparten la misma promesa.
  run(id: string): Promise<AssessmentRecord> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const run = this.execute(id).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, run);
    return run;
  }

  // Espera a que terminen los trabajos lanzados en background. §5 devuelve el
  // assessment_id de inmediato, así que los runs corren fuera del request;
  // antes de cerrar la base hay que drenarlos o se escribiría sobre una
  // conexión ya cerrada y el trabajo quedaría sin su artefacto.
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  // Recuperación (INV 5): los trabajos no terminales se REANUDAN a través del
  // runner; un informe READY permanece legible y no se re-ejecuta.
  async recover(): Promise<string[]> {
    const pending = await this.db
      .select()
      .from(schema.assessment)
      .where(inArray(schema.assessment.status, ['QUEUED', 'SNAPSHOTTING', 'ANALYZING', 'EXPLAINING']));
    const resumed: string[] = [];
    for (const row of pending) {
      resumed.push(row.id);
      await this.run(row.id);
    }
    return resumed;
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

  private async execute(id: string): Promise<AssessmentRecord> {
    let rec = await this.get(id);
    if (!rec) throw new Error(`assessment ${id} not found`);
    if (isTerminal(rec.status)) return rec;
    if (!this.lain) {
      return this.fail(rec, 'no Lain adapter configured for the worker');
    }

    try {
      const manifest = JSON.parse(rec.manifestJson) as ResolvedManifest;

      if (rec.status === 'QUEUED') {
        rec = await this.transition(id, 'SNAPSHOTTING');
      }
      if (rec.status === 'SNAPSHOTTING') {
        rec = await this.stepSnapshot(id, rec, manifest);
      }
      if (rec.status === 'ANALYZING') {
        rec = await this.stepAnalyze(id, rec, manifest);
      }
      if (rec.status === 'EXPLAINING') {
        rec = await this.stepExplain(id, rec);
      }
      return rec;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const current = (await this.get(id)) ?? rec;
      return this.fail(current, message);
    }
  }

  private async fail(rec: AssessmentRecord, message: string): Promise<AssessmentRecord> {
    if (isTerminal(rec.status)) return rec;
    // La causa queda en el artefacto y en el evento; FAILED nunca se publica
    // como un análisis final (§5).
    if (rec.engineJson == null) {
      await this.db
        .update(schema.assessment)
        .set({ engineJson: JSON.stringify({ error: message }) })
        .where(eq(schema.assessment.id, rec.id));
    }
    if (!canTransition(rec.status, 'FAILED')) return rec;
    return this.transition(rec.id, 'FAILED', { error: message });
  }

  // SNAPSHOTTING: ambas vistas fijadas al manifiesto de commits (§5). Los ids
  // de snapshot quedan en el manifiesto persistido.
  private async stepSnapshot(
    id: string,
    rec: AssessmentRecord,
    manifest: ResolvedManifest,
  ): Promise<AssessmentRecord> {
    const attempt = await this.beginStep(id, 'snapshot');
    try {
      const base = await this.awaitSnapshot(manifest.base.repos);
      const head = await this.awaitSnapshot(manifest.head.repos);
      const updated: ResolvedManifest = { ...manifest, snapshots: { base, head } };
      await this.db
        .update(schema.assessment)
        .set({ manifestJson: JSON.stringify(updated) })
        .where(eq(schema.assessment.id, id));
      const next = await this.transition(id, 'ANALYZING', { baseId: base, headId: head });
      await this.endStep(id, 'snapshot', attempt, 'done', sha256Hex(`${base}:${head}`));
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.endStep(id, 'snapshot', attempt, 'failed', null);
      return this.fail(rec, `snapshot failed: ${message}`);
    }
  }

  // ANALYZING: diff_contracts + get_coverage + trace_impact para los hallazgos
  // principales. El output crudo del motor se conserva en engine_json; la
  // cobertura presentada (INV 3) en coverage_json.
  private async stepAnalyze(
    id: string,
    rec: AssessmentRecord,
    manifest: ResolvedManifest,
  ): Promise<AssessmentRecord> {
    const lain = this.lain;
    if (!lain || !rec.baseId || !rec.headId) {
      throw new Error('analysis requires ready snapshots and a Lain adapter');
    }
    const attempt = await this.beginStep(id, 'analyze');
    const head = rec.headId;
    const gaps: string[] = [];

    try {
      const diff = await lain.diffContracts({ base: rec.baseId, head });

      let coverageRaw: LainCoverage;
      try {
        // El adaptador ya trae el `data` del motor; lo tratamos como la
        // superficie loosely tipada que presentCoverage consume.
        coverageRaw = (await lain.getCoverage({ snapshot: head })) as unknown as LainCoverage;
      } catch (e) {
        gaps.push(`get_coverage failed: ${e instanceof Error ? e.message : String(e)}`);
        coverageRaw = (diff.coverage as LainCoverage | undefined) ?? { complete: false };
      }

      const changes = diff.changes as Array<Record<string, unknown>>;
      const traceTargets = changes
        .filter((c) => {
          const endpoint = c.endpoint as { key?: string; service?: string } | undefined;
          return endpoint?.key != null && endpoint.service != null;
        })
        .slice(0, MAX_TRACE_TARGETS);

      const traces: Array<{ from: unknown; result: unknown }> = [];
      for (const change of traceTargets) {
        const endpoint = change.endpoint as { key: string; service: string };
        try {
          const result = await lain.traceImpact({
            snapshot: head,
            from: { endpoint: { service: endpoint.service, key: endpoint.key } },
          });
          traces.push({ from: { endpoint }, result });
          if (result.truncated === true) {
            gaps.push(`trace_impact truncated for ${endpoint.service} ${endpoint.key}`);
          }
        } catch (e) {
          gaps.push(
            `trace_impact failed for ${endpoint.service} ${endpoint.key}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // Evidencia estructural: anclas de get_service sobre el proveedor de
      // cada hallazgo principal, en la vista evaluada.
      await this.db
        .delete(schema.evidence)
        .where(eq(schema.evidence.assessmentId, id));
      const harvested = await this.harvestEvidence(id, head, traceTargets, manifest, gaps);

      const scope = coverageRaw.scope;
      for (const entry of scope?.unreviewed ?? []) {
        const repo = typeof entry === 'string' ? entry : String((entry as { repo?: unknown }).repo ?? '');
        if (repo) gaps.push(`engine unreviewed: ${repo}`);
      }
      for (const entry of scope?.failed ?? []) {
        const repo = typeof entry === 'string' ? entry : String((entry as { repo?: unknown }).repo ?? '');
        if (repo) gaps.push(`engine indexing failed: ${repo}`);
      }

      const presented = presentCoverage(coverageRaw, {
        configured: manifest.configured,
        excluded: manifest.excluded.map((e) => e.repo),
      });
      const coverageJson = JSON.stringify({ ...presented, missing: gaps });
      const engineJson = JSON.stringify({
        analyzerVersion: lain.analyzerVersion,
        policyVersion: PARALLAX_POLICY_VERSION,
        diff,
        traces,
        coverageRaw,
        evidenceCount: harvested,
      });

      const next = await this.transition(id, 'EXPLAINING', { engineJson, coverageJson });
      await this.endStep(id, 'analyze', attempt, 'done', sha256Hex(engineJson));
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.endStep(id, 'analyze', attempt, 'failed', null);
      return this.fail(rec, `analysis failed: ${message}`);
    }
  }

  // EXPLAINING: el modelo llega en G3. El informe estructural se completa sin
  // LLM; la explicación queda registrada como 'skipped', nunca como evidencia.
  private async stepExplain(id: string, rec: AssessmentRecord): Promise<AssessmentRecord> {
    const attempt = await this.beginStep(id, 'explain');
    try {
      await this.db.delete(schema.explanation).where(eq(schema.explanation.assessmentId, id));
      await this.db.insert(schema.explanation).values({
        id: `ex_${id}`,
        assessmentId: id,
        revision: 0,
        model: 'none',
        status: 'skipped',
        payload: null,
        createdAt: Date.now(),
      });
      const coverage = rec.coverageJson ? (JSON.parse(rec.coverageJson) as { missing?: string[] }) : null;
      const missing = coverage?.missing ?? [];
      const final: AssessmentStatus = missing.length > 0 ? 'PARTIAL' : 'READY';
      const next = await this.transition(id, final);
      await this.endStep(id, 'explain', attempt, 'done', null);
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.endStep(id, 'explain', attempt, 'failed', null);
      return this.fail(rec, `explain step failed: ${message}`);
    }
  }

  private async harvestEvidence(
    id: string,
    viewId: string,
    changes: Array<Record<string, unknown>>,
    manifest: ResolvedManifest,
    gaps: string[],
  ): Promise<number> {
    const lain = this.lain;
    if (!lain) return 0;
    const services = [
      ...new Set(
        changes
          .map((c) => {
            const endpoint = c.endpoint as { service?: string } | undefined;
            return endpoint?.service ?? (typeof c.service === 'string' ? c.service : null);
          })
          .filter((s): s is string => s != null),
      ),
    ].slice(0, MAX_TRACE_TARGETS);

    let inserted = 0;
    for (const service of services) {
      if (inserted >= MAX_EVIDENCE_ROWS) break;
      try {
        const detail = await lain.getService({ snapshot: viewId, service });
        for (const consumer of detail.consumers) {
          for (const use of consumer.uses) {
            if (inserted >= MAX_EVIDENCE_ROWS) break;
            const anchor = use.site ?? use.caller;
            if (!anchor?.repo || !anchor.path || anchor.line == null) continue;
            const sha = anchor.commit ?? manifest.head.repos[anchor.repo] ?? 'unknown';
            const hash = sha256Hex(`${viewId}:${anchor.repo}:${anchor.path}:${anchor.line}`);
            await this.db.insert(schema.evidence).values({
              id: `ev_${hash.slice(0, 24)}`,
              assessmentId: id,
              viewId,
              repo: anchor.repo,
              sha,
              path: anchor.path,
              rangeJson: JSON.stringify({ start: anchor.line, end: anchor.line }),
              hash,
            });
            inserted++;
          }
        }
      } catch (e) {
        gaps.push(
          `evidence harvest failed for ${service}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return inserted;
  }

  private async awaitSnapshot(repos: Record<string, string>): Promise<string> {
    const lain = this.lain;
    if (!lain) throw new Error('no Lain adapter configured');
    const prepared = await lain.prepareSnapshot({ repos, wait_ms: SNAPSHOT_WAIT_MS });
    if (prepared.state === 'ready') return prepared.snapshot;
    if (prepared.state === 'failed') throw new Error(`snapshot ${prepared.snapshot} failed`);

    const deadline = Date.now() + SNAPSHOT_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(SNAPSHOT_POLL_MS);
      const status = await lain.getSnapshot({ snapshot: prepared.snapshot });
      if (status.state === 'ready') return status.snapshot;
      if (status.state === 'failed') {
        throw new Error(`snapshot ${prepared.snapshot} failed: ${status.error ?? 'unknown'}`);
      }
    }
    throw new Error(`snapshot ${prepared.snapshot} not ready after ${SNAPSHOT_WAIT_MS}ms`);
  }

  private async beginStep(id: string, step: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.assessmentId, id));
    const attempts = rows.filter((r) => r.step === step).map((r) => r.attempt);
    const attempt = (attempts.length > 0 ? Math.max(...attempts) : 0) + 1;
    await this.db.insert(schema.jobStep).values({
      assessmentId: id,
      step,
      attempt,
      state: 'running',
      artifactHash: null,
      updatedAt: Date.now(),
    });
    return attempt;
  }

  private async endStep(
    id: string,
    step: string,
    attempt: number,
    state: string,
    artifactHash: string | null,
  ): Promise<void> {
    await this.db
      .update(schema.jobStep)
      .set({ state, artifactHash, updatedAt: Date.now() })
      .where(
        and(
          eq(schema.jobStep.assessmentId, id),
          eq(schema.jobStep.step, step),
          eq(schema.jobStep.attempt, attempt),
        ),
      );
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
