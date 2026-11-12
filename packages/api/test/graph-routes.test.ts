// /graph, /graph/children y /graph/snippet de un workspace: el workspace y sus
// repos se crean por la API; el motor (mock) entra por el seam de transporte.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { buildApp } from '../src/server.js';
import { fakeCodeEngine } from './fake-code-engine.js';

describe('workspace code-graph routes', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const headers = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-graph-routes-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });
    const mock = createLainMock();
    app.lainClientFor = async () => mock;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function workspace(
    lainUrl: string | undefined,
    repos: string[] = ['https://github.com/acme/orders.git'],
  ) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers,
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    const id = (r.json() as { workspace: { id: string } }).workspace.id;
    for (const uri of repos)
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${id}/repos`,
        headers,
        payload: { uri },
      });
    return id;
  }
  const get = (url: string) => app.inject({ method: 'GET', url, headers });

  describe('GET /graph', () => {
    it('says none for an unknown workspace and unconfigured without LAIN', async () => {
      expect((await get('/api/workspaces/nope/graph')).json()).toEqual({
        graph: null,
        source: 'none',
      });
      const id = await workspace(undefined);
      const r = (await get(`/api/workspaces/${id}/graph`)).json();
      expect(r).toMatchObject({
        graph: { repos: [] },
        source: 'unconfigured',
        workspace: { id, name: 'ws', repoCount: 1 },
      });
    });

    it('returns the roots of every workspace repo, or only the requested one', async () => {
      app.lainClientFor = async () => fakeCodeEngine({ src: ['index.ts'], docs: ['a.md'] });
      const id = await workspace('http://lain.test', [
        'https://github.com/acme/orders.git',
        'https://github.com/acme/billing.git',
      ]);
      const all = (await get(`/api/workspaces/${id}/graph`)).json() as {
        graph: { repos: Array<{ repo: string }> };
        source: string;
        lainUrl: string;
      };
      expect(all.source).toBe('lain');
      expect(all.lainUrl).toBe('http://lain.test');
      expect(all.graph.repos.map((r) => r.repo).sort()).toEqual(['billing', 'orders']);
      const one = (await get(`/api/workspaces/${id}/graph?repo=orders`)).json() as {
        graph: { repos: Array<{ repo: string; nodes: unknown[] }> };
      };
      expect(one.graph.repos.map((r) => r.repo)).toEqual(['orders']);
      expect(one.graph.repos[0]?.nodes.length).toBeGreaterThan(0);
    });

    it('refuses a repo that is not part of the workspace', async () => {
      const id = await workspace('http://lain.test');
      const r = await get(`/api/workspaces/${id}/graph?repo=other`);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({
        code: 'BadRequest',
        detail: "repo 'other' is not part of this workspace",
      });
    });

    it('reports an engine failure as an error, not as an empty graph', async () => {
      app.lainClientFor = async () => {
        throw new Error('connection refused');
      };
      const id = await workspace('http://lain.test');
      const r = (await get(`/api/workspaces/${id}/graph`)).json();
      expect(r).toMatchObject({ graph: { repos: [] }, source: 'error', error: 'lain unreachable' });
    });
  });

  describe('GET /graph/children', () => {
    const q = (repo: string, type = 'File', name = 'main.rs') =>
      `repo=${repo}&type=${type}&name=${encodeURIComponent(name)}`;

    it('404s an unknown workspace and 400s a repo outside it', async () => {
      const missing = await get(`/api/workspaces/nope/graph/children?${q('orders')}`);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ code: 'NotFound', detail: 'workspace not found' });
      const id = await workspace('http://lain.test');
      const bad = await get(`/api/workspaces/${id}/graph/children?${q('other')}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({
        code: 'BadRequest',
        detail: "repo 'other' is not part of this workspace",
      });
    });

    it('requires repo, type and name', async () => {
      const id = await workspace('http://lain.test');
      expect(
        (await get(`/api/workspaces/${id}/graph/children?repo=orders&type=File`)).statusCode,
      ).toBe(400);
      expect((await get(`/api/workspaces/${id}/graph/children?type=File&name=x`)).statusCode).toBe(
        400,
      );
    });

    it('is unconfigured without LAIN, and returns children and communications with it', async () => {
      const bare = await workspace(undefined);
      expect((await get(`/api/workspaces/${bare}/graph/children?${q('orders')}`)).json()).toEqual({
        children: null,
        source: 'unconfigured',
      });
      const id = await workspace('http://lain.test');
      const r = (await get(`/api/workspaces/${id}/graph/children?${q('orders')}`)).json() as {
        source: string;
        children: Array<{ name: string }>;
        communications: unknown[];
        node: { repo: string; type: string; name: string };
      };
      expect(r.source).toBe('lain');
      expect(r.node).toEqual({ repo: 'orders', type: 'File', name: 'main.rs' });
      expect(r.children.map((c) => c.name)).toContain('main');
      expect(Array.isArray(r.communications)).toBe(true);
    });

    it('reports an engine failure', async () => {
      app.lainClientFor = async () => {
        throw new Error('boom');
      };
      const id = await workspace('http://lain.test');
      expect((await get(`/api/workspaces/${id}/graph/children?${q('orders')}`)).json()).toEqual({
        children: null,
        source: 'error',
        error: 'lain unreachable',
      });
    });
  });

  describe('GET /graph/snippet', () => {
    it('404s an unknown workspace, 400s a foreign repo, and needs exactly one of symbol/path', async () => {
      expect(
        (await get('/api/workspaces/nope/graph/snippet?repo=orders&symbol=x')).statusCode,
      ).toBe(404);
      const id = await workspace('http://lain.test');
      expect(
        (await get(`/api/workspaces/${id}/graph/snippet?repo=other&symbol=x`)).statusCode,
      ).toBe(400);
      for (const qs of ['repo=orders', 'repo=orders&symbol=x&path=y']) {
        const r = await get(`/api/workspaces/${id}/graph/snippet?${qs}`);
        expect(r.statusCode, qs).toBe(400);
        expect(r.json()).toEqual({
          code: 'BadRequest',
          detail: 'give exactly one of `symbol` or `path`',
        });
      }
    });

    it('is unconfigured without LAIN', async () => {
      const id = await workspace(undefined);
      expect(
        (await get(`/api/workspaces/${id}/graph/snippet?repo=orders&symbol=x`)).json(),
      ).toEqual({ snippet: null, source: 'unconfigured' });
    });

    it('resolves a symbol through explain_symbol and a path through get_code_snippet', async () => {
      const id = await workspace('http://lain.test');
      const sym = (
        await get(`/api/workspaces/${id}/graph/snippet?repo=orders&symbol=create_order`)
      ).json() as { snippet: { symbol: string; path: string; text: string }; source: string };
      expect(sym.source).toBe('lain');
      expect(sym.snippet).toMatchObject({ symbol: 'create_order', path: 'mock/create_order.rs' });
      const byPath = (
        await get(
          `/api/workspaces/${id}/graph/snippet?repo=orders&path=${encodeURIComponent('src/api.py')}`,
        )
      ).json() as { snippet: { symbol: string; path: string; text: string } };
      expect(byPath.snippet).toMatchObject({ symbol: 'src/api.py', path: 'src/api.py' });
      expect(byPath.snippet.text).toMatch(/mock line 1/);
    });

    it('reports an engine failure', async () => {
      app.lainClientFor = async () => {
        throw new Error('boom');
      };
      const id = await workspace('http://lain.test');
      expect((await get(`/api/workspaces/${id}/graph/snippet?repo=orders&path=a`)).json()).toEqual({
        snippet: null,
        source: 'error',
        error: 'lain unreachable',
      });
    });
  });
});
