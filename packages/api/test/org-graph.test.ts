import { beforeAll, describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import {
  describeNode,
  filterOrgGraph,
  neighborhood,
  type OrgGraph,
  projectOrgGraph,
  searchOrgGraph,
  toOrgGraph,
} from '../src/org-graph.js';
import { OrgGraphCache } from '../src/org-graph-cache.js';
import { viewOrgGraph } from '../src/org-graph-view.js';
import { buildEndpointTopology, endpointNodeId, serviceNodeId } from '../src/topology.js';

// El grafo sale del camino real (buildEndpointTopology sobre un LAIN falso en
// el borde del proceso): nada se inserta a mano en el modelo.
const GET_ORDER = 'http:GET /api/orders/{}';
const LIST_ORDERS = 'http:GET /api/orders';
const CREATED = 'topic:kafka/orders.created';

function use(endpoint: string, kind: 'static' | 'heuristic', confidence: number, path: string) {
  return {
    binding: { confidence, kind, source: kind === 'static' ? 'TreeSitter' : 'name-match' },
    endpoint: { key: endpoint, service: 'orders' },
    fields: ['customer_id'],
    match: 'exact',
    caller: { repo: 'x', path, line: 1, id: `${path}:1` },
  };
}

const fake = {
  analyzerVersion: 'test',
  apiVersion: '1' as const,
  listServices: async () => ({
    items: [
      {
        service: 'orders',
        repo: 'orders',
        endpoints: 3,
        consumer_services: 3,
        unresolved_inbound: 0,
        paths: [],
      },
      {
        service: 'billing',
        repo: 'billing',
        endpoints: 0,
        consumer_services: 0,
        unresolved_inbound: 0,
        paths: [],
      },
      {
        service: 'reports',
        repo: 'analytics',
        endpoints: 0,
        consumer_services: 0,
        unresolved_inbound: 0,
        paths: [],
      },
    ],
    scope: { configured_only: true, reviewed: [], unreviewed: [] },
  }),
  listContracts: async () => ({
    items: [GET_ORDER, LIST_ORDERS, CREATED].map((key) => ({
      endpoint: { key, service: 'orders' },
      has_schema: true,
      bound_consumers: 1,
      providers: [{ repo: 'orders', path: 'src/api.py', line: 10 }],
    })),
    cursor: null,
  }),
  getService: async (req: { service: string }) => {
    if (req.service !== 'orders') return { service: req.service, consumers: [], endpoints: [] };
    return {
      service: 'orders',
      endpoints: [],
      consumers: [
        // billing: sólo vínculos estáticos.
        {
          service: 'billing',
          repo: 'billing',
          uses: [use(GET_ORDER, 'static', 1, 'b.py'), use(CREATED, 'static', 1, 'b.py')],
        },
        // reports: sólo heurístico, poca confianza.
        { service: 'reports', repo: 'analytics', uses: [use(GET_ORDER, 'heuristic', 0.4, 'r.py')] },
        // mixto en un mismo endpoint: 1 estático + 2 heurísticos.
        {
          service: 'billing',
          repo: 'billing',
          uses: [
            use(LIST_ORDERS, 'static', 1, 'b2.py'),
            use(LIST_ORDERS, 'heuristic', 0.7, 'b2.py'),
            use(LIST_ORDERS, 'heuristic', 0.5, 'b2.py'),
          ],
        },
      ],
    };
  },
} as unknown as LainAdapter;

let graph: OrgGraph;
beforeAll(async () => {
  graph = toOrgGraph(await buildEndpointTopology(fake));
});

const billing = serviceNodeId('billing');
const reports = serviceNodeId('reports');
const orders = serviceNodeId('orders');
const getOrder = endpointNodeId(GET_ORDER, 'orders');

describe('toOrgGraph — procedencia', () => {
  it('marks static bindings deterministic and heuristic ones inferred with confidence', () => {
    const det = graph.edges.find((e) => e.source === billing && e.target === getOrder);
    const inf = graph.edges.find((e) => e.source === reports && e.target === getOrder);
    expect(det).toMatchObject({ provenance: 'deterministic', confidence: 1 });
    expect(inf).toMatchObject({
      provenance: 'inferred',
      confidence: 0.4,
      inferredCount: 1,
      deterministicCount: 0,
    });
  });

  it('keeps a mixed edge deterministic but never hides the heuristic uses', () => {
    const mixed = graph.edges.find(
      (e) => e.target === endpointNodeId(LIST_ORDERS, 'orders') && e.source === billing,
    );
    expect(mixed).toMatchObject({
      provenance: 'deterministic',
      deterministicCount: 1,
      inferredCount: 2,
    });
  });

  it('carries containment in parent, not as edges', () => {
    expect(graph.edges.every((e) => e.kind === 'consumes' || e.kind === 'servedBy')).toBe(true);
    expect(graph.nodes.find((n) => n.id === getOrder)?.parent).toBe(orders);
    expect(graph.nodes.find((n) => n.id === getOrder)?.contract).toBe('http');
  });
});

describe('projectOrgGraph — niveles y agregación', () => {
  it('shows only roots when nothing is expanded, with relations rolled up to repos', () => {
    const p = projectOrgGraph(graph, new Set());
    expect(p.nodes.every((n) => n.parent === null)).toBe(true);
    const billingToOrders = p.edges.find(
      (e) => e.source === 'repo:billing' && e.target === 'repo:orders',
    );
    // 3 relaciones billing → orders: GET_ORDER, CREATED y LIST_ORDERS (mixta).
    expect(billingToOrders?.count).toBe(1 + 1 + 3);
    expect(billingToOrders?.provenance).toBe('deterministic');
    expect(billingToOrders?.inferredCount).toBe(2);
  });

  it('keeps the inferred-only relation inferred after roll-up', () => {
    const p = projectOrgGraph(graph, new Set());
    const e = p.edges.find((x) => x.source === 'repo:analytics' && x.target === 'repo:orders');
    expect(e).toMatchObject({ provenance: 'inferred', confidence: 0.4 });
  });

  it('expands lazily: children appear only under expanded parents', () => {
    const one = projectOrgGraph(graph, new Set(['repo:orders']));
    expect(one.nodes.some((n) => n.id === orders)).toBe(true);
    expect(one.nodes.some((n) => n.id === getOrder)).toBe(false);
    const two = projectOrgGraph(graph, new Set(['repo:orders', orders]));
    expect(two.nodes.some((n) => n.id === getOrder)).toBe(true);
    // Un expandido sin su ancestro abierto no aparece.
    const orphan = projectOrgGraph(graph, new Set([orders]));
    expect(orphan.nodes.some((n) => n.id === getOrder)).toBe(false);
  });

  it('lifts edges to endpoint level once visible, and drops containment self-edges', () => {
    const p = projectOrgGraph(graph, new Set(['repo:orders', orders]));
    expect(p.edges.some((e) => e.source === 'repo:billing' && e.target === getOrder)).toBe(true);
    expect(p.edges.some((e) => e.kind === 'servedBy')).toBe(false);
  });

  it('reports child counts so the UI can draw expanders', () => {
    const p = projectOrgGraph(graph, new Set());
    expect(p.nodes.find((n) => n.id === 'repo:orders')?.childCount).toBe(1);
  });
});

describe('projectOrgGraph — tope de hijos', () => {
  const open = new Set(['repo:orders', orders, 'repo:billing', 'repo:analytics']);
  const listOrders = endpointNodeId(LIST_ORDERS, 'orders');

  it('keeps the most connected children and says how many it left out', () => {
    const p = projectOrgGraph(graph, open, { childLimit: 1 });
    const shown = p.nodes.filter((n) => n.kind === 'endpoint').map((n) => n.id);
    expect(shown).toEqual([listOrders]);
    expect(p.hiddenChildren[orders]).toBe(2);
  });

  it('never drops the relations of hidden children: they roll up to the parent', () => {
    const p = projectOrgGraph(graph, open, { childLimit: 1 });
    const reportsToOrders = p.edges.find((e) => e.source === reports && e.target === orders);
    expect(reportsToOrders).toMatchObject({ provenance: 'inferred', count: 1 });
  });

  it('pins and per-parent limits override the cap', () => {
    const pinned = projectOrgGraph(graph, open, { childLimit: 1, pinned: new Set([getOrder]) });
    expect(pinned.nodes.some((n) => n.id === getOrder)).toBe(true);
    const more = projectOrgGraph(graph, open, { childLimit: 1, limits: { [orders]: 3 } });
    expect(more.hiddenChildren).toEqual({});
    expect(more.nodes.filter((n) => n.kind === 'endpoint')).toHaveLength(3);
  });
});

describe('filterOrgGraph', () => {
  it('provenance=inferred keeps only inferred relations and what they touch', () => {
    const f = filterOrgGraph(graph, { provenance: 'inferred' });
    expect(
      f.edges.filter((e) => e.kind === 'consumes').every((e) => e.provenance === 'inferred'),
    ).toBe(true);
    expect(f.nodes.some((n) => n.id === reports)).toBe(true);
    expect(f.nodes.some((n) => n.id === endpointNodeId(CREATED, 'orders'))).toBe(false);
  });

  it('minConfidence drops weak inferred relations but never static ones', () => {
    const f = filterOrgGraph(graph, { minConfidence: 0.9 });
    const consumes = f.edges.filter((e) => e.kind === 'consumes');
    expect(consumes.some((e) => e.source === reports)).toBe(false);
    expect(consumes.some((e) => e.source === billing)).toBe(true);
  });

  it('contract filter narrows to endpoints of that kind', () => {
    const f = filterOrgGraph(graph, { contract: 'topic' });
    const endpoints = f.nodes.filter((n) => n.kind === 'endpoint');
    expect(endpoints.map((n) => n.label)).toEqual([CREATED]);
  });

  it('service filter keeps the service, its consumers and their relations', () => {
    const f = filterOrgGraph(graph, { service: 'reports' });
    expect(f.nodes.some((n) => n.id === reports)).toBe(true);
    expect(f.nodes.some((n) => n.id === billing)).toBe(false);
  });
});

describe('describeNode — "quién consume este endpoint"', () => {
  it('lists consuming services (any repo) with provenance for an endpoint', () => {
    const d = describeNode(graph, getOrder);
    const byPeer = new Map(d?.consumers.map((c) => [c.peer.id, c.edge]));
    expect([...byPeer.keys()].sort()).toEqual([billing, reports].sort());
    expect(byPeer.get(billing)?.provenance).toBe('deterministic');
    expect(byPeer.get(reports)?.provenance).toBe('inferred');
    expect(d?.path.map((n) => n.id)).toEqual([orders, 'repo:orders']);
  });

  it('for a service aggregates consumers across all its endpoints', () => {
    const d = describeNode(graph, orders);
    const billingRel = d?.consumers.find((c) => c.peer.id === billing);
    expect(billingRel?.edge.count).toBe(5);
    expect(d?.providers).toEqual([]);
  });

  it('shows what a consumer depends on', () => {
    const d = describeNode(graph, billing);
    expect(d?.providers.map((p) => p.peer.id)).toEqual([orders]);
  });

  it('returns null for an unknown node', () => {
    expect(describeNode(graph, 'nope')).toBeNull();
  });
});

describe('neighborhood / searchOrgGraph / viewOrgGraph', () => {
  it('reaches consumers at 1 hop and providers at 2', () => {
    expect(neighborhood(graph, getOrder, 0)).toEqual(new Set([getOrder]));
    expect(neighborhood(graph, getOrder, 1).has(billing)).toBe(true);
    expect(neighborhood(graph, billing, 1).has(orders)).toBe(false);
  });

  it('searches by label, prefixes first', () => {
    const r = searchOrgGraph(graph, 'orders');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.label.toLowerCase().startsWith('orders')).toBe(true);
    expect(searchOrgGraph(graph, '  ')).toEqual([]);
  });

  it('focus reveals the seed and its neighborhood and reports the ids to highlight', () => {
    const v = viewOrgGraph(graph, { focus: getOrder, hops: 1 });
    expect(v.focus?.seed).toBe(getOrder);
    expect(v.nodes.some((n) => n.id === getOrder)).toBe(true);
    expect(v.nodes.some((n) => n.id === billing)).toBe(true);
    expect(new Set(v.focus?.ids)).toEqual(neighborhood(graph, getOrder, 1));
  });

  it('flags expansions that no longer exist under the current filters', () => {
    const v = viewOrgGraph(graph, {
      expand: ['repo:orders', 'ghost'],
      filters: { provenance: 'inferred' },
    });
    expect(v.unknownExpand).toEqual(['ghost']);
    expect(v.totals.shownNodes).toBe(v.nodes.length);
  });
});

describe('OrgGraphCache', () => {
  const g1: OrgGraph = { nodes: [], edges: [] };
  const g2: OrgGraph = {
    nodes: [{ id: 'a', label: 'a', kind: 'repo', parent: null, meta: {} }],
    edges: [],
  };

  it('builds once, then serves from memory and shares concurrent builds', async () => {
    let calls = 0;
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    const build = async () => {
      calls++;
      return g1;
    };
    const [a, b] = await Promise.all([cache.get('k', build), cache.get('k', build)]);
    await cache.get('k', build);
    expect(calls).toBe(1);
    expect(a.graph).toBe(b.graph);
    expect(a.stale).toBe(false);
  });

  it('serves the stale graph immediately and revalidates in the background', async () => {
    let t = 0;
    let n = 0;
    const cache = new OrgGraphCache({ ttlMs: 100, now: () => t });
    const build = async () => {
      n++;
      return n === 1 ? g1 : g2;
    };
    await cache.get('k', build);
    t = 500;
    const stale = await cache.get('k', build);
    expect(stale.stale).toBe(true);
    expect(stale.graph).toBe(g1);
    await cache.refresh('k', async () => g2);
    const fresh = await cache.get('k', build);
    expect(fresh.graph).toBe(g2);
    expect(fresh.generatedAt).toBe(500);
  });

  it('keeps the previous graph and exposes the error when a rebuild fails', async () => {
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    await cache.get('k', async () => g1);
    const after = await cache.refresh('k', async () => {
      throw new Error('lain down');
    });
    expect(after.graph).toBe(g1);
    expect(after.lastError).toBe('lain down');
  });

  it('propagates the failure of the very first build instead of returning an empty graph', async () => {
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    await expect(
      cache.get('k', async () => {
        throw new Error('lain down');
      }),
    ).rejects.toThrow('lain down');
  });
});
