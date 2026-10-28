// Casos límite del modelo del mapa sobre grafos escritos a mano: cada rama de
// procedencia, filtros, proyección, vecindad, detalle y búsqueda. (Los flujos
// completos, construidos desde el análisis, están en org-graph.test.ts.)

import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  describeNode,
  expansionToReveal,
  filterOrgGraph,
  neighborhood,
  type OrgEdge,
  type OrgGraph,
  type OrgNode,
  projectOrgGraph,
  searchOrgGraph,
  toOrgGraph,
} from '../src/org-graph.js';
import type { TopologyEdge, TopologyNode } from '../src/topology.js';

const node = (
  id: string,
  kind: OrgNode['kind'],
  parent: string | null,
  extra: Partial<OrgNode> = {},
): OrgNode => ({
  id,
  label: id,
  kind,
  parent,
  meta: {},
  ...extra,
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
const inferred = (
  source: string,
  target: string,
  confidence: number,
  over: Partial<OrgEdge> = {},
) =>
  edge(source, target, {
    provenance: 'inferred',
    confidence,
    deterministicCount: 0,
    inferredCount: 1,
    ...over,
  });

describe('toOrgGraph', () => {
  const tn = (
    id: string,
    kind: TopologyNode['kind'],
    parent: string | null,
    meta?: Record<string, unknown>,
  ): TopologyNode => ({
    id,
    label: `L:${id}`,
    kind,
    parent,
    ...(meta ? { meta } : {}),
  });
  const te = (
    kind: TopologyEdge['kind'],
    meta?: Record<string, unknown>,
    label?: string,
  ): TopologyEdge => ({
    source: 's',
    target: 't',
    kind,
    ...(meta ? { meta } : {}),
    ...(label ? { label } : {}),
  });
  const one = (e: TopologyEdge) => toOrgGraph({ nodes: [], edges: [e] }).edges[0] as OrgEdge;

  it('copies nodes, defaults meta, and tags the contract only on endpoints that carry one', () => {
    const g = toOrgGraph({
      nodes: [
        tn('e1', 'endpoint', 'sv', { contractKind: 'http' }),
        tn('e2', 'endpoint', 'sv'),
        tn('sv', 'service', null, { contractKind: 'http' }),
        tn('e3', 'endpoint', 'sv', { contractKind: 7 }),
      ],
      edges: [],
    });
    const by = (id: string) => g.nodes.find((n) => n.id === id) as OrgNode;
    expect(by('e1')).toMatchObject({
      label: 'L:e1',
      kind: 'endpoint',
      parent: 'sv',
      contract: 'http',
    });
    expect(by('e2').contract).toBeUndefined();
    expect(by('e2').meta).toEqual({});
    expect(by('sv').contract).toBeUndefined();
    expect(by('e3').contract).toBeUndefined();
  });

  it('drops containment edges and keeps relation edges with a stable id and label', () => {
    const g = toOrgGraph({
      nodes: [],
      edges: [te('contains'), te('servedBy'), te('consumes', { staticUses: 1 }, 'customer_id')],
    });
    expect(g.edges.map((e) => e.id)).toEqual(['servedBy:s->t', 'consumes:s->t']);
    expect(g.edges[1]?.label).toBe('customer_id');
    expect(g.edges[0]?.label).toBeUndefined();
  });

  it('structural edges are deterministic with full confidence', () => {
    expect(one(te('servedBy', { confidence: 0.2, staticUses: 0, heuristicUses: 9 }))).toMatchObject(
      {
        provenance: 'deterministic',
        confidence: 1,
        count: 1,
        deterministicCount: 1,
        inferredCount: 0,
      },
    );
  });

  it('reads per-use counts: all static, all heuristic, and mixed', () => {
    expect(one(te('consumes', { staticUses: 3 }))).toMatchObject({
      provenance: 'deterministic',
      count: 3,
      deterministicCount: 3,
      inferredCount: 0,
    });
    expect(one(te('consumes', { heuristicUses: 2, confidence: 0.4 }))).toMatchObject({
      provenance: 'inferred',
      count: 2,
      deterministicCount: 0,
      inferredCount: 2,
      confidence: 0.4,
    });
    expect(one(te('consumes', { staticUses: 1, heuristicUses: 2 }))).toMatchObject({
      provenance: 'deterministic',
      count: 3,
      inferredCount: 2,
    });
    // Un contador no numérico no cuenta como contador.
    expect(one(te('consumes', { staticUses: '3', heuristicUses: 1 }))).toMatchObject({
      provenance: 'inferred',
      count: 1,
    });
  });

  it('without counts, provenance comes from the single binding', () => {
    expect(one(te('consumes', { binding: 'heuristic' }))).toMatchObject({
      provenance: 'inferred',
      count: 1,
      inferredCount: 1,
      deterministicCount: 0,
      confidence: 0,
    });
    expect(one(te('consumes', { binding: 'static' }))).toMatchObject({
      provenance: 'deterministic',
      count: 1,
      deterministicCount: 1,
      inferredCount: 0,
      confidence: 1,
    });
    expect(one(te('consumes'))).toMatchObject({
      provenance: 'deterministic',
      count: 1,
      confidence: 1,
    });
  });

  it('confidence: explicit value wins; otherwise 0 for inferred and 1 for deterministic', () => {
    expect(one(te('consumes', { staticUses: 1, confidence: 0.7 })).confidence).toBe(0.7);
    expect(one(te('consumes', { heuristicUses: 1 })).confidence).toBe(0);
    expect(one(te('consumes', { staticUses: 1 })).confidence).toBe(1);
  });
});

describe('ancestorsOf', () => {
  it('walks to the root, excludes the node itself, and survives cycles', () => {
    const byId = new Map(
      [node('a', 'repo', 'b'), node('b', 'service', 'a'), node('c', 'endpoint', 'b')].map((n) => [
        n.id,
        n,
      ]),
    );
    expect(ancestorsOf('c', byId)).toEqual(['b', 'a']);
    expect(ancestorsOf('a', byId)).toEqual(['b']);
    expect(ancestorsOf('zzz', byId)).toEqual([]);
  });
});

// repo:A ⊃ svc:A ⊃ ep:A1, ep:A2 ; repo:B ⊃ svc:B ; repo:C ⊃ svc:C
const nodes: OrgNode[] = [
  node('repo:A', 'repo', null),
  node('svc:A', 'service', 'repo:A', { label: 'alpha' }),
  node('ep:A1', 'endpoint', 'svc:A', { contract: 'http', label: 'GET /a1' }),
  node('ep:A2', 'endpoint', 'svc:A', { contract: 'topic', label: 'orders.created' }),
  node('repo:B', 'repo', null),
  node('svc:B', 'service', 'repo:B', { label: 'beta' }),
  node('repo:C', 'repo', null),
  node('svc:C', 'service', 'repo:C', { label: 'gamma' }),
];
const graph: OrgGraph = {
  nodes,
  edges: [
    edge('svc:B', 'ep:A1'),
    inferred('svc:C', 'ep:A1', 0.5),
    inferred('svc:C', 'ep:A2', 0.9),
    edge('ep:A1', 'svc:A', { id: 'servedBy:ep:A1->svc:A', kind: 'servedBy' }),
  ],
};
const ids = (g: OrgGraph) => g.nodes.map((n) => n.id).sort();

describe('filterOrgGraph', () => {
  it('no filters keeps everything', () => {
    const f = filterOrgGraph(graph, {});
    expect(f.nodes).toBe(graph.nodes);
    expect(f.edges).toHaveLength(4);
  });

  it('provenance keeps only that kind of relation (structural edges pass through)', () => {
    const f = filterOrgGraph(graph, { provenance: 'inferred' });
    expect(f.edges.filter((e) => e.kind === 'consumes').map((e) => e.source)).toEqual([
      'svc:C',
      'svc:C',
    ]);
    expect(ids(f)).not.toContain('repo:B');
    const d = filterOrgGraph(graph, { provenance: 'deterministic' });
    expect(d.edges.filter((e) => e.kind === 'consumes').map((e) => e.source)).toEqual(['svc:B']);
    expect(ids(d)).not.toContain('repo:C');
  });

  it('minConfidence keeps the boundary, drops weaker inferred, never touches static', () => {
    const f = filterOrgGraph(graph, { minConfidence: 0.5 });
    expect(f.edges.filter((e) => e.provenance === 'inferred')).toHaveLength(2);
    const g = filterOrgGraph(graph, { minConfidence: 0.6 });
    expect(g.edges.filter((e) => e.provenance === 'inferred').map((e) => e.target)).toEqual([
      'ep:A2',
    ]);
    expect(g.edges.some((e) => e.source === 'svc:B')).toBe(true);
    expect(filterOrgGraph(graph, { minConfidence: 0 }).edges).toHaveLength(4);
  });

  it('a relation filter prunes what no surviving relation touches, and keeps ancestors', () => {
    const f = filterOrgGraph(graph, { minConfidence: 0.95 });
    expect(ids(f)).toEqual(['ep:A1', 'repo:A', 'repo:B', 'svc:A', 'svc:B']);
    expect(f.edges.filter((e) => e.kind === 'consumes').map((e) => e.source)).toEqual(['svc:B']);
  });

  it('contract keeps the endpoints of that kind with their consumers, and the edges between them', () => {
    const f = filterOrgGraph(graph, { contract: 'topic' });
    expect(f.nodes.filter((n) => n.kind === 'endpoint').map((n) => n.id)).toEqual(['ep:A2']);
    expect(ids(f)).toEqual(['ep:A2', 'repo:A', 'repo:C', 'svc:A', 'svc:C']);
    expect(f.edges.map((e) => e.id)).toEqual(['consumes:svc:C->ep:A2']);
    // Una arista structural que NO toca un endpoint del contrato se va.
    expect(f.edges.some((e) => e.kind === 'servedBy')).toBe(false);
    expect(filterOrgGraph(graph, { contract: 'nope' }).nodes).toEqual([]);
  });

  it('service matches by id or label, keeps its endpoints and everything related', () => {
    for (const key of ['svc:A', 'alpha']) {
      const f = filterOrgGraph(graph, { service: key });
      expect(ids(f)).toEqual([
        'ep:A1',
        'ep:A2',
        'repo:A',
        'repo:B',
        'repo:C',
        'svc:A',
        'svc:B',
        'svc:C',
      ]);
    }
    const b = filterOrgGraph(graph, { service: 'beta' });
    expect(ids(b)).toEqual(['ep:A1', 'repo:A', 'repo:B', 'svc:A', 'svc:B']);
    expect(b.edges.map((e) => e.source)).toEqual(['svc:B']);
  });

  it('service does not match a non-service node or an unknown name, and returns nothing then', () => {
    expect(filterOrgGraph(graph, { service: 'ep:A1' })).toEqual({ nodes: [], edges: [] });
    expect(filterOrgGraph(graph, { service: 'nope' })).toEqual({ nodes: [], edges: [] });
  });

  it('service + contract intersect', () => {
    const f = filterOrgGraph(graph, { service: 'gamma', contract: 'topic' });
    expect(ids(f)).toEqual(['ep:A2', 'repo:A', 'repo:C', 'svc:A', 'svc:C']);
    expect(f.edges.map((e) => e.id)).toEqual(['consumes:svc:C->ep:A2']);
  });

  it('service + relation filter keep only related nodes that sit in a surviving relation', () => {
    const f = filterOrgGraph(graph, { service: 'alpha', provenance: 'deterministic' });
    expect(ids(f)).toEqual(['ep:A1', 'repo:A', 'repo:B', 'svc:A', 'svc:B']);
  });
});

describe('projectOrgGraph', () => {
  const open = (...x: string[]) => new Set(x);

  it('roots only, with child counts and no expanded flags', () => {
    const p = projectOrgGraph(graph, open());
    expect(p.nodes.map((n) => [n.id, n.childCount, n.expanded])).toEqual([
      ['repo:A', 1, false],
      ['repo:B', 1, false],
      ['repo:C', 1, false],
    ]);
    expect(p.hiddenChildren).toEqual({});
  });

  it('treats a node whose parent is not in the graph as a root', () => {
    const g: OrgGraph = { nodes: [node('x', 'service', 'ghost')], edges: [] };
    expect(projectOrgGraph(g, open()).nodes.map((n) => n.id)).toEqual(['x']);
  });

  it('rolls relations up to the nearest visible ancestor and sums the counts', () => {
    const p = projectOrgGraph(graph, open());
    const e = p.edges.find((x) => x.source === 'repo:C' && x.target === 'repo:A');
    expect(e).toMatchObject({
      id: 'consumes:repo:C->repo:A',
      count: 2,
      inferredCount: 2,
      deterministicCount: 0,
      provenance: 'inferred',
      confidence: 0.9,
    });
    expect(p.edges.find((x) => x.source === 'repo:B')).toMatchObject({
      count: 1,
      provenance: 'deterministic',
    });
  });

  it('merging an inferred and a deterministic edge upgrades to deterministic and keeps both counts', () => {
    const g: OrgGraph = {
      nodes: [
        node('r1', 'repo', null),
        node('r2', 'repo', null),
        node('s1', 'service', 'r1'),
        node('s2', 'service', 'r2'),
      ],
      edges: [inferred('s1', 's2', 0.3), edge('s1', 's2', { id: 'second' })],
    };
    const [e] = projectOrgGraph(g, open()).edges;
    expect(e).toMatchObject({
      provenance: 'deterministic',
      count: 2,
      deterministicCount: 1,
      inferredCount: 1,
      confidence: 1,
    });
    const g2: OrgGraph = { ...g, edges: [edge('s1', 's2'), inferred('s1', 's2', 0.3)] };
    expect(projectOrgGraph(g2, open()).edges[0]).toMatchObject({
      provenance: 'deterministic',
      confidence: 1,
    });
  });

  it('keeps a label only while every merged edge agrees on it', () => {
    const base = [
      node('r1', 'repo', null),
      node('r2', 'repo', null),
      node('s1', 'service', 'r1'),
      node('s2', 'service', 'r2'),
    ];
    const same = projectOrgGraph(
      { nodes: base, edges: [edge('s1', 's2', { label: 'x' }), edge('s1', 's2', { label: 'x' })] },
      open(),
    );
    expect(same.edges[0]?.label).toBe('x');
    const diff = projectOrgGraph(
      { nodes: base, edges: [edge('s1', 's2', { label: 'x' }), edge('s1', 's2', { label: 'y' })] },
      open(),
    );
    expect(diff.edges[0]).not.toHaveProperty('label');
    const noLabel = projectOrgGraph(
      { nodes: base, edges: [edge('s1', 's2', { label: 'x' }), edge('s1', 's2')] },
      open(),
    );
    expect(noLabel.edges[0]?.label).toBe('x');
  });

  it('drops edges whose end is its own ancestor or descendant (containment, not relation)', () => {
    const p = projectOrgGraph(graph, open('repo:A', 'svc:A'));
    expect(p.edges.some((e) => e.kind === 'servedBy')).toBe(false);
    expect(p.edges.find((e) => e.target === 'ep:A1' && e.source === 'repo:B')).toBeDefined();
    const g: OrgGraph = { nodes, edges: [edge('repo:A', 'svc:A')] };
    expect(projectOrgGraph(g, open('repo:A')).edges).toEqual([]);
    expect(
      projectOrgGraph({ nodes, edges: [edge('svc:A', 'repo:A')] }, open('repo:A')).edges,
    ).toEqual([]);
  });

  it('caps children by connectivity, then label, and counts what it hid', () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      node(`k${i}`, 'endpoint', 's', { label: `k${i}` }),
    );
    const g: OrgGraph = {
      nodes: [
        node('r', 'repo', null),
        node('s', 'service', 'r'),
        ...kids,
        node('o', 'service', null),
      ],
      edges: [edge('o', 'k3'), edge('o', 'k3'), edge('o', 'k1')],
    };
    const p = projectOrgGraph(g, open('r', 's'), { childLimit: 3 });
    const shown = p.nodes.filter((n) => n.kind === 'endpoint').map((n) => n.id);
    // k3 (2 relaciones), k1 (1), y entre los sin relaciones gana el primero por etiqueta.
    expect(shown.sort()).toEqual(['k0', 'k1', 'k3']);
    expect(p.hiddenChildren).toEqual({ s: 2 });
    // En el límite exacto no se oculta nada.
    expect(projectOrgGraph(g, open('r', 's'), { childLimit: 5 }).hiddenChildren).toEqual({});
  });

  it('pinned nodes beat connectivity, per-parent limits beat the default, and a closed parent hides nothing', () => {
    const kids = Array.from({ length: 4 }, (_, i) => node(`k${i}`, 'endpoint', 's'));
    const g: OrgGraph = {
      nodes: [
        node('r', 'repo', null),
        node('s', 'service', 'r'),
        ...kids,
        node('o', 'service', null),
      ],
      edges: [edge('o', 'k0'), edge('o', 'k0')],
    };
    const pinned = projectOrgGraph(g, open('r', 's'), { childLimit: 1, pinned: new Set(['k3']) });
    expect(pinned.nodes.filter((n) => n.kind === 'endpoint').map((n) => n.id)).toEqual(['k3']);
    const limited = projectOrgGraph(g, open('r', 's'), { childLimit: 1, limits: { s: 3 } });
    expect(limited.nodes.filter((n) => n.kind === 'endpoint')).toHaveLength(3);
    expect(projectOrgGraph(g, open('r'), { childLimit: 1 }).hiddenChildren).toEqual({});
  });

  it('only counts hidden children under parents that are themselves visible', () => {
    const g: OrgGraph = {
      nodes: [
        node('r', 'repo', null),
        node('s', 'service', 'r'),
        node('e1', 'endpoint', 's'),
        node('e2', 'endpoint', 's'),
      ],
      edges: [],
    };
    // s está expandido pero r no: nada de s es visible, y no se informa de ocultos.
    expect(projectOrgGraph(g, open('s'), { childLimit: 1 }).hiddenChildren).toEqual({});
  });

  it('a relation to a hidden child rolls up to its parent instead of disappearing', () => {
    const g: OrgGraph = {
      nodes: [
        node('r', 'repo', null),
        node('s', 'service', 'r'),
        node('e1', 'endpoint', 's'),
        node('e2', 'endpoint', 's'),
        node('o', 'service', null),
      ],
      edges: [edge('o', 'e1'), edge('o', 'e1'), edge('o', 'e2')],
    };
    const p = projectOrgGraph(g, open('r', 's'), { childLimit: 1 });
    expect(p.edges.map((e) => [e.source, e.target, e.count]).sort()).toEqual([
      ['o', 'e1', 2],
      ['o', 's', 1],
    ]);
  });

  it('survives a parent cycle', () => {
    const g: OrgGraph = { nodes: [node('a', 'repo', 'b'), node('b', 'service', 'a')], edges: [] };
    expect(() => projectOrgGraph(g, open('a', 'b'))).not.toThrow();
  });
});

describe('neighborhood / expansionToReveal', () => {
  const chain: OrgGraph = {
    nodes: ['a', 'b', 'c', 'd'].map((i) => node(i, 'service', null)),
    edges: [edge('a', 'b'), edge('c', 'b'), edge('c', 'd')],
  };
  it('grows one hop at a time, both directions, and stops when nothing new is reached', () => {
    expect(neighborhood(chain, 'a', 0)).toEqual(new Set(['a']));
    expect(neighborhood(chain, 'a', 1)).toEqual(new Set(['a', 'b']));
    expect(neighborhood(chain, 'a', 2)).toEqual(new Set(['a', 'b', 'c']));
    expect(neighborhood(chain, 'd', 9)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(neighborhood(chain, 'zz', 3)).toEqual(new Set(['zz']));
  });
  it('reveals exactly the ancestors of the given nodes', () => {
    expect(expansionToReveal(graph, ['ep:A1'])).toEqual(new Set(['svc:A', 'repo:A']));
    expect(expansionToReveal(graph, ['repo:A'])).toEqual(new Set());
    expect(expansionToReveal(graph, [])).toEqual(new Set());
  });
});

describe('describeNode', () => {
  it('collects consumers of anything inside a service, merging per peer service', () => {
    const g: OrgGraph = {
      nodes,
      edges: [
        edge('svc:B', 'ep:A1', { count: 2, deterministicCount: 2 }),
        inferred('svc:B', 'ep:A2', 0.4),
        inferred('svc:C', 'ep:A1', 0.6),
        edge('svc:A', 'ep:A2'), // lectura interna: ambos extremos dentro
      ],
    };
    const d = describeNode(g, 'svc:A');
    const byPeer = new Map(d?.consumers.map((c) => [c.peer.id, c.edge]));
    expect([...byPeer.keys()].sort()).toEqual(['svc:B', 'svc:C']);
    expect(byPeer.get('svc:B')).toMatchObject({
      count: 3,
      deterministicCount: 2,
      inferredCount: 1,
      provenance: 'deterministic',
      confidence: 1,
    });
    expect(byPeer.get('svc:C')).toMatchObject({ provenance: 'inferred', confidence: 0.6 });
    expect(d?.providers).toEqual([]);
    expect(d?.children.map((c) => c.id)).toEqual(['ep:A1', 'ep:A2']);
  });

  it('merging keeps the highest confidence and only upgrades provenance, never downgrades', () => {
    const g: OrgGraph = {
      nodes,
      edges: [
        inferred('svc:C', 'ep:A1', 0.3),
        inferred('svc:C', 'ep:A2', 0.8),
        edge('svc:C', 'ep:A1', { id: 'x' }),
        inferred('svc:C', 'ep:A1', 0.2, { id: 'y' }),
      ],
    };
    const rel = describeNode(g, 'svc:A')?.consumers[0]?.edge;
    expect(rel).toMatchObject({
      provenance: 'deterministic',
      confidence: 1,
      count: 4,
      inferredCount: 3,
      deterministicCount: 1,
    });
  });

  it('lists providers for a consumer and resolves them to their service', () => {
    const d = describeNode(graph, 'svc:C');
    expect(d?.providers.map((p) => p.peer.id)).toEqual(['svc:A']);
    expect(d?.providers[0]?.edge).toMatchObject({ count: 2, inferredCount: 2 });
    expect(d?.path.map((p) => p.id)).toEqual(['repo:C']);
  });

  it('works at repo level (whole subtree) and for an endpoint, with the path to the root', () => {
    const r = describeNode(graph, 'repo:A');
    expect(r?.consumers.map((c) => c.peer.id).sort()).toEqual(['svc:B', 'svc:C']);
    const e = describeNode(graph, 'ep:A1');
    expect(e?.consumers.map((c) => c.peer.id).sort()).toEqual(['svc:B', 'svc:C']);
    expect(e?.path.map((p) => p.id)).toEqual(['svc:A', 'repo:A']);
    expect(e?.children).toEqual([]);
  });

  it('falls back to the node itself when a peer has no service above it', () => {
    const g: OrgGraph = {
      nodes: [node('lone', 'repo', null), node('s', 'service', null), node('e', 'endpoint', 's')],
      edges: [edge('lone', 'e')],
    };
    expect(describeNode(g, 's')?.consumers[0]?.peer.id).toBe('lone');
  });

  it('ignores edges that do not cross the node boundary and non-consume edges', () => {
    const g: OrgGraph = {
      nodes,
      edges: [edge('svc:B', 'svc:C'), edge('ep:A1', 'svc:A', { kind: 'servedBy' })],
    };
    const d = describeNode(g, 'svc:A');
    expect(d?.consumers).toEqual([]);
    expect(d?.providers).toEqual([]);
  });
});

describe('searchOrgGraph', () => {
  const g: OrgGraph = {
    nodes: [
      node('1', 'service', null, { label: 'billing' }),
      node('2', 'service', null, { label: 'Order-billing' }),
      node('3', 'service', null, { label: 'BILLING-core' }),
      node('4', 'service', null, { label: 'orders' }),
    ],
    edges: [],
  };
  it('is case-insensitive, trims, ranks prefixes first then alphabetically', () => {
    expect(searchOrgGraph(g, '  BILL ').map((n) => n.id)).toEqual(['1', '3', '2']);
  });
  it('limits the results and returns nothing for an empty or unmatched query', () => {
    expect(searchOrgGraph(g, 'bill', 2).map((n) => n.id)).toEqual(['1', '3']);
    expect(searchOrgGraph(g, '').length).toBe(0);
    expect(searchOrgGraph(g, 'zzz').length).toBe(0);
  });
});

describe('model — remaining edge cases', () => {
  const served = (source: string, target: string): OrgEdge => ({
    ...edge(source, target),
    id: `servedBy:${source}->${target}`,
    kind: 'servedBy',
  });
  const g2: OrgGraph = {
    nodes,
    edges: [
      ...graph.edges.filter((e) => e.kind === 'consumes'),
      served('ep:A1', 'svc:A'),
      served('ep:A2', 'svc:A'),
    ],
  };

  it('ancestorsOf tolerates a parent that is not in the graph', () => {
    const byId = new Map([node('a', 'service', 'ghost')].map((x) => [x.id, x]));
    expect(ancestorsOf('a', byId)).toEqual(['ghost']);
  });

  it('structural edges survive provenance and confidence filters when both ends do', () => {
    const f = filterOrgGraph(g2, { provenance: 'inferred' });
    expect(f.edges.some((e) => e.id === 'servedBy:ep:A1->svc:A')).toBe(true);
    const g = filterOrgGraph(g2, { minConfidence: 0.95 });
    expect(g.edges.map((e) => e.id).sort()).toEqual([
      'consumes:svc:B->ep:A1',
      'servedBy:ep:A1->svc:A',
    ]);
  });

  it('never leaves an edge pointing at a node the filter removed', () => {
    const f = filterOrgGraph(g2, { minConfidence: 0.95 });
    const kept = new Set(f.nodes.map((x) => x.id));
    expect(f.edges.every((e) => kept.has(e.source) && kept.has(e.target))).toBe(true);
    expect(f.edges.some((e) => e.source === 'ep:A2')).toBe(false);
  });

  it('a static edge is not dropped by a confidence floor, and an inferred one with no floor is kept', () => {
    const lowStatic: OrgGraph = {
      nodes,
      edges: [edge('svc:B', 'ep:A1', { confidence: 0.1 }), inferred('svc:C', 'ep:A1', 0)],
    };
    expect(filterOrgGraph(lowStatic, { minConfidence: 0.5 }).edges.map((e) => e.source)).toEqual([
      'svc:B',
    ]);
    expect(
      filterOrgGraph(lowStatic, { provenance: 'inferred' }).edges.map((e) => e.source),
    ).toEqual(['svc:C']);
  });

  it('the contract filter matches endpoints only, and keeps structural edges of matching endpoints', () => {
    const odd: OrgGraph = {
      nodes: [...nodes.slice(0, 4), node('svc:X', 'service', null, { contract: 'http' })],
      edges: [served('ep:A1', 'svc:A'), edge('svc:X', 'svc:A')],
    };
    const f = filterOrgGraph(odd, { contract: 'http' });
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['ep:A1', 'repo:A', 'svc:A']);
    expect(f.edges.map((e) => e.id)).toEqual(['servedBy:ep:A1->svc:A']);
  });

  it('a service filter keeps the service and its own endpoints even with no relations', () => {
    const lone: OrgGraph = { nodes, edges: [] };
    const f = filterOrgGraph(lone, { service: 'svc:A' });
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['ep:A1', 'ep:A2', 'repo:A', 'svc:A']);
  });

  it('projection ignores an edge to a node that is not in the graph', () => {
    const dangling: OrgGraph = { nodes, edges: [edge('svc:B', 'nope'), edge('nope', 'svc:B')] };
    expect(projectOrgGraph(dangling, new Set()).edges).toEqual([]);
  });

  it('describeNode follows a subtree listed children-first, and skips edges from unknown nodes', () => {
    const reversed: OrgGraph = {
      nodes: [
        node('deep', 'endpoint', 'mid'),
        node('mid', 'service', 'top'),
        node('top', 'repo', null),
        node('out', 'service', null),
      ],
      edges: [edge('out', 'deep'), edge('ghost', 'deep')],
    };
    const d = describeNode(reversed, 'top');
    expect(d?.consumers.map((c) => c.peer.id)).toEqual(['out']);
  });

  it('describeNode copes with a peer whose parent is not in the graph', () => {
    const odd: OrgGraph = {
      nodes: [
        node('peer', 'service', 'ghost'),
        node('ep', 'endpoint', 'svc'),
        node('svc', 'service', null),
      ],
      edges: [edge('peer', 'ep')],
    };
    expect(describeNode(odd, 'svc')?.consumers.map((c) => c.peer.id)).toEqual(['peer']);
  });

  it('describeNode ignores structural edges that cross the boundary', () => {
    const cross: OrgGraph = { nodes, edges: [served('ep:A1', 'svc:C')] };
    const d = describeNode(cross, 'svc:A');
    expect(d?.providers).toEqual([]);
    expect(d?.consumers).toEqual([]);
  });

  it('merging two inferred relations stays inferred, with the higher confidence', () => {
    const two: OrgGraph = {
      nodes,
      edges: [inferred('svc:C', 'ep:A1', 0.3), inferred('svc:C', 'ep:A2', 0.6)],
    };
    const rel = describeNode(two, 'svc:A')?.consumers[0]?.edge;
    expect(rel).toMatchObject({ provenance: 'inferred', confidence: 0.6, count: 2 });
  });
});
