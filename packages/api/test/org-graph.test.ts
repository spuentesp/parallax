import { beforeAll, describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import {
  annotateRepos,
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
import {
  buildEndpointTopology,
  endpointNodeId,
  groupNodeId,
  interfacesNodeId,
  serviceNodeId,
} from '../src/topology.js';

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

const httpGroup = groupNodeId('orders', 'http');
const topicGroup = groupNodeId('orders', 'topic');
const ordersInterfaces = interfacesNodeId('orders');

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

  it('carries containment in parent, not as edges: endpoint → group of its kind → service', () => {
    expect(graph.edges.every((e) => e.kind === 'consumes' || e.kind === 'servedBy')).toBe(true);
    expect(graph.nodes.find((n) => n.id === getOrder)?.parent).toBe(httpGroup);
    expect(graph.nodes.find((n) => n.id === httpGroup)).toMatchObject({
      kind: 'group',
      label: 'HTTP routes',
      parent: orders,
    });
    expect(graph.nodes.find((n) => n.id === topicGroup)?.label).toBe('Topics and events');
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
    expect(one.nodes.some((n) => n.id === ordersInterfaces)).toBe(true);
    expect(one.nodes.some((n) => n.id === orders)).toBe(false);
    const two = projectOrgGraph(graph, new Set(['repo:orders', ordersInterfaces]));
    expect(two.nodes.some((n) => n.id === orders)).toBe(true);
    expect(two.nodes.some((n) => n.id === getOrder)).toBe(false);
    const three = projectOrgGraph(graph, new Set(['repo:orders', ordersInterfaces, orders]));
    expect(three.nodes.some((n) => n.id === httpGroup)).toBe(true);
    expect(three.nodes.some((n) => n.id === getOrder)).toBe(false);
    const four = projectOrgGraph(
      graph,
      new Set(['repo:orders', ordersInterfaces, orders, httpGroup]),
    );
    expect(four.nodes.some((n) => n.id === getOrder)).toBe(true);
    const orphan = projectOrgGraph(graph, new Set([ordersInterfaces, orders]));
    expect(orphan.nodes.some((n) => n.id === getOrder)).toBe(false);
  });

  it('lifts edges to endpoint level once visible, and drops containment self-edges', () => {
    const p = projectOrgGraph(graph, new Set(['repo:orders', ordersInterfaces, orders, httpGroup]));
    expect(p.edges.some((e) => e.source === 'repo:billing' && e.target === getOrder)).toBe(true);
    expect(p.edges.some((e) => e.kind === 'servedBy')).toBe(false);
  });

  it('reports child counts so the UI can draw expanders', () => {
    const p = projectOrgGraph(graph, new Set());
    expect(p.nodes.find((n) => n.id === 'repo:orders')?.childCount).toBe(1);
  });
});

describe('projectOrgGraph — tope de hijos', () => {
  const open = new Set([
    'repo:orders',
    ordersInterfaces,
    orders,
    httpGroup,
    topicGroup,
    'repo:billing',
    interfacesNodeId('billing'),
    'repo:analytics',
    interfacesNodeId('analytics'),
  ]);
  const listOrders = endpointNodeId(LIST_ORDERS, 'orders');
  const created = endpointNodeId(CREATED, 'orders');

  it('keeps the most connected children of each group and says how many it left out', () => {
    // El servicio muestra todos sus grupos; el tope de 1 actúa sobre los endpoints de cada grupo.
    const p = projectOrgGraph(graph, open, { childLimit: 1, limits: { [orders]: 10 } });
    const shown = p.nodes.filter((n) => n.kind === 'endpoint').map((n) => n.id);
    expect(shown.sort()).toEqual([created, listOrders].sort());
    expect(p.hiddenChildren[httpGroup]).toBe(1);
  });

  it('never drops the relations of hidden children: they roll up to the parent', () => {
    const p = projectOrgGraph(graph, open, { childLimit: 1, limits: { [orders]: 10 } });
    const reportsToOrders = p.edges.find((e) => e.source === reports && e.target === httpGroup);
    expect(reportsToOrders).toMatchObject({ provenance: 'inferred', count: 1 });
  });

  it('pins and per-parent limits override the cap', () => {
    const pinned = projectOrgGraph(graph, open, {
      childLimit: 1,
      limits: { [orders]: 10 },
      pinned: new Set([getOrder]),
    });
    expect(pinned.nodes.some((n) => n.id === getOrder)).toBe(true);
    const more = projectOrgGraph(graph, open, {
      childLimit: 1,
      limits: { [orders]: 10, [httpGroup]: 3 },
    });
    expect(more.hiddenChildren).toEqual({});
    expect(more.nodes.filter((n) => n.kind === 'endpoint')).toHaveLength(3);
  });
});

describe('annotateRepos — repo_id de LAIN para navegar el código', () => {
  it('links a repo node to its LAIN repo_id only on an exact match', () => {
    const annotated = annotateRepos(graph, new Set(['orders', 'billing']));
    const lain = (label: string) =>
      annotated.nodes.find((n) => n.kind === 'repo' && n.label === label)?.meta.lainRepoId;
    expect(lain('orders')).toBe('orders');
    expect(lain('billing')).toBe('billing');
    // "analytics" es el repo del servicio reports y no está entre los repos del
    // workspace: no se adivina un id parecido, queda null y la UI lo dice.
    expect(lain('analytics')).toBeNull();
  });

  it('leaves services, endpoints and edges untouched', () => {
    const annotated = annotateRepos(graph, new Set(['orders']));
    expect(annotated.edges).toBe(graph.edges);
    const svc = annotated.nodes.find((n) => n.id === orders);
    expect(svc?.meta).toEqual(graph.nodes.find((n) => n.id === orders)?.meta);
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

  it('includeStandalone preserves endpoint declarations even when relation filter matches zero edges', () => {
    const emptyEdgesGraph = {
      nodes: graph.nodes,
      edges: [],
    };
    const withoutFlag = filterOrgGraph(emptyEdgesGraph, { provenance: 'deterministic' });
    expect(withoutFlag.nodes).toHaveLength(0);

    const withFlag = filterOrgGraph(emptyEdgesGraph, {
      provenance: 'deterministic',
      includeStandalone: true,
    });
    expect(withFlag.nodes.filter((n) => n.kind === 'endpoint').length).toBeGreaterThan(0);
    // ancestors should also be preserved
    expect(withFlag.nodes.some((n) => n.kind === 'repo')).toBe(true);
    expect(withFlag.nodes.some((n) => n.kind === 'service')).toBe(true);
  });
});

describe('describeNode — "quién consume este endpoint"', () => {
  it('lists consuming services (any repo) with provenance for an endpoint', () => {
    const d = describeNode(graph, getOrder);
    const byPeer = new Map(d?.consumers.map((c) => [c.peer.id, c.edge]));
    expect([...byPeer.keys()].sort()).toEqual([billing, reports].sort());
    expect(byPeer.get(billing)?.provenance).toBe('deterministic');
    expect(byPeer.get(reports)?.provenance).toBe('inferred');
    expect(d?.path.map((n) => n.id)).toEqual([httpGroup, orders, ordersInterfaces, 'repo:orders']);
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

  it('a relation names the specific endpoints behind it, most used first, with fields, provenance and caller sites', () => {
    const rel = describeNode(graph, orders)?.consumers.find((c) => c.peer.id === billing);
    expect(rel?.links.length).toBeGreaterThan(0);
    expect(rel?.links.map((l) => l.endpoint.kind)).toEqual(rel?.links.map(() => 'endpoint'));
    // El desglose suma lo que dice la relación: nada se pierde ni se inventa.
    expect(rel?.links.reduce((n, l) => n + l.count, 0)).toBe(rel?.edge.count);
    const counts = rel?.links.map((l) => l.count) ?? [];
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const first = rel?.links[0];
    expect(first?.fields).toContain('customer_id');
    expect(first?.sites[0]).toMatchObject({ repo: 'x', line: 1 });
    expect(rel?.hiddenLinks).toBe(0);
  });

  it('the provider side lists the endpoints a consumer depends on', () => {
    const rel = describeNode(graph, billing)?.providers.find((p) => p.peer.id === orders);
    expect(rel?.links.every((l) => l.endpoint.parent?.startsWith('grp:orders:'))).toBe(true);
    expect(rel?.links.some((l) => l.endpoint.id === getOrder)).toBe(true);
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
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

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

  it('is fresh up to and including the TTL, stale after it', async () => {
    let t = 0;
    const cache = new OrgGraphCache({ ttlMs: 100, now: () => t });
    await cache.get('k', async () => g1);
    t = 100;
    expect((await cache.get('k', async () => g2)).stale).toBe(false);
    t = 101;
    expect((await cache.get('k', async () => g2)).stale).toBe(true);
  });

  it('serves the stale graph immediately and revalidates in the background, once', async () => {
    let t = 0;
    let builds = 0;
    let release: (g: OrgGraph) => void = () => {};
    const cache = new OrgGraphCache({ ttlMs: 100, now: () => t });
    await cache.get('k', async () => {
      builds++;
      return g1;
    });
    t = 500;
    const slow = () => {
      builds++;
      return new Promise<OrgGraph>((r) => {
        release = r;
      });
    };
    const first = await cache.get('k', slow);
    expect(first.stale).toBe(true);
    expect(first.graph).toBe(g1);
    // La reconstrucción ya está en vuelo: lo dice, y una segunda petición no abre otra.
    const second = await cache.get('k', slow);
    expect(second.refreshing).toBe(true);
    expect(builds).toBe(2);

    release(g2);
    await tick();
    const done = await cache.get('k', slow);
    expect(done.graph).toBe(g2);
    expect(done.stale).toBe(false);
    expect(done.refreshing).toBe(false);
    expect(done.generatedAt).toBe(500);
  });

  it('refresh waits for the engine and always returns a fresh graph', async () => {
    let t = 0;
    const cache = new OrgGraphCache({ ttlMs: 100, now: () => t });
    await cache.get('k', async () => g1);
    t = 500;
    const r = await cache.refresh('k', async () => g2);
    expect(r).toMatchObject({ stale: false, refreshing: false, generatedAt: 500 });
    expect(r.graph).toBe(g2);
  });

  it('keeps the previous graph and exposes the error when a rebuild fails, then clears it on success', async () => {
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    await cache.get('k', async () => g1);
    const failed = await cache.refresh('k', async () => {
      throw new Error('lain down');
    });
    expect(failed.graph).toBe(g1);
    expect(failed.lastError).toBe('lain down');
    const labelled = await cache.refresh('k', async () => {
      throw 'boom';
    });
    expect(labelled.lastError).toBe('org graph build failed');
    const healed = await cache.refresh('k', async () => g2);
    expect(healed.graph).toBe(g2);
    expect(healed).not.toHaveProperty('lastError');
  });

  it('propagates the failure of the very first build instead of returning an empty graph', async () => {
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    await expect(
      cache.get('k', async () => {
        throw new Error('lain down');
      }),
    ).rejects.toThrow('lain down');
    await expect(
      cache.refresh('k', async () => {
        throw new Error('still down');
      }),
    ).rejects.toThrow('still down');
    await expect(
      cache.refresh('k', async () => {
        throw 'boom';
      }),
    ).rejects.toThrow('org graph build failed');
  });

  it('keys entries independently and can forget one', async () => {
    let calls = 0;
    const cache = new OrgGraphCache({ ttlMs: 1000, now: () => 0 });
    const build = async () => {
      calls++;
      return g1;
    };
    await cache.get('a', build);
    await cache.get('b', build);
    expect(calls).toBe(2);
    cache.invalidate('a');
    await cache.get('a', build);
    await cache.get('b', build);
    expect(calls).toBe(3);
  });
});
