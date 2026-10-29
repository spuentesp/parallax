// Reporte a GitHub y bordes de las rutas de CI. Los logs y el cliente de escritura se
// inyectan por su contrato (handlePullRequest recibe `log` y `writer`); GitHub se
// sustituye por un servidor local en el borde HTTP.
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { GitHubWriter, PENDING_STATUS } from '../src/github/status.js';
import { handlePullRequest, resumePrReports } from '../src/routes/ci.js';
import { buildApp } from '../src/server.js';

const SECRET = 'whsec-test';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const AUTH = { authorization: 'Bearer t' };

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function prFor(overrides: { owner?: string; repo?: string; action?: string } = {}) {
  const owner = overrides.owner ?? 'acme';
  const repo = overrides.repo ?? 'shop';
  return {
    action: overrides.action ?? 'opened',
    owner,
    repo,
    number: 4,
    htmlUrl: `https://github.com/${owner}/${repo}/pull/4`,
    baseRef: 'main',
    headRef: 'feat',
    baseSha: BASE,
    headSha: HEAD,
    isFork: false,
    isDraft: false,
    baseChanged: false,
  };
}

function prPayload(action = 'opened') {
  return {
    action,
    repository: { full_name: 'acme/shop' },
    pull_request: {
      number: 4,
      html_url: 'https://github.com/acme/shop/pull/4',
      base: { ref: 'main', sha: BASE, repo: { full_name: 'acme/shop' } },
      head: { ref: 'feat', sha: HEAD, repo: { full_name: 'acme/shop' } },
    },
  };
}

function signed(payload: unknown, event = 'pull_request', secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': sig,
    },
  };
}

interface Logged {
  level: 'warn' | 'error';
  obj: unknown;
  msg: string;
}

function recordingLog(): { log: FastifyBaseLogger; lines: Logged[] } {
  const lines: Logged[] = [];
  const log = {
    warn: (obj: unknown, msg: string) => lines.push({ level: 'warn', obj, msg }),
    error: (obj: unknown, msg: string) => lines.push({ level: 'error', obj, msg }),
    info: () => undefined,
    debug: () => undefined,
  } as unknown as FastifyBaseLogger;
  return { log, lines };
}

async function untilAsync(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('CI routes edges', { timeout: 30_000 }, () => {
  let dir: string;
  let gh: Server;
  let recorded: Recorded[];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-edges-'));
    recorded = [];
    gh = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        recorded.push({
          method: req.method ?? '',
          url: req.url ?? '',
          body: text ? JSON.parse(text) : null,
        });
        res.statusCode = 201;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    const apiBase = `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`;
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
      githubApiBase: apiBase,
      githubWriteToken: 'write-token',
      githubWebhookSecret: SECRET,
      publicUrl: 'https://parallax.example',
    });
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers 404 when setting CI on an unknown workspace', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/ws_nope/ci',
      headers: AUTH,
      payload: { mode: 'off', baseBranch: null, reportComments: false },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'workspace not found' });
  });

  it('returns mode off exactly when the stored mode is off', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/ci`,
      headers: AUTH,
      payload: { mode: 'off', baseBranch: 'main', reportComments: true },
    });
    const r = await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/ci`, headers: AUTH });
    expect(r.json()).toEqual({ mode: 'off', baseBranch: 'main', reportComments: true });
  });

  it('answers 200 with ok for a ping', async () => {
    const s = signed({ zen: 'ok' }, 'ping');
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('acknowledges other events without evaluating them', async () => {
    const s = signed(prPayload(), 'push');
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ handled: 0, ignored: 'push' });
  });

  it('rejects a pull_request payload that lacks the fields it needs', async () => {
    const s = signed({ action: 'opened', repository: { full_name: 'acme/shop' } });
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'pull_request payload is missing fields' });
  });

  it('answers 401 with the exact error for a bad signature', async () => {
    const s = signed(prPayload(), 'pull_request', 'wrong');
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'invalid signature' });
  });

  it('refuses a malformed JSON body instead of hanging', async () => {
    const raw = Buffer.from('{"action": ');
    const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sig,
      },
      payload: raw,
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('CI webhook disabled without a secret', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-nosecret-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers 503 and accepts nothing when no webhook secret is configured', async () => {
    const s = signed(prPayload(), 'pull_request', SECRET);
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'webhooks are not configured' });
  });
});

describe('handlePullRequest reporting', { timeout: 30_000 }, () => {
  let dir: string;
  let gh: Server;
  let recorded: Recorded[];
  let ghStatus: number;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-handle-'));
    recorded = [];
    ghStatus = 201;
    gh = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        recorded.push({
          method: req.method ?? '',
          url: req.url ?? '',
          body: text ? JSON.parse(text) : null,
        });
        res.statusCode = ghStatus;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    const apiBase = `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`;
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
      githubApiBase: apiBase,
      githubWriteToken: 'write-token',
      githubWebhookSecret: SECRET,
      publicUrl: 'https://parallax.example',
    });
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/ci`,
      headers: AUTH,
      payload: { mode: 'on-open-and-update', baseBranch: null, reportComments: false },
    });
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const deps = (log: FastifyBaseLogger, writer: GitHubWriter | null) => ({
    db: app.db,
    worker: app.assessmentWorker,
    analyzerVersion: app.lain.analyzerVersion,
    writer,
    publicUrl: 'https://parallax.example',
    retryDelaysMs: [],
    log,
  });

  const statusPosts = () => recorded.filter((r) => r.url.includes('/statuses/'));
  /** Los resultados: sin el estado "analizando" con que arranca cada evaluación. */
  const finalPosts = () =>
    statusPosts().filter(
      (r) => (r.body as { description?: string }).description !== PENDING_STATUS.description,
    );

  it('evaluates an acme/shop PR whose owner differs only in case', async () => {
    const { log } = recordingLog();
    const writer = new GitHubWriter({
      token: 'write-token',
      apiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
    });
    const n = await handlePullRequest(deps(log, writer), prFor({ owner: 'ACME', repo: 'SHOP' }));
    expect(n).toBe(1);
  });

  it('skips repos of another owner, another name, or a non-GitHub host', async () => {
    const { log } = recordingLog();
    const writer = new GitHubWriter({ token: 'write-token' });
    expect(await handlePullRequest(deps(log, writer), prFor({ owner: 'other' }))).toBe(0);
    expect(await handlePullRequest(deps(log, writer), prFor({ repo: 'other' }))).toBe(0);
    await app.db.update(schema.repo).set({ uri: 'https://gitlab.com/acme/shop.git' });
    expect(await handlePullRequest(deps(log, writer), prFor())).toBe(0);
  });

  it('warns and posts nothing when there is no write token, and never errors', async () => {
    const { log, lines } = recordingLog();
    const n = await handlePullRequest(deps(log, null), prFor());
    expect(n).toBe(1);
    await until(() => lines.some((l) => l.level === 'warn'));
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
    expect(lines.find((l) => l.level === 'warn')?.msg).toBe(
      'no write token: result not reported to GitHub',
    );
    expect(finalPosts()).toHaveLength(0);
  });

  it('logs an error, not a warning, when GitHub rejects the write', async () => {
    ghStatus = 403;
    const { log, lines } = recordingLog();
    const writer = new GitHubWriter({
      token: 'write-token',
      apiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
    });
    await handlePullRequest(deps(log, writer), prFor());
    await until(() => lines.some((l) => l.level === 'error'));
    const err = lines.find((l) => l.level === 'error');
    expect(err?.msg).toBe(
      'failed to report assessment to GitHub; it stays pending and is retried at next start',
    );
  });

  it('posts the cancelled assessment with the report link', async () => {
    const { log, lines } = recordingLog();
    const writer = new GitHubWriter({
      token: 'write-token',
      apiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
    });
    await handlePullRequest(deps(log, writer), prFor());
    const [row] = await app.db.select().from(schema.assessment);
    expect(row).toBeDefined();
    await app.assessmentWorker.transition(row?.id ?? '', 'CANCELLED');
    await until(() => finalPosts().length === 1);
    const sent = finalPosts()[0]?.body as {
      state: string;
      description: string;
      target_url: string;
    };
    expect(sent.target_url).toBe(
      `https://parallax.example/app/orgs/${wsId}/assessments/${row?.id}`,
    );
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  // El worker real, con `run` sustituido: la evaluación queda QUEUED y cada estado
  // terminal lo llevamos nosotros con transition(), por el camino de escritura real.
  // Sin esto, el run en curso compite con las transiciones del test (ver el hallazgo
  // de la cola de eventos en el worker).
  const parkedWorker = (run: (id: string) => Promise<unknown>) =>
    new Proxy(app.assessmentWorker, {
      get(target, prop) {
        if (prop === 'run') return run;
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });

  const parkedDeps = (
    log: FastifyBaseLogger,
    writer: GitHubWriter | null,
    worker: typeof app.assessmentWorker,
  ) => ({
    db: app.db,
    worker,
    analyzerVersion: app.lain.analyzerVersion,
    writer,
    publicUrl: 'https://parallax.example',
    retryDelaysMs: [],
    log,
  });

  const onlyAssessmentId = async (): Promise<string> => {
    const rows = await app.db.select().from(schema.assessment);
    expect(rows).toHaveLength(1);
    return rows[0]?.id ?? '';
  };

  const writerFor = () =>
    new GitHubWriter({
      token: 'write-token',
      apiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
    });

  it('stays silent through non-terminal states and reports once the assessment is terminal', async () => {
    const { log, lines } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await new Promise((r) => setTimeout(r, 100));
    expect(finalPosts()).toHaveLength(0);
    await app.assessmentWorker.transition(id, 'PARTIAL');
    await until(() => finalPosts().length === 1);
    expect(finalPosts()[0]?.body).toMatchObject({ state: 'error' });
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  it('reports a failed assessment as error with the exact text', async () => {
    const { log, lines } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'FAILED', { error: 'engine down' });
    await until(() => finalPosts().length === 1);
    expect(finalPosts()[0]?.body).toMatchObject({
      state: 'error',
      description: 'Parallax assessment failed; no result.',
      context: 'parallax/assessment',
    });
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  it('reports a cancelled assessment as inconclusive (error), never as success', async () => {
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'CANCELLED');
    await until(() => finalPosts().length === 1);
    expect(finalPosts()[0]?.body).toMatchObject({
      state: 'error',
      description: 'No result conclusive: coverage is incomplete',
    });
  });

  it('reports a ready assessment that has no coverage record as inconclusive (error)', async () => {
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await app.assessmentWorker.transition(id, 'EXPLAINING');
    await app.assessmentWorker.transition(id, 'READY');
    await until(() => finalPosts().length === 1);
    expect(finalPosts()[0]?.body).toMatchObject({ state: 'error' });
  });

  it('logs a failed run with the assessment id and the error', async () => {
    const { log, lines } = recordingLog();
    const boom = new Error('run exploded');
    const worker = parkedWorker(async () => {
      throw boom;
    });
    await handlePullRequest(parkedDeps(log, null, worker), prFor());
    await until(() => lines.some((l) => l.msg === 'PR assessment run failed'));
    const line = lines.find((l) => l.msg === 'PR assessment run failed');
    const id = await onlyAssessmentId();
    expect(line?.level).toBe('error');
    expect(line?.obj).toMatchObject({ assessment: id, err: boom });
  });

  it('logs a PR that could not start an assessment, and creates none', async () => {
    const { log, lines } = recordingLog();
    const boom = new Error('db down');
    const worker = new Proxy(app.assessmentWorker, {
      get(target, prop) {
        if (prop === 'create') return async () => Promise.reject(boom);
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const n = await handlePullRequest(parkedDeps(log, null, worker), prFor());
    expect(n).toBe(0);
    const line = lines.find((l) => l.msg === 'could not start PR assessment');
    expect(line?.level).toBe('error');
    expect(line?.obj).toMatchObject({ err: boom, repo: 'https://github.com/acme/shop.git', pr: 4 });
    expect(await app.db.select().from(schema.assessment)).toHaveLength(0);
  });

  it('names the assessment in the no-write-token warning', async () => {
    const { log, lines } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, null, worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await app.assessmentWorker.transition(id, 'PARTIAL');
    await until(() => lines.some((l) => l.level === 'warn'));
    expect(lines.find((l) => l.level === 'warn')?.obj).toEqual({ assessment: id });
  });

  it('names the assessment in the error when GitHub rejects the status', async () => {
    ghStatus = 403;
    const { log, lines } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await app.assessmentWorker.transition(id, 'PARTIAL');
    await until(() => lines.some((l) => l.level === 'error'));
    expect(lines.find((l) => l.level === 'error')?.obj).toMatchObject({ assessment: id });
  });

  it('shows an "analyzing" status as soon as the assessment starts, before any result', async () => {
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor());
    await until(() => statusPosts().length === 1);
    expect(statusPosts()[0]?.body).toMatchObject({
      state: 'pending',
      description: PENDING_STATUS.description,
      context: 'parallax/assessment',
    });
    expect(finalPosts()).toHaveLength(0);
  });

  it('retries a transient GitHub failure and marks the report as published', async () => {
    ghStatus = 500;
    const { log, lines } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(
      { ...parkedDeps(log, writerFor(), worker), retryDelaysMs: [30, 30] },
      prFor(),
    );
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await app.assessmentWorker.transition(id, 'PARTIAL');
    await until(() => finalPosts().length >= 1);
    ghStatus = 201;
    await until(() => finalPosts().length >= 2);
    await untilAsync(async () => {
      const [row] = await app.db.select().from(schema.prReport);
      return row?.reportedAt != null;
    });
    expect(
      lines.some((l) => l.level === 'warn' && l.msg === 'GitHub report failed; will retry'),
    ).toBe(true);
  });

  it('a report that never got through stays pending and the next start publishes it once', async () => {
    ghStatus = 500;
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor()); // sin reintentos
    const id = await onlyAssessmentId();
    await app.assessmentWorker.transition(id, 'SNAPSHOTTING');
    await app.assessmentWorker.transition(id, 'ANALYZING');
    await app.assessmentWorker.transition(id, 'PARTIAL');
    await until(() => finalPosts().length === 1);
    await new Promise((r) => setTimeout(r, 50));
    const [pending] = await app.db.select().from(schema.prReport);
    expect(pending?.reportedAt).toBeNull();

    // "Siguiente arranque": GitHub ya responde y se retoma lo pendiente.
    ghStatus = 201;
    expect(await resumePrReports(parkedDeps(log, writerFor(), worker))).toBe(1);
    await until(() => finalPosts().length === 2);
    await untilAsync(async () => {
      const [row] = await app.db.select().from(schema.prReport);
      return row?.reportedAt != null;
    });
    // Ya publicado: otro arranque no lo vuelve a publicar.
    expect(await resumePrReports(parkedDeps(log, writerFor(), worker))).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(finalPosts()).toHaveLength(2);
  });

  it('does not evaluate a draft, evaluates it once it is ready, and re-evaluates an edited base', async () => {
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    const d = parkedDeps(log, writerFor(), worker);
    expect(await handlePullRequest(d, { ...prFor(), isDraft: true })).toBe(0);
    expect(await handlePullRequest(d, { ...prFor({ action: 'synchronize' }), isDraft: true })).toBe(
      0,
    );
    expect(await handlePullRequest(d, { ...prFor({ action: 'edited' }) })).toBe(0); // sin cambio de base
    expect(await handlePullRequest(d, { ...prFor({ action: 'edited' }), baseChanged: true })).toBe(
      1,
    );
  });

  it('a draft that becomes ready is evaluated', async () => {
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    expect(
      await handlePullRequest(
        parkedDeps(log, writerFor(), worker),
        prFor({ action: 'ready_for_review' }),
      ),
    ).toBe(1);
  });

  it('two workspaces sharing a repo each get their own evaluation and their own status context', async () => {
    const second = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'storefront-team' },
    });
    const ws2 = second.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop2',
      workspaceId: ws2,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/workspaces/${ws2}/ci`,
      headers: AUTH,
      payload: { mode: 'on-open-and-update', baseBranch: null, reportComments: false },
    });
    const { log } = recordingLog();
    const worker = parkedWorker(async () => undefined);
    expect(await handlePullRequest(parkedDeps(log, writerFor(), worker), prFor())).toBe(2);
    await until(() => statusPosts().length === 2);
    const contexts = statusPosts()
      .map((p) => (p.body as { context: string }).context)
      .sort();
    expect(contexts).toEqual(['parallax/assessment/shop', 'parallax/assessment/storefront-team']);
    const orgs = (await app.db.select().from(schema.assessment)).map((a) => a.orgId).sort();
    expect(orgs).toEqual([wsId, ws2].sort());
  });
});

describe('CI routes authorization and not-found bodies', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-auth-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 'reader', orgId: 'o', scopes: ['read'] },
        { token: 'writer', orgId: 'o', scopes: ['write'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { authorization: 'Bearer writer' },
      payload: { name: 'shop' },
    });
    wsId = ws.json().workspace.id as string;
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets a read token read CI settings and refuses it to change them', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/ci`,
      headers: { authorization: 'Bearer reader' },
    });
    expect(read.statusCode).toBe(200);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/ci`,
      headers: { authorization: 'Bearer reader' },
      payload: { mode: 'off', baseBranch: null, reportComments: false },
    });
    expect(put.statusCode).toBe(403);
  });

  it('refuses to read CI settings with a token that has only write scope', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/ci`,
      headers: { authorization: 'Bearer writer' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('answers the exact not-found body for an unknown workspace on read', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/workspaces/ws_nope/ci',
      headers: { authorization: 'Bearer reader' },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'workspace not found' });
  });
});
