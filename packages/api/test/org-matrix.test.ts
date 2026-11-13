// buildMatrix: el grafo del mapa agregado a celdas consumidor × proveedor.
// La celda guarda call-sites, procedencia dominante, confianza mínima de lo
// inferido y los contratos que la sustentan (para el panel del par).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrgEdge, OrgNode } from '@parallax/shared/org-map';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { OrgGraph } from '../src/org-graph.js';
import { createOrgGraphService } from '../src/org-graph-service.js';
import { buildMatrix } from '../src/org-matrix.js';
import { buildApp } from '../src/server.js';

const node = (id: string, kind: OrgNode['kind'], parent: string | null, label = id): OrgNode => ({
  id,
  label,
  kind,
  parent,
  meta: {},
});
const edge = (source: string, target: string, over: Partial<OrgEdge> = {}): OrgEdge => ({
  id: `consumes:${source}->${target}`,
  source,
  target,
  kind: 'consumes',
  provenance: 'deterministic',
  confidence: 1,
  count: 1,
  deterministicCount: 1,
  inferredCount: 0,
  ...over,
});

// repo r1: svc a (endpoints e1, e2); repo r2: svc b (endpoint e3).
// a consume e3 (cross-repo, 2 estáticos + 1 heurístico) y b consume e1 (inferido).
const graph: OrgGraph = {
  nodes: [
    node('repo:r1', 'repo', null, 'r1'),
    node('repo:r2', 'repo', null, 'r2'),
    node('svc:a', 'service', 'repo:r1', 'a'),
    node('svc:b', 'service', 'repo:r2', 'b'),
    node('ep:e1@a', 'endpoint', 'svc:a', 'http:GET /a'),
    node('ep:e2@a', 'endpoint', 'svc:a', 'http:POST /a'),
    node('ep:e3@b', 'endpoint', 'svc:b', 'http:GET /b'),
  ],
  edges: [
    edge('svc:a', 'ep:e3@b', { count: 2, deterministicCount: 2 }),
    edge('svc:a', 'ep:e3@b', {
      id: 'consumes:svc:a->ep:e3@b#inf',
      provenance: 'inferred',
      confidence: 0.6,
      count: 1,
      deterministicCount: 0,
      inferredCount: 1,
    }),
    edge('svc:b', 'ep:e1@a', {
      provenance: 'inferred',
      confidence: 0.4,
      count: 1,
      deterministicCount: 0,
      inferredCount: 1,
    }),
  ],
};

describe('buildMatrix', () => {
  const m = buildMatrix(graph);

  it('lists services with their repo, and standalone services separately', () => {
    expect(m.services.map((s) => s.label).sort()).toEqual(['a', 'b']);
    expect(m.services.find((s) => s.label === 'a')?.repoLabel).toBe('r1');
    expect(m.standalone).toEqual([]);
  });

  it('aggregates cells consumer → provider with counts and mixed provenance', () => {
    const ab = m.cells.find((c) => c.consumer === 'svc:a' && c.provider === 'svc:b');
    expect(ab).toBeDefined();
    expect(ab?.count).toBe(3);
    expect(ab?.deterministicCount).toBe(2);
    expect(ab?.inferredCount).toBe(1);
    // Hay al menos un uso estático: la celda es determinista (como en el inspector).
    expect(ab?.provenance).toBe('deterministic');
  });

  it('marks a fully inferred cell as inferred with its confidence', () => {
    const ba = m.cells.find((c) => c.consumer === 'svc:b' && c.provider === 'svc:a');
    expect(ba?.provenance).toBe('inferred');
    expect(ba?.confidence).toBeCloseTo(0.4);
  });

  it('keeps the endpoints behind each cell, most used first', () => {
    const ab = m.cells.find((c) => c.consumer === 'svc:a' && c.provider === 'svc:b');
    expect(ab?.links.map((l) => l.endpointLabel)).toEqual(['http:GET /b']);
    expect(ab?.links[0]?.count).toBe(3);
  });

  it('handles a graph with no relations: services listed, no cells, all standalone', () => {
    const empty = buildMatrix({ nodes: graph.nodes, edges: [] });
    expect(empty.cells).toEqual([]);
    expect(empty.standalone.sort()).toEqual(['svc:a', 'svc:b']);
  });
});

describe('GET /map/matrix — ruta', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;
  const headers = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-matrix-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
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

  it('returns the aggregated matrix for the workspace graph and needs auth', async () => {
    const unauth = await app.inject({ method: 'GET', url: `/api/workspaces/${wsId}/map/matrix` });
    expect(unauth.statusCode).toBe(401);

    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/map/matrix`,
      headers,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      matrix: {
        services: Array<{ id: string; label: string; repoId: string | null }>;
        cells: Array<{ consumer: string; provider: string; count: number; provenance: string }>;
      } | null;
      meta: { source: string };
    };
    expect(body.meta.source).toBe('lain');
    expect(body.matrix).not.toBeNull();
    const m = body.matrix as NonNullable<typeof body.matrix>;
    expect(m.services.length).toBeGreaterThan(0);
    const serviceIds = new Set(m.services.map((s) => s.id));
    for (const c of m.cells) {
      expect(serviceIds.has(c.consumer)).toBe(true);
      expect(serviceIds.has(c.provider)).toBe(true);
      expect(c.count).toBeGreaterThanOrEqual(1);
      expect(['deterministic', 'inferred']).toContain(c.provenance);
    }
  });

  it('reports "none" for an unknown workspace instead of an empty matrix', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/workspaces/ws_nope/map/matrix',
      headers,
    });
    expect(r.json()).toMatchObject({ matrix: null, meta: { source: 'none' } });
  });
});
