// CI automática por workspace y webhook de pull_request. Al abrir o actualizar un
// PR de un repo del workspace (si el modo lo permite) se crea una evaluación para
// (base, head) y, al terminar, se publica el resultado en GitHub: siempre un commit
// status; un comentario sólo si el workspace lo activó.
import { WorkspaceCiSettings } from '@parallax/shared/domain';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { deriveLainRepoId } from '../code-graph.js';
import * as schema from '../db/schema.js';
import { parseGithubRepoUri } from '../github/reader.js';
import {
  commentBodyFor,
  GitHubWriter,
  PENDING_STATUS,
  STATUS_CONTEXT,
  statusForReport,
} from '../github/status.js';
import {
  isEvaluated,
  type PullRequestEvent,
  parsePullRequestEvent,
  verifySignature,
} from '../github/webhook.js';
import {
  createAssessment,
  getAssessmentRecord,
  getAssessmentReport,
  repoDisplayName,
} from '../services/assessments.js';
import type { AssessmentWorker } from '../worker/assessment-worker.js';

type Db = Parameters<typeof createAssessment>[0]['db'];

const TERMINAL = new Set(['READY', 'PARTIAL', 'FAILED', 'CANCELLED']);
const DEFAULT_CI: WorkspaceCiSettings = { mode: 'off', baseBranch: null, reportComments: false };

export async function readCiSettings(db: Db, workspaceId: string): Promise<WorkspaceCiSettings> {
  const [row] = await db
    .select()
    .from(schema.workspaceCi)
    .where(eq(schema.workspaceCi.workspaceId, workspaceId));
  if (!row) return DEFAULT_CI;
  return {
    mode: row.mode === 'on-open-and-update' ? 'on-open-and-update' : 'off',
    baseBranch: row.baseBranch,
    reportComments: row.reportComments,
  };
}

interface PrDeps {
  db: Db;
  worker: AssessmentWorker;
  analyzerVersion: string;
  writer: GitHubWriter | null;
  publicUrl: string | null;
  log: FastifyBaseLogger;
  /** Esperas entre reintentos de publicar a GitHub (los tests las acortan). */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [2_000, 10_000, 60_000] as const;

/**
 * Publica el resultado de una evaluación en GitHub cuando llega a un estado terminal.
 * Qué falta por publicar vive en `pr_report` (no en memoria): un reinicio lo retoma y un
 * fallo de GitHub se reintenta. Si ya estaba terminal al suscribirse, publica enseguida.
 */
export function reportWhenDone(deps: PrDeps, id: string): void {
  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    unsubscribe();
    await publishWithRetry(deps, id);
  };
  const unsubscribe = deps.worker.subscribe(id, (e) => {
    if (e.type === 'transition' && TERMINAL.has(String((e.payload as { to?: string }).to))) {
      void finish();
    }
  });
  void (async () => {
    const record = await getAssessmentRecord(deps.db, id);
    if (record && TERMINAL.has(record.status)) void finish();
  })();
}

async function publishWithRetry(deps: PrDeps, id: string): Promise<void> {
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      await publishResult(deps, id);
      return;
    } catch (err) {
      if (attempt >= delays.length) {
        deps.log.error(
          { err, assessment: id },
          'failed to report assessment to GitHub; it stays pending and is retried at next start',
        );
        return;
      }
      deps.log.warn({ err, assessment: id, attempt }, 'GitHub report failed; will retry');
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

/** Lanza si GitHub falla: así `publishWithRetry` reintenta y la fila sigue pendiente. */
async function publishResult(deps: PrDeps, id: string): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(schema.prReport)
    .where(eq(schema.prReport.assessmentId, id));
  if (!row || row.reportedAt !== null) return;
  const report = await getAssessmentReport(deps.db, id);
  if (!report) return;
  if (!deps.writer) {
    deps.log.warn({ assessment: id }, 'no write token: result not reported to GitHub');
    return;
  }
  const reportUrl = deps.publicUrl
    ? `${deps.publicUrl}/app/orgs/${row.workspaceId}/assessments/${id}`
    : null;
  const ci = await readCiSettings(deps.db, row.workspaceId);
  await deps.writer.setCommitStatus(row.owner, row.repo, row.headSha, {
    ...statusForReport(report),
    targetUrl: reportUrl,
    context: row.context,
  });
  if (ci.reportComments) {
    const [ws] = await deps.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, row.workspaceId));
    await deps.writer.createIssueComment(
      row.owner,
      row.repo,
      row.number,
      commentBodyFor(report, reportUrl, ws?.name),
    );
  }
  // Sólo tras publicar: si algo falló antes, la fila queda pendiente.
  await deps.db
    .update(schema.prReport)
    .set({ reportedAt: Date.now() })
    .where(eq(schema.prReport.assessmentId, id));
}

/**
 * Al arrancar: retoma lo que quedó a medias. Las evaluaciones no terminales las reanuda el
 * worker (INV 5); aquí se vuelve a enganchar la publicación de cada PR que aún no se publicó.
 */
export async function resumePrReports(deps: PrDeps): Promise<number> {
  const pending = await deps.db
    .select()
    .from(schema.prReport)
    .where(isNull(schema.prReport.reportedAt));
  for (const row of pending) reportWhenDone(deps, row.assessmentId);
  return pending.length;
}

/**
 * Procesa un evento de PR: crea una evaluación por cada repo del workspace que
 * coincida, según el modo CI y el filtro de rama. Devuelve cuántas se crearon.
 */
export async function handlePullRequest(deps: PrDeps, pr: PullRequestEvent): Promise<number> {
  if (!isEvaluated(pr)) return 0;
  const repoRows = await deps.db.select().from(schema.repo);
  const matching: Array<(typeof repoRows)[number]> = [];
  for (const row of repoRows) {
    const gh = parseGithubRepoUri(row.uri);
    if (!gh || gh.owner.toLowerCase() !== pr.owner.toLowerCase()) continue;
    if (gh.repo.toLowerCase() !== pr.repo.toLowerCase()) continue;
    const ci = await readCiSettings(deps.db, row.workspaceId);
    if (ci.mode !== 'on-open-and-update') continue;
    if (ci.baseBranch !== null && ci.baseBranch !== pr.baseRef) continue;
    matching.push(row);
  }
  // Varios workspaces con el mismo repo pisarían el mismo contexto de estado en el mismo
  // commit (gana el último): cada uno publica en el suyo.
  const workspaceIds = [...new Set(matching.map((r) => r.workspaceId))];
  const names = new Map<string, string>();
  if (workspaceIds.length > 1) {
    for (const w of await deps.db.select().from(schema.workspace)) names.set(w.id, w.name);
  }

  let created = 0;
  for (const row of matching) {
    try {
      const { assessment, created: fresh } = await createAssessment({
        db: deps.db,
        worker: deps.worker,
        analyzerVersion: deps.analyzerVersion,
        body: {
          repo: repoDisplayName(row),
          base: pr.baseSha,
          head: pr.headSha,
          orgId: row.workspaceId,
        },
        // El PR de origen: el worker lee de GitHub sus archivos y diffs para la revisión de código.
        pr: {
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          repoId: deriveLainRepoId(row),
          name: repoDisplayName(row),
        },
      });
      // Una entrega repetida devuelve la misma evaluación: no se vuelve a publicar.
      if (!fresh) continue;
      created += 1;
      const context =
        workspaceIds.length > 1
          ? `${STATUS_CONTEXT}/${names.get(row.workspaceId) ?? row.workspaceId}`
          : STATUS_CONTEXT;
      await deps.db
        .insert(schema.prReport)
        .values({
          assessmentId: assessment.id,
          workspaceId: row.workspaceId,
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          headSha: pr.headSha,
          context,
          createdAt: Date.now(),
        })
        .onConflictDoNothing();
      // El PR muestra "analizando" desde ya, no un hueco hasta el resultado.
      if (deps.writer) {
        await deps.writer
          .setCommitStatus(pr.owner, pr.repo, pr.headSha, {
            ...PENDING_STATUS,
            targetUrl: null,
            context,
          })
          .catch((err: unknown) =>
            deps.log.warn({ err, assessment: assessment.id }, 'could not post the pending status'),
          );
      }
      // Primero la suscripción, luego el run: así no se pierde ninguna transición.
      reportWhenDone(deps, assessment.id);
      void deps.worker.run(assessment.id).catch((err: unknown) => {
        deps.log.error({ err, assessment: assessment.id }, 'PR assessment run failed');
      });
    } catch (err) {
      deps.log.error({ err, repo: row.uri, pr: pr.number }, 'could not start PR assessment');
    }
  }
  return created;
}

const CiBody = WorkspaceCiSettings;

export const ciRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/workspaces/:id/ci', { config: { scopes: ['read'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [ws] = await app.db.select().from(schema.workspace).where(eq(schema.workspace.id, id));
    if (!ws) return reply.code(404).send({ error: 'workspace not found' });
    return readCiSettings(app.db, id);
  });

  app.put(
    '/api/workspaces/:id/ci',
    { config: { scopes: ['write'] }, schema: { body: CiBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [ws] = await app.db.select().from(schema.workspace).where(eq(schema.workspace.id, id));
      if (!ws) return reply.code(404).send({ error: 'workspace not found' });
      const body = req.body as WorkspaceCiSettings;
      const row = {
        workspaceId: id,
        mode: body.mode,
        baseBranch: body.baseBranch,
        reportComments: body.reportComments,
        updatedAt: Date.now(),
      };
      await app.db
        .insert(schema.workspaceCi)
        .values(row)
        .onConflictDoUpdate({ target: schema.workspaceCi.workspaceId, set: row });
      return readCiSettings(app.db, id);
    },
  );

  // El webhook necesita el cuerpo crudo para verificar la firma: se parsea aquí
  // dentro de un contexto encapsulado para no tocar el parser JSON del resto de la API.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch (err) {
        // Un cuerpo JSON mal formado es un error del cliente, no del servidor.
        done(Object.assign(err as Error, { statusCode: 400 }), undefined);
      }
    });

    const writer = app.config.githubWriteToken
      ? new GitHubWriter({
          token: app.config.githubWriteToken,
          ...(app.config.githubApiBase ? { apiBase: app.config.githubApiBase } : {}),
        })
      : null;
    const publicUrl = app.config.publicUrl ?? null;

    // Al arrancar se retoma la publicación de los PR que quedaron a medias (reinicio, GitHub caído).
    app.addHook('onReady', async () => {
      const resumed = await resumePrReports({
        db: app.db,
        worker: app.assessmentWorker,
        analyzerVersion: app.lain.analyzerVersion,
        writer,
        publicUrl,
        log: app.log,
      });
      if (resumed > 0) app.log.info({ resumed }, 'resumed pending GitHub reports');
    });

    scope.post('/webhooks/github', async (req, reply) => {
      const secret = app.config.githubWebhookSecret;
      if (!secret) return reply.code(503).send({ error: 'webhooks are not configured' });
      const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const sig = req.headers['x-hub-signature-256'];
      if (!verifySignature(secret, raw, typeof sig === 'string' ? sig : undefined)) {
        return reply.code(401).send({ error: 'invalid signature' });
      }

      const event = req.headers['x-github-event'];
      if (event === 'ping') return reply.code(200).send({ ok: true });
      if (event !== 'pull_request') return reply.code(202).send({ handled: 0, ignored: event });

      const pr = parsePullRequestEvent(req.body);
      if (!pr) return reply.code(400).send({ error: 'pull_request payload is missing fields' });
      const handled = await handlePullRequest(
        {
          db: app.db,
          worker: app.assessmentWorker,
          analyzerVersion: app.lain.analyzerVersion,
          writer,
          publicUrl,
          log: app.log,
        },
        pr,
      );
      return reply.code(202).send({ handled, action: pr.action });
    });
  });
};
