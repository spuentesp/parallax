// Los clústeres de interfaces son una transformación pura de la proyección:
// aquí se fija CUÁNDO se parte un grupo (umbral, afinidad real) y CÓMO se
// reparten los contratos (prefijo común → clúster con nombre; el resto → Other).

import type { MapViewResponse, OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { describe, expect, it } from 'vitest';
import {
  CLUSTER_MIN,
  clusterNodeId,
  interfaceClusterOf,
  withInterfaceClusters,
} from './clusters.js';
import { layoutInput, toCyElements } from './elements.js';

const node = (over: Partial<ProjectedNode> & { id: string }): ProjectedNode => ({
  label: over.id,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});

const ep = (id: string, key: string, parent: string): ProjectedNode =>
  node({ id, kind: 'endpoint', label: key, parent, contract: key.split(':')[0] ?? 'http' });

const edge = (over: Partial<OrgEdge> = {}): OrgEdge => ({
  id: 'e',
  source: 'a',
  target: 'b',
  kind: 'consumes',
  provenance: 'deterministic',
  confidence: 1,
  count: 1,
  deterministicCount: 1,
  inferredCount: 0,
  ...over,
});

/** Grupo de contratos abierto con sus endpoints; el resto de la jerarquía, mínima. */
function viewWithGroup(groupId: string, keys: string[]): MapViewResponse {
  const group = node({
    id: groupId,
    kind: 'group',
    label: 'HTTP routes',
    parent: 'svc:nat',
    meta: { role: undefined, group: 'http', service: 'nat', contractKind: 'http' },
    childCount: keys.length,
    expanded: true,
  });
  return {
    nodes: [
      node({ id: 'repo:nat', kind: 'repo', label: 'nat', childCount: 2, expanded: true }),
      node({
        id: 'interfaces:nat',
        kind: 'group',
        label: 'Interfaces',
        parent: 'repo:nat',
        meta: { role: 'interfaces', repo: 'nat' },
        childCount: 1,
        expanded: true,
      }),
      node({
        id: 'svc:nat',
        kind: 'service',
        label: 'nat',
        parent: 'interfaces:nat',
        childCount: 1,
        expanded: true,
      }),
      group,
      ...keys.map((k, i) => ep(`ep:${k}@nat`, k, groupId)),
    ],
    edges: [],
    hiddenChildren: {},
    focus: null,
    unknownExpand: [],
    meta: { source: 'lain' },
  };
}

describe('interfaceClusterOf — affinity by contract kind', () => {
  it('http routes cluster by first path segment', () => {
    expect(interfaceClusterOf('http:GET /mcp/client/tool/list')).toEqual({
      key: '/mcp',
      label: '/mcp',
    });
    expect(interfaceClusterOf('http:POST /auth/login')).toEqual({ key: '/auth', label: '/auth' });
  });

  it('http uses two segments when the first is generic (/api/v2/…)', () => {
    expect(interfaceClusterOf('http:GET /api/v2/orders')?.key).toBe('/api/v2');
    expect(interfaceClusterOf('http:GET /api/v1/orders')?.key).toBe('/api/v1');
    // …but a lone generic first segment still groups on it
    expect(interfaceClusterOf('http:GET /api')?.key).toBe('/api');
  });

  it('http route-like strings without a path go to Other', () => {
    expect(interfaceClusterOf('http:ANY browser.click')?.key).toBe('other');
  });

  it('rpc clusters by service, topic/celery by family', () => {
    expect(interfaceClusterOf('rpc:ChatService/Stream')?.key).toBe('ChatService');
    expect(interfaceClusterOf('rpc:ChatService/Unary')?.key).toBe('ChatService');
    expect(interfaceClusterOf('celery:orders.send_email')?.key).toBe('orders');
    expect(interfaceClusterOf('topic:events/user.created')?.key).toBe('events');
  });

  it('kinds without useful hierarchy return null (the kind group is already semantic)', () => {
    expect(interfaceClusterOf('graphql:query:GetUser')).toBeNull();
    expect(interfaceClusterOf('table:orders')).toBeNull();
  });
});

describe('withInterfaceClusters', () => {
  it('splits a big HTTP group into named prefix clusters plus Other, reparenting endpoints', () => {
    const keys = [
      'http:GET /mcp/client/tool/list',
      'http:GET /mcp/client/tool/call',
      'http:GET /mcp/health',
      'http:POST /auth/login',
      'http:POST /auth/refresh',
      'http:GET /status',
    ];
    const view = viewWithGroup('grp:nat:http', keys);
    const out = withInterfaceClusters(view);
    const clusters = out.nodes.filter((n) => n.meta.role === 'cluster');
    expect(clusters.map((c) => c.label).sort()).toEqual(['/auth', '/mcp', 'Other']);
    for (const c of clusters) {
      expect(c.kind).toBe('group');
      expect(c.parent).toBe('grp:nat:http');
      expect(c.expanded).toBe(true);
    }
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get('ep:http:GET /mcp/health@nat')?.parent).toBe(
      clusterNodeId('grp:nat:http', '/mcp'),
    );
    expect(byId.get('ep:http:GET /status@nat')?.parent).toBe(
      clusterNodeId('grp:nat:http', 'other'),
    );
    // En el lienzo los endpoints cuelgan de la caja de su servicio como filas
    // (los clústeres sólo ordenan la vista; el orden visual es alfabético).
    const els = toCyElements(out);
    const mcpEp = els.find((e) => e.data.id === 'ep:http:GET /mcp/health@nat');
    expect(mcpEp?.group === 'nodes' && 'parent' in mcpEp.data ? mcpEp.data.parent : undefined).toBe(
      'svc:nat',
    );
    expect(els.some((e) => e.data.id === clusterNodeId('grp:nat:http', '/mcp'))).toBe(false);
  });

  it('keeps small groups flat (≤ CLUSTER_MIN endpoints)', () => {
    const keys = Array.from({ length: CLUSTER_MIN }, (_, i) => `http:GET /mcp/r${i}`);
    const view = viewWithGroup('grp:nat:http', keys);
    const out = withInterfaceClusters(view);
    expect(out.nodes.some((n) => n.meta.role === 'cluster')).toBe(false);
    expect(out).toBe(view); // sin clústeres la proyección se devuelve intacta
  });

  it('does not insert a level when everything falls into one cluster', () => {
    const keys = Array.from({ length: CLUSTER_MIN + 2 }, (_, i) => `http:GET /api/v2/r${i}`);
    const out = withInterfaceClusters(viewWithGroup('grp:nat:http', keys));
    expect(out.nodes.some((n) => n.meta.role === 'cluster')).toBe(false);
  });

  it('does not cluster groups that are not expanded, or the Interfaces group itself', () => {
    const keys = Array.from({ length: CLUSTER_MIN + 2 }, (_, i) => `http:GET /mcp/r${i}`);
    const collapsed = viewWithGroup('grp:nat:http', keys);
    collapsed.nodes = collapsed.nodes.map((n) =>
      n.id === 'grp:nat:http' ? { ...n, expanded: false } : n,
    );
    // Con el grupo cerrado sus endpoints no son visibles; aun así, por robustez:
    expect(withInterfaceClusters(collapsed).nodes.some((n) => n.meta.role === 'cluster')).toBe(
      false,
    );
  });

  it('clustered endpoints still hang from their service box as rows in layoutInput', () => {
    const keys = [
      'http:GET /mcp/a',
      'http:GET /mcp/b',
      'http:GET /auth/x',
      'http:GET /auth/y',
      'http:GET /status',
      'http:GET /health',
    ];
    const view = viewWithGroup('grp:nat:http', keys);
    const out = withInterfaceClusters(view);
    const li = layoutInput(out);
    const rows = li.nodes.filter((n) => n.row);
    expect(rows.length).toBe(6);
    // …y todos son filas dentro de la caja de su servicio.
    expect(rows.every((p) => p.parent === 'svc:nat')).toBe(true);
  });
});
