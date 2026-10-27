// AssessmentWorker — ejecuta el protocolo de evaluación sobre LAIN, persiste
// cada artefacto ANTES de anunciar el estado (INV 5) y reanuda trabajos
// interrumpidos tras un reinicio en lugar de fallarlos.

import { createHash } from 'node:crypto';
import type { AssessmentId, OrgId } from '@parallax/shared/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { type LainCoverage, presentCoverage } from '../coverage.js';
import * as schema from '../db/schema.js';
import type { LainAdapter } from '../lain-adapter/types.js';

import {
  type AssessmentEvent,
  type AssessmentRecord,
  type AssessmentStatus,
  canTransition,
  computeInputDigest,
  isTerminal,
  PARALLAX_POLICY_VERSION,
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
  /**
   * Cada organización es un workspace con su propio servidor LAIN. Sin este
   * resolvedor el worker analiza contra el adapter global (hoy, mock) y el
   * informe sale de datos inventados — por eso los snapshots aparecían como
   * snap_0000000000000001.
   */
  getLain?: (orgId: string) => Promise<LainAdapter | undefined>;
  /**
   * Explicación del modelo (G3). Si no se inyecta (sin token Nemotron), el
   * paso EXPLAINING registra failed:no_model_configured: un fallo visible,
   * nunca un silencio que finja explicación (P08). El informe estructural
   * sigue completándose igual.
   */
  explain?: (args: {
    orgId: string;
    viewId: string;
    /** Snapshot base del análisis: la evidencia de lo eliminado sólo existe ahí. */
    baseView?: string | undefined;
    question: string;
    engineFindings: unknown[];
    /** Cobertura presentada del análisis (INV 3): la explicación no puede callarla. */
    coverage?: {
      complete?: boolean | undefined;
      missing?: string[] | undefined;
      summary?: string | undefined;
    };
  }) => Promise<ExplainOutcome>;
  /** Reloj inyectable (DST): por defecto Date.now. */
  now?: () => number;
  /** Sleep inyectable (DST): por defecto setTimeout real. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ExplainOutcome {
  status: string; // 'available' | 'failed:<reason>'
  model: string;
  payload: unknown | null;
}

// Los errores del motor llegan como objetos planos ({code, message}), no como
// Error: String(e) daba "[object Object]" en la cobertura del informe.
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown };
    if (typeof o.message === 'string') {
      return typeof o.code === 'string' ? `${o.code}: ${o.message}` : o.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return Object.prototype.toString.call(e);
    }
  }
  return String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class AssessmentWorker {
  private readonly db: Db;
  private readonly getLain: ((orgId: string) => Promise<LainAdapter | undefined>) | undefined;
  private readonly explain: AssessmentWorkerDeps['explain'];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lainByOrg = new Map<string, LainAdapter>();
  private readonly eventListeners = new Map<string, Set<(e: AssessmentEvent) => void>>();
  private readonly inFlight = new Map<string, Promise<AssessmentRecord>>();

  constructor(db: Db, deps?: AssessmentWorkerDeps) {
    this.db = db;
    this.getLain = deps?.getLain;
    this.explain = deps?.explain;
    this.now = deps?.now ?? Date.now;
    this.sleep = deps?.sleep ?? sleep;
  }

  // Un adaptador por organización; dos evaluaciones del mismo workspace
  // comparten la conexión y su handshake.
  private async lainFor(orgId: string): Promise<LainAdapter | undefined> {
    const cached = this.lainByOrg.get(orgId);
    if (cached) return cached;
    const resolved = await this.getLain?.(orgId);
    if (resolved) this.lainByOrg.set(orgId, resolved);
    return resolved;
  }

  // P INV 4: mismo manifiesto resuelto → misma evaluación, nunca un segundo
  // trabajo activo. El digest no contiene nada derivado del modelo (§4).
  async create(input: ResolvedAssessmentRequest): Promise<CreateResult> {
    // La versión del motor entra en el digest (§4), así que hay que resolver el
    // LAIN del workspace antes de calcularlo.
    const adapter = await this.lainFor(input.orgId);
    const digest = computeInputDigest({
      manifest: {
        base: input.manifest.base.repos,
        head: input.manifest.head.repos,
      },
      configHash: input.manifest.configHash,
      analyzerVersion: adapter?.analyzerVersion ?? 'unknown',
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

    const id = `a_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
        createdAt: this.now(),
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
    const record = row[0] ? this.toRecord(row[0]) : null;
    if (record === null) throw new Error(`failed to read back assessment ${id}`);
    this.emit(record.id, {
      seq: await this.nextSeq(record.id),
      type: 'created',
      payload: { status: 'QUEUED', inputDigest: digest },
      createdAt: this.now(),
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
      createdAt: this.now(),
    });
  }

  async findIdempotencyKey(key: string): Promise<{ assessmentId: string; digest: string } | null> {
    const rows = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, 'idempotency'));
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
      updates.completedAt = this.now();
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
      createdAt: this.now(),
    });

    const updated = await this.get(id);
    if (!updated) throw new Error(`assessment ${id} vanished during transition`);
    return updated;
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
      .where(
        inArray(schema.assessment.status, ['QUEUED', 'SNAPSHOTTING', 'ANALYZING', 'EXPLAINING']),
      );
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
    const lain = await this.lainFor(rec.orgId);
    if (!lain) {
      return this.fail(rec, `no LAIN configured for workspace ${rec.orgId} — declare its lainUrl`);
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
      const message = describeError(e);
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
      const lain = await this.lainFor(rec.orgId);
      const base = await this.awaitSnapshot(lain, manifest.base.repos);
      const head = await this.awaitSnapshot(lain, manifest.head.repos);
      const updated: ResolvedManifest = { ...manifest, snapshots: { base, head } };
      await this.db
        .update(schema.assessment)
        .set({ manifestJson: JSON.stringify(updated) })
        .where(eq(schema.assessment.id, id));
      const next = await this.transition(id, 'ANALYZING', { baseId: base, headId: head });
      await this.endStep(id, 'snapshot', attempt, 'done', sha256Hex(`${base}:${head}`));
      return next;
    } catch (e) {
      const message = describeError(e);
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
    const lain = await this.lainFor(rec.orgId);
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
        gaps.push(`get_coverage failed: ${describeError(e)}`);
        coverageRaw = (diff.coverage as LainCoverage | undefined) ?? { complete: false };
      }

      const changes = diff.changes as Array<Record<string, unknown>>;
      // Un cambio del lado consumidor ya trae sus caminos en el diff, y su
      // endpoint no es de ese servicio: no se traza aparte.
      const traceTargets = changes
        .filter((c) => {
          const endpoint = c.endpoint as { key?: string; service?: string } | undefined;
          return endpoint?.key != null && endpoint.service != null && c.side !== 'consumer';
        })
        .slice(0, MAX_TRACE_TARGETS);

      const traces: Array<{ from: unknown; result: unknown }> = [];
      for (const change of traceTargets) {
        const endpoint = change.endpoint as { key: string; service: string };
        try {
          // Un endpoint ELIMINADO no existe en head: su impacto (quién lo
          // consumía) se traza en base. Trazarlo en head daba contract_not_found
          // y dejaba justo los hallazgos más graves como hueco de cobertura.
          const traceView = change.kind === 'EndpointRemoved' && rec.baseId ? rec.baseId : head;
          const result = await lain.traceImpact({
            snapshot: traceView,
            from: { endpoint: { service: endpoint.service, key: endpoint.key } },
          });
          traces.push({ from: { endpoint }, result });
          if (result.truncated === true) {
            gaps.push(`trace_impact truncated for ${endpoint.service} ${endpoint.key}`);
          }
        } catch (e) {
          gaps.push(
            `trace_impact failed for ${endpoint.service} ${endpoint.key}: ${describeError(e)}`,
          );
        }
      }

      // Evidencia estructural: anclas de get_service sobre el proveedor de
      // cada hallazgo principal, en la vista evaluada.
      await this.db.delete(schema.evidence).where(eq(schema.evidence.assessmentId, id));
      const harvested = await this.harvestEvidence(id, head, traceTargets, manifest, gaps);

      const scope = coverageRaw.scope;
      for (const entry of scope?.unreviewed ?? []) {
        const repo =
          typeof entry === 'string' ? entry : String((entry as { repo?: unknown }).repo ?? '');
        if (repo) gaps.push(`engine unreviewed: ${repo}`);
      }
      for (const entry of scope?.failed ?? []) {
        const repo =
          typeof entry === 'string' ? entry : String((entry as { repo?: unknown }).repo ?? '');
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
      const message = describeError(e);
      await this.endStep(id, 'analyze', attempt, 'failed', null);
      return this.fail(rec, `analysis failed: ${message}`);
    }
  }

  // EXPLAINING (G3): el investigador Nemotron explora los hallazgos dentro del
  // presupuesto y su explicación se serializa con campos del motor y del
  // modelo separados (INV 2). Sin modelo configurado el paso registra
  // failed:no_model_configured — fallo visible, no un silencio (P08). El
  // informe estructural (engine_json/coverage_json) no se toca aquí.
  private async stepExplain(id: string, rec: AssessmentRecord): Promise<AssessmentRecord> {
    const attempt = await this.beginStep(id, 'explain');
    try {
      await this.db.delete(schema.explanation).where(eq(schema.explanation.assessmentId, id));

      const engine = rec.engineJson
        ? (JSON.parse(rec.engineJson) as {
            diff?: { changes?: unknown[] };
            analyzerVersion?: string;
          })
        : null;
      const changes = engine?.diff?.changes;
      const engineFindings = Array.isArray(changes) ? changes : [];
      const viewId = rec.headId ?? 'live';

      let outcome: ExplainOutcome;
      if (!this.explain) {
        outcome = {
          status: 'failed:no_model_configured',
          model: 'none',
          payload: null,
        };
      } else {
        try {
          outcome = await this.explain({
            orgId: rec.orgId,
            viewId,
            baseView: rec.baseId ?? undefined,
            question:
              'Explain, for an architect, the impact of these contract changes. ' +
              'Keep engine classifications as they are, cite evidence ids you receive, ' +
              'and separate what is known from what remains unknown.',
            engineFindings,
            coverage: rec.coverageJson
              ? (JSON.parse(rec.coverageJson) as {
                  complete?: boolean;
                  missing?: string[];
                  summary?: string;
                })
              : {},
          });
        } catch (e) {
          // Un fallo del modelo nunca destruye el informe estructural: queda
          // como estado de explicación con causa, separado del resultado.
          outcome = {
            status: 'failed:explain_error',
            model: 'none',
            payload: { error: describeError(e) },
          };
        }
      }

      await this.db.insert(schema.explanation).values({
        id: `ex_${id}`,
        assessmentId: id,
        revision: 0,
        model: outcome.model,
        status: outcome.status,
        payload: outcome.payload != null ? JSON.stringify(outcome.payload) : null,
        createdAt: this.now(),
      });
      const coverage = rec.coverageJson
        ? (JSON.parse(rec.coverageJson) as { missing?: string[] })
        : null;
      const missing = coverage?.missing ?? [];
      const final: AssessmentStatus = missing.length > 0 ? 'PARTIAL' : 'READY';
      const next = await this.transition(id, final);
      await this.endStep(id, 'explain', attempt, 'done', sha256Hex(outcome.status));
      return next;
    } catch (e) {
      const message = describeError(e);
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
    const current = await this.get(id);
    const lain = current ? await this.lainFor(current.orgId) : undefined;
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
        gaps.push(`evidence harvest failed for ${service}: ${describeError(e)}`);
      }
    }
    return inserted;
  }

  private async awaitSnapshot(
    lain: LainAdapter | undefined,
    repos: Record<string, string>,
  ): Promise<string> {
    if (!lain) throw new Error(`no LAIN configured for the workspace of ${JSON.stringify(repos)}`);
    const prepared = await lain.prepareSnapshot({ repos, wait_ms: SNAPSHOT_WAIT_MS });
    if (prepared.state === 'ready') return prepared.snapshot;
    if (prepared.state === 'failed') throw new Error(`snapshot ${prepared.snapshot} failed`);

    const deadline = this.now() + SNAPSHOT_WAIT_MS;
    while (this.now() < deadline) {
      await this.sleep(SNAPSHOT_POLL_MS);
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
      updatedAt: this.now(),
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
      .set({ state, artifactHash, updatedAt: this.now() })
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
