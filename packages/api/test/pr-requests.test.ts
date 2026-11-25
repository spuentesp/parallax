// Asking for the analysis of a pull request from outside (the Jira panel): POST /api/pr-requests.
// Real git (local bare repos stand in for GitHub's git side), a GitHub API stub at the HTTP edge,
// the real database and the real write path. The gate tests hold back the pipeline's `run` so an
// assessment stays queued (otherwise the mock engine finishes it instantly); everything else is real.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssessmentId } from '@parallax/shared/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { githubReaderFor } from '../src/github/reader.js';
import { buildApp } from '../src/server.js';
import {
  createPrRequestGate,
  MAX_REQUESTS_PER_HOUR,
  parseAllowlist,
} from '../src/services/pr-requests.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
    },
  ).trim();

const READ_REQUEST = { authorization: 'Bearer rq' };
const READ_ONLY = { authorization: 'Bearer ro' };
const WRITE = { authorization: 'Bearer wr' };
const WS = 'ws_shop';
const MINUTE = 60_000;

describe('requesting the analysis of a pull request', () => {
  let dir: string;
  let gh: Server;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let local: string;
  const prs = new Map<number, { base: string; head: string }>();

  // A pull request in the fake remote: a commit on top of base, published as refs/pull/N/head.
  const makePr = (n: number) => {
    const work = join(dir, 'work');
    git(work, 'checkout', '-q', '-B', `pr-${String(n)}`, 'main');
    writeFileSync(join(work, `f${String(n)}.txt`), `change ${String(n)}`);
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', `pr ${String(n)}`);
    const head = git(work, 'rev-parse', 'HEAD');
    const base = git(work, 'rev-parse', 'main');
    git(work, 'push', '-q', 'remote', `${head}:refs/pull/${String(n)}/head`);
    prs.set(n, { base, head });
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-prreq-'));
    prs.clear();
    const remote = join(dir, 'remote', 'Acme', 'Shop.git');
    mkdirSync(remote, { recursive: true });
    git(remote, 'init', '-q', '--bare');
    git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const work = join(dir, 'work');
    mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, 'a.txt'), 'base');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'base');
    git(work, 'remote', 'add', 'remote', remote);
    git(work, 'push', '-q', 'remote', 'main');
    for (let n = 4; n <= 4 + MAX_REQUESTS_PER_HOUR + 1; n++) makePr(n);

    local = join(dir, 'checkout', 'Shop');
    mkdirSync(local, { recursive: true });
    git(local, 'init', '-q');

    gh = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/files')) {
        res.end(JSON.stringify([{ filename: 'f.txt', status: 'added' }]));
        return;
      }
      const n = Number(/\/pulls\/(\d+)/.exec(req.url ?? '')?.[1] ?? 0);
      const p = prs.get(n);
      if (!p) {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          number: n,
          html_url: `https://github.com/Acme/Shop/pull/${String(n)}`,
          title: 't',
          state: 'open',
          user: { login: 'dev' },
          base: { ref: 'main', sha: p.base },
          head: { ref: 'feat', sha: p.head },
        }),
      );
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [
        { token: 'rq', orgId: 'o', scopes: ['read', 'request'] },
        { token: 'ro', orgId: 'o', scopes: ['read'] },
        { token: 'wr', orgId: 'o', scopes: ['read', 'write'] },
      ],
      webBundlePath: join(dir, 'web'),
      githubApiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
      githubGitBase: `file://${join(dir, 'remote')}`,
      requestAllowlist: `Acme/Shop=${WS}`,
    });
    await app.db.insert(schema.workspace).values({ id: WS, name: 'shop', createdAt: Date.now() });
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: WS,
      uri: 'https://github.com/Acme/Shop.git',
      local,
      createdAt: Date.now(),
    });
  });

  afterEach(async () => {
    await app.assessmentWorker.drain();
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (headers: Record<string, string>, n: number) =>
    app.inject({
      method: 'POST',
      url: '/api/pr-requests',
      headers,
      payload: { prUrl: `https://github.com/Acme/Shop/pull/${String(n)}` },
    });

  describe('over HTTP', () => {
    it('starts the analysis and puts the pull request commits on branches of the checkout', async () => {
      const r = await post(READ_REQUEST, 4);
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('started');
      const id = r.json().assessmentId as string;

      const p = prs.get(4) as { base: string; head: string };
      expect(git(local, 'rev-parse', 'parallax-pr-4-base')).toBe(p.base);
      expect(git(local, 'rev-parse', 'parallax-pr-4-head')).toBe(p.head);

      await app.assessmentWorker.drain();
      const got = await app.inject({
        method: 'GET',
        url: `/api/assessments/${id}`,
        headers: READ_ONLY,
      });
      expect(got.json().assessment.manifest.pr).toMatchObject({
        owner: 'Acme',
        repo: 'Shop',
        number: 4,
      });
    });

    it('answers "exists" instead of doing the work twice', async () => {
      const first = (await post(READ_REQUEST, 4)).json().assessmentId as string;
      await app.assessmentWorker.drain();
      const again = await post(READ_REQUEST, 4);
      expect([200, 202]).toContain(again.statusCode);
      expect(again.json().assessmentId).toBe(first);
    });

    it('lets a read+request token ask, and nothing more', async () => {
      // Cannot start an assessment directly, which has no allowlist and no limits.
      const direct = await app.inject({
        method: 'POST',
        url: '/api/assessments',
        headers: READ_REQUEST,
        payload: { prUrl: 'https://github.com/Acme/Shop/pull/4', orgId: WS },
      });
      expect(direct.statusCode).toBe(403);
      // A read-only token cannot ask, and a write token without `request` cannot either.
      expect((await post(READ_ONLY, 4)).statusCode).toBe(403);
      expect((await post(WRITE, 4)).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: '/api/pr-requests', payload: {} })).statusCode,
      ).toBe(401);
    });

    it('refuses a repository that is not on the list, and says which', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/pr-requests',
        headers: READ_REQUEST,
        payload: { prUrl: 'https://github.com/Evil/Other/pull/1' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().status).toBe('not-allowed');
      expect(r.json().detail).toContain('Evil/Other');
    });

    it('refuses something that is not a pull request URL', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/pr-requests',
        headers: READ_REQUEST,
        payload: { prUrl: 'https://example.com/x' },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().status).toBe('invalid');
    });

    it('reports a git failure instead of starting an analysis it cannot run', async () => {
      prs.set(9, { base: 'f'.repeat(40), head: 'e'.repeat(40) }); // commits that do not exist
      const r = await post(READ_REQUEST, 9);
      expect(r.statusCode).toBe(502);
      expect(r.json().status).toBe('git-fetch-failed');
      expect(
        (await app.inject({ method: 'GET', url: '/api/assessments', headers: READ_ONLY })).json()
          .assessments,
      ).toEqual([]);
    });
  });

  describe('the limits, with the pipeline held back', () => {
    let clock: number;
    const heldWorker = () =>
      new Proxy(app.assessmentWorker, {
        get(target, prop, receiver) {
          if (prop === 'run') return () => new Promise<void>(() => undefined);
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    const gate = (allowlist = `Acme/Shop=${WS}`) => {
      clock = Date.now();
      return createPrRequestGate({
        db: app.db,
        worker: heldWorker(),
        analyzerVersion: app.lain.analyzerVersion,
        github: githubReaderFor(app.config),
        allowlist: parseAllowlist(allowlist),
        gitBase: `file://${join(dir, 'remote')}`,
        now: () => clock,
      });
    };
    const url = (n: number) => `https://github.com/Acme/Shop/pull/${String(n)}`;

    it('is off when no repository is on the list', async () => {
      const out = await gate('')(url(4));
      expect(out).toMatchObject({ code: 403, status: 'disabled' });
    });

    it('runs one analysis at a time for the whole server', async () => {
      const ask = gate();
      const first = await ask(url(4));
      expect(first).toMatchObject({ code: 202, status: 'started' });
      // The same pull request: it is already running.
      expect(await ask(url(4))).toMatchObject({ code: 202, status: 'running' });
      // A different one: the engine is busy.
      expect(await ask(url(5))).toMatchObject({ code: 429, status: 'busy' });
    });

    it('waits after a failure, then allows a retry with a new attempt', async () => {
      const ask = gate();
      const first = await ask(url(4));
      if (first.status !== 'started') throw new Error('expected started');
      await app.assessmentWorker.transition(first.assessmentId as AssessmentId, 'FAILED', {
        error: 'engine timeout',
      });

      const soon = await ask(url(4));
      expect(soon).toMatchObject({ code: 429, status: 'cooling-down' });
      expect((soon as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);

      clock += 11 * MINUTE;
      const retry = await ask(url(4));
      expect(retry).toMatchObject({ code: 202, status: 'started' });
      // The failed attempt owns its digest, so the retry is a different assessment.
      expect((retry as { assessmentId: string }).assessmentId).not.toBe(first.assessmentId);
    });

    it('caps how many analyses can be requested per hour, then frees up', async () => {
      const ask = gate();
      for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i++) {
        const out = await ask(url(4 + i));
        expect(out, `request ${String(i + 1)}`).toMatchObject({ code: 202, status: 'started' });
        // Cancel it so that only the hourly cap, not "busy", can refuse the next one.
        await app.assessmentWorker.transition(
          (out as { assessmentId: string }).assessmentId as AssessmentId,
          'CANCELLED',
          {},
        );
      }
      const over = await ask(url(4 + MAX_REQUESTS_PER_HOUR));
      expect(over).toMatchObject({ code: 429, status: 'rate-limited' });

      clock += 61 * MINUTE;
      expect(await ask(url(4 + MAX_REQUESTS_PER_HOUR))).toMatchObject({
        code: 202,
        status: 'started',
      });
    });
  });
});
