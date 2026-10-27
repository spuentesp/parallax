// Rutas del mapa con un grafo real: el workspace se crea por la API y el
// servicio de grafos recibe el motor (mock) por el borde de transporte.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { createOrgGraphService } from '../src/org-graph-service.js';
import { buildApp } from '../src/server.js';

describe('map routes — con grafo', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;
  const headers = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-map-graph-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 't', orgId: 'o', scopes: ['read', 'write'] },
        { token: 'ro', orgId: 'o', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
    const mock = createLainMock();
    app.orgGraphs = createOrgGraphService({ db: app.db, getClient: async () => mock });
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers,
      payload: { name: 'ws', lainUrl: 'http://lain.test/mcp' },
    });
    wsId = (r.json() as { workspace: { id: string } }).workspace.id;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const view = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/map/view`,
      headers,
      payload: payload as object,
    });
  type View = {
    nodes: Array<{ id: string; kind: string; expanded: boolean; childCount: number }>;
    edges: Array<{ source: string; target: string; provenance: string }>;
    focus: { seed: string; ids: string[] } | null;
    unknownExpand: string[];
    hiddenChildren: Record<string, number>;
    totals: { nodes: number; edges: number; shownNodes: number; shownEdges: number };
    meta: Record<string, unknown>;
  };

  it('serves the top level of the real graph with its metadata and totals', async () => {
    const r = await view({});
    expect(r.statusCode).toBe(200);
    const v = r.json() as View;
    expect(v.nodes.length).toBeGreaterThan(0);
    expect(v.nodes.every((n) => n.kind === 'repo')).toBe(true);
    expect(v.meta).toMatchObject({ source: 'lain', lainUrl: 'http://lain.test/mcp', stale: false });
    expect(v.totals.shownNodes).toBe(v.nodes.length);
    expect(v.totals.nodes).toBeGreaterThan(v.totals.shownNodes);
    expect(v.focus).toBeNull();
  });

  it('opens what it is told to, reports unknown ids, and applies filters', async () => {
    const top = (await view({})).json() as View;
    const repo = top.nodes[0]?.id as string;
    const opened = (await view({ expand: [repo, 'ghost'] })).json() as View;
    expect(opened.nodes.find((n) => n.id === repo)?.expanded).toBe(true);
    expect(opened.nodes.length).toBeGreaterThan(top.nodes.length);
    expect(opened.unknownExpand).toEqual(['ghost']);

    const none = (await view({ filters: { contract: 'nonexistent' } })).json() as View;
    expect(none.nodes).toEqual([]);
    const det = (await view({ filters: { provenance: 'deterministic' } })).json() as View;
    expect(det.edges.every((e) => e.provenance === 'deterministic')).toBe(true);
  });

  it('focuses a node and pins another so it is reachable', async () => {
    const all = (await view({ expand: [] })).json() as View;
    const repo = all.nodes[0]?.id as string;
    const opened = (await view({ expand: [repo] })).json() as View;
    const child = opened.nodes.find((n) => n.id !== repo && n.kind === 'service')?.id as string;
    const f = (await view({ focus: child, hops: 1 })).json() as View;
    expect(f.focus?.seed).toBe(child);
    expect(f.nodes.some((n) => n.id === child)).toBe(true);
    const pinned = (await view({ pin: [child] })).json() as View;
    expect(pinned.nodes.some((n) => n.id === child)).toBe(true);
    const limited = (await view({ expand: [repo], limits: { [repo]: 1 } })).json() as View;
    expect(limited.nodes.filter((n) => n.kind === 'service').length).toBeLessThanOrEqual(1);
  });

  it('rejects malformed requests with a 400 instead of guessing', async () => {
    const bad: unknown[] = [
      { hops: 5 },
      { hops: -1 },
      { hops: 1.5 },
      { focus: '' },
      { filters: { minConfidence: 2 } },
      { filters: { minConfidence: -0.1 } },
      { filters: { provenance: 'maybe' } },
      { filters: { contract: '' } },
      { filters: { service: '' } },
      { limits: { a: 0 } },
      { limits: { a: 5001 } },
      { expand: Array.from({ length: 2001 }, (_, i) => `n${i}`) },
      { pin: Array.from({ length: 201 }, (_, i) => `n${i}`) },
    ];
    for (const payload of bad) {
      expect((await view(payload)).statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
    }
    for (const ok of [
      { hops: 0 },
      { hops: 4 },
      { filters: { minConfidence: 0 } },
      { filters: { minConfidence: 1 } },
      { limits: { a: 1 } },
      { limits: { a: 5000 } },
    ]) {
      expect((await view(ok)).statusCode, JSON.stringify(ok)).toBe(200);
    }
  });

  it('describes a node with its consumers, 404s an unknown one', async () => {
    const top = (await view({})).json() as View;
    const repo = top.nodes[0]?.id as string;
    const ok = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/map/node?id=${encodeURIComponent(repo)}`,
      headers,
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      detail: { node: { id: string }; consumers: unknown[] };
      meta: { source: string };
    };
    expect(body.detail.node.id).toBe(repo);
    expect(body.meta.source).toBe('lain');
    const missing = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/map/node?id=ghost`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'NodeNotFound' });
    expect(
      (await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/map/node`, headers }))
        .statusCode,
    ).toBe(400);
  });

  it('searches by label and refuses an empty query', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/map/search?q=orders`,
      headers,
    });
    const body = r.json() as { results: Array<{ label: string }>; meta: { source: string } };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((n) => n.label.toLowerCase().includes('orders'))).toBe(true);
    expect(body.meta.source).toBe('lain');
    expect(
      (await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/map/search?q=`, headers }))
        .statusCode,
    ).toBe(400);
    const none = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/map/search?q=zzzqqq`,
      headers,
    });
    expect((none.json() as { results: unknown[] }).results).toEqual([]);
  });

  it('refresh needs the write scope and reports the rebuilt graph size', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/map/refresh`,
      headers: { authorization: 'Bearer ro' },
    });
    expect(denied.statusCode).toBe(403);
    const r = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/map/refresh`,
      headers,
    });
    const body = r.json() as { meta: { source: string }; totals: { nodes: number; edges: number } };
    expect(body.meta.source).toBe('lain');
    expect(body.totals.nodes).toBeGreaterThan(0);
    expect(body.totals.edges).toBeGreaterThanOrEqual(0);
  });

  it('node, search and refresh say why there is no graph instead of an empty answer', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers,
      payload: { name: 'bare' },
    });
    const id = (r.json() as { workspace: { id: string } }).workspace.id;
    const node = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}/map/node?id=x`,
      headers,
    });
    expect(node.json()).toEqual({ detail: null, meta: { source: 'unconfigured', error: null } });
    const search = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}/map/search?q=ab`,
      headers,
    });
    expect(search.json()).toEqual({ results: [], meta: { source: 'unconfigured', error: null } });
    const refresh = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/map/refresh`,
      headers,
    });
    expect(refresh.json()).toEqual({ meta: { source: 'unconfigured', error: null } });
    const empty = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/map/view`,
      headers,
      payload: {},
    });
    expect(empty.json()).toEqual({
      nodes: [],
      edges: [],
      hiddenChildren: {},
      focus: null,
      unknownExpand: [],
      meta: { source: 'unconfigured', error: null },
    });
  });
});
