import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { GitHubReader, PrUrlError, parseGithubRepoUri } from '../src/github/reader.js';
import { buildApp } from '../src/server.js';

function pr(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    html_url: `https://github.com/acme/shop/pull/${number}`,
    title: `change ${number}`,
    state: 'open',
    draft: false,
    updated_at: `2026-10-${String(10 + number).padStart(2, '0')}T12:00:00Z`,
    user: { login: 'dev' },
    base: { ref: 'main', sha: `base${number}` },
    head: { ref: `feat-${number}`, sha: `head${number}` },
    ...overrides,
  };
}

describe('parseGithubRepoUri', () => {
  it.each([
    ['https://github.com/acme/shop', { owner: 'acme', repo: 'shop' }],
    ['https://github.com/acme/shop.git', { owner: 'acme', repo: 'shop' }],
    ['github.com/acme/shop', { owner: 'acme', repo: 'shop' }],
    ['https://github.com/acme/shop/', { owner: 'acme', repo: 'shop' }],
  ])('reads %s', (uri, expected) => {
    expect(parseGithubRepoUri(uri)).toEqual(expected);
  });

  it.each(['./test-repos/saleor', '/data/checkouts/shop', 'https://gitlab.com/acme/shop', ''])(
    'returns null for %j, which has no PRs to list',
    (uri) => {
      expect(parseGithubRepoUri(uri)).toBeNull();
    },
  );
});

describe('GitHubReader.listOpenPrs (sólo lectura)', () => {
  it('asks for open PRs with GET only and sends the read token', async () => {
    const seen: Array<{ url: string; method: string; auth: string | null }> = [];
    const reader = new GitHubReader({
      token: 'read-token',
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        seen.push({
          url: String(input),
          method: init?.method ?? 'GET',
          auth: new Headers(init?.headers).get('authorization'),
        });
        return Response.json([pr(1)]);
      }) as typeof fetch,
    });

    await reader.listOpenPrs('acme', 'shop');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain('/repos/acme/shop/pulls?state=open');
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.auth).toBe('Bearer read-token');
  });

  it('maps each PR to its base and head SHAs, which are the identity', async () => {
    const reader = new GitHubReader({
      fetchImpl: (async () => Response.json([pr(7)])) as typeof fetch,
    });
    const { items, truncated } = await reader.listOpenPrs('acme', 'shop');
    expect(truncated).toBe(false);
    expect(items).toEqual([
      {
        number: 7,
        url: 'https://github.com/acme/shop/pull/7',
        title: 'change 7',
        author: 'dev',
        draft: false,
        baseRef: 'main',
        headRef: 'feat-7',
        baseSha: 'base7',
        headSha: 'head7',
        updatedAt: '2026-10-17T12:00:00Z',
      },
    ]);
  });

  it('skips a PR without SHAs instead of inventing an identity for it', async () => {
    const reader = new GitHubReader({
      fetchImpl: (async () =>
        Response.json([pr(1), pr(2, { base: { ref: 'main', sha: '' } })])) as typeof fetch,
    });
    const { items } = await reader.listOpenPrs('acme', 'shop');
    expect(items.map((i) => i.number)).toEqual([1]);
  });

  it('declares a listing that hit the page size as truncated', async () => {
    const page = Array.from({ length: 100 }, (_, i) => pr(i + 1));
    const reader = new GitHubReader({
      fetchImpl: (async () => Response.json(page)) as typeof fetch,
    });
    const { items, truncated } = await reader.listOpenPrs('acme', 'shop');
    expect(items).toHaveLength(100);
    expect(truncated).toBe(true);
  });

  it('surfaces a rate limit as rate_limited, not as an empty list', async () => {
    const reader = new GitHubReader({
      fetchImpl: (async () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        })) as typeof fetch,
    });
    const err = await reader.listOpenPrs('acme', 'shop').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrUrlError);
    expect((err as PrUrlError).code).toBe('rate_limited');
  });
});

describe('GET /api/workspaces/:id/prs', () => {
  let dir: string;
  let gh: Server;
  let apiBase: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;
  const auth = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-prs-'));
    gh = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/repos/acme/shop/pulls')) {
        res.end(JSON.stringify([pr(3), pr(9)]));
      } else if (req.url?.startsWith('/repos/acme/private/pulls')) {
        res.statusCode = 404;
        res.end('{}');
      } else {
        res.statusCode = 500;
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    apiBase = `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`;

    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
      githubApiBase: apiBase,
      githubReadToken: 'read-token',
    });

    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'shop' },
    });
    wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values([
      {
        id: 'shop',
        workspaceId: wsId,
        uri: 'https://github.com/acme/shop.git',
        createdAt: Date.now(),
      },
      {
        id: 'private',
        workspaceId: wsId,
        uri: 'https://github.com/acme/private',
        createdAt: Date.now(),
      },
      {
        id: 'local',
        workspaceId: wsId,
        uri: './checkouts/local',
        createdAt: Date.now(),
      },
    ]);
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists open PRs across GitHub repos, newest first, tagged with their repo', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/prs`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.prs.map((p: { number: number }) => p.number)).toEqual([9, 3]);
    expect(body.prs[0]).toMatchObject({
      repo: 'https://github.com/acme/shop.git',
      baseSha: 'base9',
      headSha: 'head9',
    });
  });

  it('reports a repo that is not on GitHub as skipped, not as an empty listing', async () => {
    const body = (
      await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/prs`, headers: auth })
    ).json();
    expect(body.skipped).toEqual([{ repo: './checkouts/local', reason: 'not_github' }]);
  });

  it('reports a failing GitHub repo as an error next to the others', async () => {
    const body = (
      await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/prs`, headers: auth })
    ).json();
    expect(body.errors).toEqual([
      expect.objectContaining({ repo: 'https://github.com/acme/private', code: 'not_found' }),
    ]);
    expect(body.prs).toHaveLength(2);
  });

  it('answers 404 for an unknown workspace', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/workspaces/ws_missing/prs',
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });
});
