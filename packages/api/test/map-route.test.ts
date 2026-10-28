import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('map routes — estados sin grafo', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-map-'));
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

  const headers = { authorization: 'Bearer t' };
  const createWorkspace = async (lainUrl?: string): Promise<string> => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers,
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    return (r.json() as { workspace: { id: string } }).workspace.id;
  };
  const view = (id: string) =>
    app.inject({ method: 'POST', url: `/api/workspaces/${id}/map/view`, headers, payload: {} });

  it('says "none" for an unknown workspace, never an empty-but-fine map', async () => {
    const r = await view('ws_nope');
    expect(r.json()).toMatchObject({ nodes: [], meta: { source: 'none' } });
  });

  it('says "unconfigured" when the workspace has no LAIN', async () => {
    const r = await view(await createWorkspace());
    expect(r.json()).toMatchObject({ nodes: [], meta: { source: 'unconfigured' } });
  });

  it('surfaces an unreachable LAIN as an error, not as zero relations', async () => {
    const r = await view(await createWorkspace('http://127.0.0.1:9'));
    const body = r.json() as { meta: { source: string; error: string | null } };
    expect(body.meta.source).toBe('error');
    expect(body.meta.error).toBeTruthy();
  });

  it('briefing: "none"/"unconfigured"/error states are named, and it needs auth', async () => {
    const get = (id: string, authed = true) =>
      app.inject({
        method: 'GET',
        url: `/api/workspaces/${id}/map/briefing`,
        ...(authed ? { headers } : {}),
      });
    expect((await get('ws_nope')).json()).toMatchObject({
      briefing: null,
      meta: { source: 'none' },
    });
    expect((await get(await createWorkspace())).json()).toMatchObject({
      briefing: null,
      meta: { source: 'unconfigured' },
    });
    expect((await get(await createWorkspace('http://127.0.0.1:9'))).json()).toMatchObject({
      briefing: null,
      meta: { source: 'error' },
    });
    expect((await get('x', false)).statusCode).toBe(401);
  });

  it('requires auth and the write scope to refresh', async () => {
    const id = await createWorkspace();
    expect(
      (await app.inject({ method: 'POST', url: `/api/workspaces/${id}/map/view`, payload: {} }))
        .statusCode,
    ).toBe(401);
    const r = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/map/refresh`,
      headers,
    });
    expect(r.json()).toMatchObject({ meta: { source: 'unconfigured' } });
  });
});
