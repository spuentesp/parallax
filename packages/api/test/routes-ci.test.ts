// Rutas de CI automática y webhook. GitHub se sustituye por un servidor local en el
// borde HTTP (PARALLAX_GITHUB_API_BASE): aquí se registran los POST de estado y
// comentario, y se comprueba lo que de verdad llegaría a GitHub.
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const SECRET = 'whsec-test';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const AUTH = { authorization: 'Bearer t' };

interface Recorded {
  method: string;
  url: string;
  auth: string | undefined;
  body: unknown;
}

function prEvent(
  overrides: { action?: string; headRepo?: string; baseRef?: string; head?: string } = {},
) {
  return {
    action: overrides.action ?? 'opened',
    repository: { full_name: 'acme/shop' },
    pull_request: {
      number: 4,
      html_url: 'https://github.com/acme/shop/pull/4',
      base: { ref: overrides.baseRef ?? 'main', sha: BASE, repo: { full_name: 'acme/shop' } },
      head: {
        ref: 'feat',
        sha: overrides.head ?? HEAD,
        repo: { full_name: overrides.headRepo ?? 'acme/shop' },
      },
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

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Una evaluación real corre el worker de verdad: más que el timeout por defecto de 5 s.
describe('CI automática y webhook de pull_request', { timeout: 30_000 }, () => {
  let dir: string;
  let gh: Server;
  let recorded: Recorded[];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-'));
    recorded = [];
    gh = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        recorded.push({
          method: req.method ?? '',
          url: req.url ?? '',
          auth: req.headers.authorization,
          body: text ? JSON.parse(text) : null,
        });
        res.setHeader('content-type', 'application/json');
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

  const setCi = (body: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/workspaces/${wsId}/ci`, headers: AUTH, payload: body });

  const deliver = (payload: unknown, event = 'pull_request', secret = SECRET) => {
    const s = signed(payload, event, secret);
    return app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: s.headers,
      payload: s.raw,
    });
  };

  const statusPosts = () => recorded.filter((r) => r.url.includes('/statuses/'));

  describe('configuración por workspace', () => {
    it('defaults to off, with no branch filter and no comments', async () => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${wsId}/ci`,
        headers: AUTH,
      });
      expect(r.json()).toEqual({ mode: 'off', baseBranch: null, reportComments: false });
    });

    it('stores and returns what was set', async () => {
      const put = await setCi({
        mode: 'on-open-and-update',
        baseBranch: 'main',
        reportComments: true,
      });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${wsId}/ci`,
        headers: AUTH,
      });
      expect(get.json()).toEqual({
        mode: 'on-open-and-update',
        baseBranch: 'main',
        reportComments: true,
      });
    });

    it('rejects an unknown mode', async () => {
      const r = await setCi({ mode: 'always', baseBranch: null, reportComments: false });
      expect(r.statusCode).toBe(400);
    });

    it('answers 404 for an unknown workspace', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/workspaces/ws_nope/ci',
        headers: AUTH,
      });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('webhook', () => {
    it('refuses a delivery with a bad signature', async () => {
      const r = await deliver(prEvent(), 'pull_request', 'wrong-secret');
      expect(r.statusCode).toBe(401);
    });

    it('answers ping without doing anything', async () => {
      const r = await deliver({ zen: 'ok' }, 'ping');
      expect(r.statusCode).toBe(200);
    });

    it('evaluates nothing while the workspace CI is off', async () => {
      const r = await deliver(prEvent());
      expect(r.json().handled).toBe(0);
      await new Promise((res) => setTimeout(res, 100));
      expect(statusPosts()).toHaveLength(0);
    });

    it('evaluates an opened PR and posts the status to the head SHA', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: false });
      const r = await deliver(prEvent());
      expect(r.json().handled).toBe(1);

      await until(() => statusPosts().length === 1);
      const post = statusPosts()[0];
      expect(post?.url).toBe(`/repos/acme/shop/statuses/${HEAD}`);
      expect(post?.auth).toBe('Bearer write-token');
      expect(post?.body).toMatchObject({ context: 'parallax/assessment' });
      const sent = post?.body as { target_url?: string } | undefined;
      expect(sent?.target_url).toContain(`/app/orgs/${wsId}/assessments/`);
    });

    it('does not post a comment unless the workspace asked for one', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: false });
      await deliver(prEvent());
      await until(() => statusPosts().length === 1);
      expect(recorded.filter((r) => r.url.includes('/comments'))).toHaveLength(0);
    });

    it('posts a comment too when the workspace enabled comments', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: true });
      await deliver(prEvent());
      await until(() => recorded.some((r) => r.url === '/repos/acme/shop/issues/4/comments'));
      const comment = recorded.find((r) => r.url === '/repos/acme/shop/issues/4/comments');
      const sent = comment?.body as { body?: string } | undefined;
      expect(sent?.body).toContain('### Parallax assessment');
    });

    it('ignores PRs from a fork', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: false });
      const r = await deliver(prEvent({ headRepo: 'stranger/shop' }));
      expect(r.json().handled).toBe(0);
    });

    it('evaluates only PRs whose base matches the branch filter', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: 'release', reportComments: false });
      expect((await deliver(prEvent({ baseRef: 'main' }))).json().handled).toBe(0);
      expect((await deliver(prEvent({ baseRef: 'release' }))).json().handled).toBe(1);
    });

    it('ignores actions that do not change the code under review', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: false });
      const r = await deliver(prEvent({ action: 'labeled' }));
      expect(r.json().handled).toBe(0);
    });

    it('does not evaluate or post twice when GitHub redelivers the same event', async () => {
      await setCi({ mode: 'on-open-and-update', baseBranch: null, reportComments: false });
      await deliver(prEvent());
      await until(() => statusPosts().length === 1);
      const again = await deliver(prEvent());
      expect(again.json().handled).toBe(0);
      await new Promise((res) => setTimeout(res, 150));
      expect(statusPosts()).toHaveLength(1);
    });
  });
});
