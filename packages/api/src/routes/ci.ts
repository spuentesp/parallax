// CI automática por workspace y webhook de pull_request. Al abrir o actualizar un
// PR de un repo del workspace (si el modo lo permite) se crea una evaluación para
// (base, head) y, al terminar, se publica el resultado en GitHub: siempre un commit
// status; un comentario sólo si el workspace lo activó.

import { createHash, timingSafeEqual } from 'node:crypto';
import { WorkspaceCiSettings } from '@parallax/shared/domain';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { deriveLainRepoId } from '../code-graph.js';
import * as schema from '../db/schema.js';
import { parseGithubRepoUri } from '../github/reader.js';
import { commentBodyFor, GitHubWriter, STATUS_CONTEXT } from '../github/status.js';
import {
  isEvaluated,
  type PullRequestEvent,
  parsePullRequestEvent,
  verifySignature,
} from '../github/webhook.js';
import { gitlabReaderFor, parseGitLabRepoUri } from '../gitlab/reader.js';
import { GitLabWriter } from '../gitlab/writer.js';
import {
  createAssessment,
  getAssessmentRecord,
  getAssessmentReport,
  repoDisplayName,
} from '../services/assessments.js';
import type { AssessmentWorker } from '../worker/assessment-worker.js';

type Db = Parameters<typeof createAssessment>[0]['db'];

const TERMINAL = new Set(['READY', 'PARTIAL', 'FAILED', 'CANCELLED']);
const DEFAULT_CI: WorkspaceCiSettings = { mode: 'off', baseBranch: null, reportComments: true };

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
  gitlabWriter?: GitLabWriter | null;
  gitlabHost?: string | undefined;
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
  const ci = await readCiSettings(deps.db, row.workspaceId);
  const writer = row.provider === 'gitlab' ? deps.gitlabWriter : deps.writer;
  if (ci.reportComments && !writer) {
    deps.log.warn(
      { assessment: id },
      row.provider === 'gitlab'
        ? 'no write token: result not reported to GitLab'
        : 'no write token: result not reported to GitHub',
    );
    return;
  }
  const reportUrl = deps.publicUrl
    ? `${deps.publicUrl}/app/orgs/${row.workspaceId}/assessments/${id}`
    : null;
  if (ci.reportComments && writer) {
    const [ws] = await deps.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, row.workspaceId));
    await writer.createIssueComment(
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
    const gh =
      pr.provider === 'gitlab'
        ? parseGitLabRepoUri(row.uri, deps.gitlabHost)
        : parseGithubRepoUri(row.uri);
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
  let failed = false;
  for (const row of matching) {
    try {
      const context =
        workspaceIds.length > 1
          ? `${STATUS_CONTEXT}/${names.get(row.workspaceId) ?? row.workspaceId}`
          : STATUS_CONTEXT;
      const {
        assessment,
        created: fresh,
        reportCreated,
      } = await createAssessment({
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
          ...(pr.provider === 'gitlab' ? { provider: 'gitlab' as const } : {}),
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          repoId: deriveLainRepoId(row),
          name: repoDisplayName(row),
        },
        report: {
          provider: pr.provider ?? 'github',
          workspaceId: row.workspaceId,
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          headSha: pr.headSha,
          context,
          createdAt: Date.now(),
        },
      });
      if (fresh) created += 1;
      // A duplicate delivery repairs a report missing after an interrupted creation.
      // Existing rows already have a subscriber (or are recovered on startup).
      if (!reportCreated) continue;
      // Primero la suscripción, luego el run: así no se pierde ninguna transición.
      reportWhenDone(deps, assessment.id);
      void deps.worker.run(assessment.id).catch((err: unknown) => {
        deps.log.error({ err, assessment: assessment.id }, 'PR assessment run failed');
      });
    } catch (err) {
      failed = true;
      deps.log.error({ err, repo: row.uri, pr: pr.number }, 'could not start PR assessment');
    }
  }
  if (failed && pr.provider === 'gitlab')
    throw new Error('one or more GitLab assessments could not start');
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
    const gitlabWriter = app.config.gitlabWriteToken
      ? new GitLabWriter({
          token: app.config.gitlabWriteToken,
          ...(app.config.gitlabApiBase ? { apiBase: app.config.gitlabApiBase } : {}),
        })
      : null;
    const publicUrl = app.config.publicUrl ?? null;
    const inboxRuns = new Map<string, Promise<void>>();
    const inboxTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const inboxAttempts = new Map<string, number>();
    let closingInbox = false;
    const runInbox = (id: string): Promise<void> => {
      const existing = inboxRuns.get(id);
      if (existing) return existing;
      const run = (async () => {
        const [item] = await app.db
          .select()
          .from(schema.gitlabWebhookInbox)
          .where(eq(schema.gitlabWebhookInbox.id, id));
        if (!item || item.completedAt !== null) return;
        try {
          const mr = await gitlabReaderFor(app.config).fetchPr(item.url);
          if (
            mr.headSha.toLowerCase() === item.headSha.toLowerCase() &&
            mr.state === 'opened' &&
            !mr.draft
          ) {
            await handlePullRequest(
              {
                db: app.db,
                worker: app.assessmentWorker,
                analyzerVersion: app.lain.analyzerVersion,
                writer,
                gitlabWriter,
                gitlabHost: app.config.gitlabHost,
                publicUrl,
                log: app.log,
              },
              {
                provider: 'gitlab',
                action: 'opened',
                owner: mr.ref.owner,
                repo: mr.ref.repo,
                number: mr.ref.number,
                htmlUrl: mr.url,
                baseRef: mr.baseRef,
                headRef: mr.headRef,
                baseSha: mr.baseSha,
                headSha: mr.headSha,
                isFork: false,
                isDraft: false,
                baseChanged: false,
              },
            );
          }
          await app.db
            .update(schema.gitlabWebhookInbox)
            .set({ completedAt: Date.now() })
            .where(eq(schema.gitlabWebhookInbox.id, id));
          inboxAttempts.delete(id);
        } catch (err) {
          app.log.warn({ err, delivery: id }, 'GitLab webhook processing failed; will retry');
          if (!closingInbox) {
            const attempts = inboxAttempts.get(id) ?? 0;
            inboxAttempts.set(id, attempts + 1);
            const delay = [2000, 10000, 60000, 300000][Math.min(attempts, 3)] ?? 300000;
            const timer = setTimeout(() => {
              inboxTimers.delete(id);
              void runInbox(id);
            }, delay);
            inboxTimers.set(id, timer);
          }
        }
      })().finally(() => {
        inboxRuns.delete(id);
      });
      inboxRuns.set(id, run);
      return run;
    };
    app.addHook('onReady', async () => {
      const pending = await app.db
        .select()
        .from(schema.gitlabWebhookInbox)
        .where(isNull(schema.gitlabWebhookInbox.completedAt));
      for (const item of pending) void runInbox(item.id);
    });
    app.addHook('onClose', async () => {
      closingInbox = true;
      for (const timer of inboxTimers.values()) clearTimeout(timer);
      await Promise.allSettled([...inboxRuns.values()]);
    });

    // Al arrancar se retoma la publicación de los PR que quedaron a medias (reinicio, GitHub caído).
    app.addHook('onReady', async () => {
      const resumed = await resumePrReports({
        db: app.db,
        worker: app.assessmentWorker,
        analyzerVersion: app.lain.analyzerVersion,
        writer,
        gitlabWriter,
        gitlabHost: app.config.gitlabHost,
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

    scope.post('/webhooks/gitlab', async (req, reply) => {
      const secret = app.config.gitlabWebhookSecret;
      if (!secret) return reply.code(503).send({ error: 'webhooks are not configured' });
      const token = req.headers['x-gitlab-token'];
      const expected = Buffer.from(secret);
      const received = Buffer.from(typeof token === 'string' ? token : '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected))
        return reply.code(401).send({ error: 'invalid webhook token' });
      const event = req.body as {
        object_kind?: string;
        project?: { path_with_namespace?: string };
        object_attributes?: {
          action?: string;
          iid?: number;
          source_project_id?: number;
          target_project_id?: number;
          draft?: boolean;
          work_in_progress?: boolean;
          oldrev?: string;
          last_commit?: { id?: string };
        };
        changes?: { draft?: { current?: boolean }; target_branch?: unknown };
      };
      if (event.object_kind !== 'merge_request')
        return reply.code(202).send({ handled: 0, ignored: event.object_kind });
      const attrs = event.object_attributes;
      const path = event.project?.path_with_namespace;
      if (
        !attrs ||
        !Number.isSafeInteger(attrs.iid) ||
        (attrs.iid ?? 0) <= 0 ||
        typeof path !== 'string' ||
        !path ||
        typeof attrs.last_commit?.id !== 'string' ||
        !/^[a-f\d]{40,64}$/i.test(attrs.last_commit.id) ||
        !Number.isSafeInteger(attrs.source_project_id) ||
        !Number.isSafeInteger(attrs.target_project_id) ||
        (attrs.source_project_id ?? 0) <= 0 ||
        (attrs.target_project_id ?? 0) <= 0
      )
        return reply.code(400).send({ error: 'merge request payload is missing fields' });
      const updated =
        attrs.action === 'update' &&
        (!!attrs.oldrev ||
          event.changes?.draft?.current === false ||
          event.changes?.target_branch !== undefined);
      if (!['open', 'reopen'].includes(attrs.action ?? '') && !updated)
        return reply.code(202).send({ handled: 0, ignored: attrs.action });
      if (
        attrs.draft ||
        attrs.work_in_progress ||
        attrs.source_project_id !== attrs.target_project_id
      )
        return reply.code(202).send({ handled: 0, ignored: 'draft or fork' });
      const url = `https://${app.config.gitlabHost ?? 'gitlab.com'}/${path}/-/merge_requests/${attrs.iid}`;
      const reader = gitlabReaderFor(app.config);
      if (!reader.canHandle(url))
        return reply.code(400).send({ error: 'invalid GitLab project path' });
      const id = createHash('sha256').update(JSON.stringify(event)).digest('hex');
      const inserted = await app.db
        .insert(schema.gitlabWebhookInbox)
        .values({ id, url, headSha: attrs.last_commit.id, createdAt: Date.now() })
        .onConflictDoNothing()
        .returning({ id: schema.gitlabWebhookInbox.id });
      if (inserted.length) void runInbox(id);
      return reply.code(202).send({ queued: inserted.length > 0, action: attrs.action });
    });
  });
};
