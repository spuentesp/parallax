// El servicio que construye y cachea el grafo del mapa por workspace. El
// workspace y sus repos se crean por la API real (camino de escritura real);
// el transporte hacia LAIN se inyecta (mock del motor en el borde).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LainClientConfig } from '../src/lain-adapter/client.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { createOrgGraphService } from '../src/org-graph-service.js';
import { buildApp } from '../src/server.js';

describe('createOrgGraphService', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const headers = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-graph-svc-'));
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

  async function workspace(lainUrl: string | undefined, repoUris: string[]): Promise<string> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers,
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    const id = (r.json() as { workspace: { id: string } }).workspace.id;
    for (const uri of repoUris) {
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${id}/repos`,
        headers,
        payload: { uri },
      });
    }
    return id;
  }

  // Un motor que cuenta cuántas veces se le pregunta, y a qué configuración.
  function engine() {
    const configs: LainClientConfig[] = [];
    let listServicesCalls = 0;
    const base = createLainMock();
    const adapter: LainAdapter = {
      ...base,
      listServices: async (req) => {
        listServicesCalls++;
        return base.listServices(req);
      },
    };
    return {
      configs,
      calls: () => listServicesCalls,
      getClient: async (c: LainClientConfig) => {
        configs.push(c);
        return adapter;
      },
    };
  }

  it('says "none" for an unknown workspace and "unconfigured" when it has no LAIN', async () => {
    const svc = createOrgGraphService({ db: app.db, getClient: engine().getClient });
    expect(await svc.load('ws_nope', false)).toEqual({ ok: false, source: 'none' });
    const id = await workspace(undefined, []);
    expect(await svc.load(id, false)).toEqual({ ok: false, source: 'unconfigured' });
  });

  it('builds the graph from LAIN with the workspace URL and reports where it came from', async () => {
    const e = engine();
    const now = 1_700_000_000_000;
    const svc = createOrgGraphService({ db: app.db, getClient: e.getClient, now: () => now });
    const id = await workspace('http://lain.test/mcp', []);
    const r = await svc.load(id, false);
    if (!r.ok) throw new Error('expected a graph');
    expect(e.configs).toEqual([
      { lainUrl: 'http://lain.test/mcp', apiVersion: '1', timeoutMs: 20_000 },
    ]);
    expect(r.graph.nodes.some((n) => n.kind === 'service')).toBe(true);
    expect(r.meta).toMatchObject({
      source: 'lain',
      lainUrl: 'http://lain.test/mcp',
      generatedAt: now,
      stale: false,
      refreshing: false,
    });
    expect(r.meta).not.toHaveProperty('lastError');
  });

  it('links a repo node to its LAIN repo_id only when a workspace repo derives exactly that id', async () => {
    const svc = createOrgGraphService({ db: app.db, getClient: engine().getClient });
    const id = await workspace('http://lain.test/mcp', ['https://github.com/acme/orders.git']);
    const r = await svc.load(id, false);
    if (!r.ok) throw new Error('expected a graph');
    const lain = (label: string) =>
      r.graph.nodes.find((n) => n.kind === 'repo' && n.label === label)?.meta.lainRepoId;
    expect(lain('orders')).toBe('orders');
    // billing existe en el análisis pero no es un repo del workspace: no se adivina.
    expect(lain('billing')).toBeNull();
  });

  it('serves the cache until the TTL, then revalidates; refresh always rebuilds', async () => {
    const e = engine();
    let t = 0;
    const svc = createOrgGraphService({
      db: app.db,
      getClient: e.getClient,
      ttlMs: 1000,
      now: () => t,
    });
    const id = await workspace('http://lain.test/mcp', []);

    await svc.load(id, false);
    t = 1000; // justo en el límite: aún fresco
    const fresh = await svc.load(id, false);
    expect(e.calls()).toBe(1);
    expect(fresh.ok && fresh.meta.stale).toBe(false);

    t = 1001;
    const stale = await svc.load(id, false);
    expect(stale.ok && stale.meta.stale).toBe(true);

    const rebuilt = await svc.load(id, true);
    expect(e.calls()).toBeGreaterThanOrEqual(2);
    expect(rebuilt.ok && rebuilt.meta.stale).toBe(false);
    expect(rebuilt.ok && rebuilt.meta.generatedAt).toBe(1001);
  });

  it('keeps one cache entry per workspace + LAIN URL', async () => {
    const e = engine();
    const svc = createOrgGraphService({ db: app.db, getClient: e.getClient });
    const a = await workspace('http://lain.test/a', []);
    const b = await workspace('http://lain.test/b', []);
    await svc.load(a, false);
    await svc.load(b, false);
    await svc.load(a, false);
    expect(e.calls()).toBe(2);
  });

  it('surfaces a failed first build as an error, never as an empty graph', async () => {
    const svc = createOrgGraphService({
      db: app.db,
      getClient: async () => {
        throw new Error('connection refused');
      },
    });
    const id = await workspace('http://lain.test/mcp', []);
    expect(await svc.load(id, false)).toEqual({
      ok: false,
      source: 'error',
      error: 'connection refused',
    });
  });

  it('keeps serving the last graph when a refresh fails, and says so', async () => {
    let healthy = true;
    const base = createLainMock();
    const svc = createOrgGraphService({
      db: app.db,
      getClient: async () => {
        if (!healthy) throw new Error('lain went away');
        return base;
      },
    });
    const id = await workspace('http://lain.test/mcp', []);
    const first = await svc.load(id, false);
    healthy = false;
    const after = await svc.load(id, true);
    expect(after.ok).toBe(true);
    expect(after.ok && after.graph.nodes.length).toBe(first.ok ? first.graph.nodes.length : -1);
    expect(after.ok && after.meta.lastError).toBe('lain went away');
  });

  it('labels a non-Error failure instead of swallowing it', async () => {
    const svc = createOrgGraphService({
      db: app.db,
      getClient: async () => {
        throw 'boom';
      },
    });
    const id = await workspace('http://lain.test/mcp', []);
    const r = await svc.load(id, false);
    expect(r).toMatchObject({ ok: false, source: 'error', error: 'lain unreachable' });
  });
});
