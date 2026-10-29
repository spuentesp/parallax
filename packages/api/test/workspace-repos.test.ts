// Configuración básica de un workspace: repos (alta, baja, duplicados), edición,
// borrado y el estado de cada repo frente a LAIN. Sin modelo.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { buildApp } from '../src/server.js';

describe('workspace and repo configuration', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const headers = { authorization: 'Bearer rw' };
  const ro = { authorization: 'Bearer ro' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ws-repos-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 'rw', orgId: 'o', scopes: ['read', 'write'] },
        { token: 'ro', orgId: 'o', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
    // El mock devuelve un alcance vacío; aquí LAIN "revisó" orders y legacy y
    // conoce billing sin haberlo revisado.
    const mock = createLainMock();
    const engine = {
      ...mock,
      listServices: async (req: Parameters<typeof mock.listServices>[0]) => ({
        ...(await mock.listServices(req)),
        scope: {
          configured_only: true,
          reviewed: [
            { repo: 'orders', commit: 'abc123', dirty: false },
            { repo: 'legacy', commit: 'def456', dirty: true },
          ],
          unreviewed: ['billing'],
        },
      }),
    } as typeof mock;
    app.lainClientFor = async () => engine;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const create = async (payload: object = { name: 'ws' }) =>
    (
      (await app.inject({ method: 'POST', url: '/api/workspaces', headers, payload })).json() as {
        workspace: { id: string };
      }
    ).workspace.id;
  const addRepo = (id: string, payload: object, h = headers) =>
    app.inject({ method: 'POST', url: `/api/workspaces/${id}/repos`, headers: h, payload });
  const detail = async (id: string) =>
    (
      (await app.inject({ method: 'GET', url: `/api/workspaces/${id}`, headers })).json() as {
        workspace: {
          repos: Array<{ id: string; uri: string }>;
          name: string;
          lainUrl: string | null;
          description: string | null;
        } | null;
      }
    ).workspace;

  it('adds a repo, rejects a duplicate URI with 409, and 404s an unknown workspace', async () => {
    const id = await create();
    const ok = await addRepo(id, { uri: 'https://github.com/acme/orders.git', local: './orders' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().repo).toMatchObject({
      workspaceId: id,
      uri: 'https://github.com/acme/orders.git',
      local: './orders',
      sha: null,
    });
    const dup = await addRepo(id, { uri: 'https://github.com/acme/orders.git' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().detail).toMatch(/already in this workspace/);
    expect((await detail(id))?.repos).toHaveLength(1);
    expect((await addRepo('ws_nope', { uri: 'https://x/y.git' })).statusCode).toBe(404);
    // El mismo URI en OTRO workspace sí se permite.
    const other = await create({ name: 'other' });
    expect((await addRepo(other, { uri: 'https://github.com/acme/orders.git' })).statusCode).toBe(
      200,
    );
  });

  it('removes a repo only from the workspace that owns it', async () => {
    const a = await create({ name: 'a' });
    const b = await create({ name: 'b' });
    const repoA = (await addRepo(a, { uri: 'https://x/one.git' })).json().repo.id as string;
    // Desde otro workspace no se puede borrar (antes se borraba por id a secas).
    const wrong = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${b}/repos/${repoA}`,
      headers,
    });
    expect(wrong.statusCode).toBe(404);
    expect((await detail(a))?.repos).toHaveLength(1);
    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${a}/repos/${repoA}`,
      headers,
    });
    expect(ok.json()).toEqual({ deleted: true });
    expect((await detail(a))?.repos).toHaveLength(0);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/workspaces/${a}/repos/${repoA}`, headers }))
        .statusCode,
    ).toBe(404);
  });

  it('edits name, description and LAIN URL; null clears them; unknown workspace is a 404', async () => {
    const id = await create({ name: 'old', description: 'd', lainUrl: 'http://lain.test/mcp' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}`,
      headers,
      payload: { name: 'new', lainUrl: null, description: null },
    });
    expect(r.statusCode).toBe(200);
    const w = await detail(id);
    expect(w).toMatchObject({ name: 'new', lainUrl: null, description: null });
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}`,
      headers,
      payload: { lainUrl: 'not a url' },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/workspaces/nope',
          headers,
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    // Un PATCH vacío no cambia nada.
    await app.inject({ method: 'PATCH', url: `/api/workspaces/${id}`, headers, payload: {} });
    expect((await detail(id))?.name).toBe('new');
  });

  it('deletes a workspace with its repos', async () => {
    const id = await create();
    await addRepo(id, { uri: 'https://x/one.git' });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/workspaces/${id}`, headers })).json(),
    ).toEqual({ deleted: true });
    expect(await detail(id)).toBeNull();
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/workspaces/${id}`, headers })).statusCode,
    ).toBe(404);
  });

  it('every change needs the write scope', async () => {
    const id = await create();
    const rid = (await addRepo(id, { uri: 'https://x/one.git' })).json().repo.id as string;
    const calls = [
      {
        method: 'POST' as const,
        url: `/api/workspaces/${id}/repos`,
        payload: { uri: 'https://x/two.git' },
      },
      { method: 'DELETE' as const, url: `/api/workspaces/${id}/repos/${rid}` },
      { method: 'PATCH' as const, url: `/api/workspaces/${id}`, payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `/api/workspaces/${id}` },
    ];
    for (const c of calls)
      expect((await app.inject({ ...c, headers: ro })).statusCode, `${c.method} ${c.url}`).toBe(
        403,
      );
    expect((await detail(id))?.repos).toHaveLength(1);
  });

  describe('repo status against LAIN', () => {
    const status = (id: string) =>
      app.inject({ method: 'GET', url: `/api/workspaces/${id}/repos/status`, headers });

    it('says none for an unknown workspace and unconfigured (nothing indexed) without LAIN', async () => {
      expect((await status('nope')).json()).toEqual({ source: 'none', repos: [], untracked: [] });
      const id = await create();
      await addRepo(id, { uri: 'https://github.com/acme/orders.git' });
      const r = (await status(id)).json();
      expect(r.source).toBe('unconfigured');
      expect(r.repos[0]).toMatchObject({ lainRepoId: 'orders', state: 'not_in_lain' });
    });

    it('with LAIN, marks configured repos indexed or not, and lists untracked ones', async () => {
      const id = await create({ name: 'ws', lainUrl: 'http://lain.test/mcp' });
      await addRepo(id, { uri: 'https://github.com/acme/orders.git' });
      await addRepo(id, { uri: 'https://github.com/acme/never-heard-of-it.git' });
      const r = (await status(id)).json() as {
        source: string;
        repos: Array<{ lainRepoId: string; state: string }>;
        untracked: Array<{ repo: string }>;
      };
      expect(r.source).toBe('lain');
      const byId = Object.fromEntries(r.repos.map((x) => [x.lainRepoId, x.state]));
      expect(byId['never-heard-of-it']).toBe('not_in_lain');
      expect(byId.orders).toBe('indexed');
      expect(r.repos.find((x) => x.lainRepoId === 'orders')).toMatchObject({
        commit: 'abc123',
        dirty: false,
      });
      // LAIN revisó `legacy` y el workspace no lo tiene configurado.
      expect(r.untracked).toEqual([{ repo: 'legacy', commit: 'def456' }]);
    });

    it('reports an engine failure as an error, keeping the configured list', async () => {
      app.lainClientFor = async () => {
        throw new Error('down');
      };
      const id = await create({ name: 'ws', lainUrl: 'http://lain.test/mcp' });
      await addRepo(id, { uri: 'https://github.com/acme/orders.git' });
      const r = (await status(id)).json();
      expect(r).toMatchObject({ source: 'error', error: 'lain unreachable' });
      expect(r.repos).toHaveLength(1);
    });
  });

  it('adding or removing a repo drops the cached map so the next view sees it', async () => {
    const id = await create({ name: 'ws', lainUrl: 'http://lain.test/mcp' });
    const view = () =>
      app.inject({ method: 'POST', url: `/api/workspaces/${id}/map/view`, headers, payload: {} });
    const lainRepo = (v: {
      nodes: Array<{ kind: string; meta: { lainRepoId?: string | null } }>;
    }) => v.nodes.filter((n) => n.kind === 'repo').map((n) => n.meta.lainRepoId);
    const before = lainRepo((await view()).json());
    expect(before.every((x) => x === null)).toBe(true);
    await addRepo(id, { uri: 'https://github.com/acme/orders.git' });
    const after = lainRepo((await view()).json());
    expect(after).toContain('orders');
  });

  it('the generated LAIN config uses LAIN ids and the local path', async () => {
    const id = await create();
    await addRepo(id, { uri: 'https://github.com/acme/orders.git', local: '/srv/orders' });
    const r = (
      await app.inject({ method: 'GET', url: `/api/workspaces/${id}/lain-config`, headers })
    ).json() as { config: string };
    expect(r.config).toContain('  - id: orders');
    expect(r.config).toContain('path: /srv/orders');
  });
});
