import type { OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { describe, expect, it } from 'vitest';
import {
  edgeLabel,
  edgeOpacity,
  edgeWidth,
  LOUD_PER_NODE,
  nodeLabel,
  QUIET_THRESHOLD,
  quietEdgeIds,
  toCyElements,
} from './elements.js';

const node = (over: Partial<ProjectedNode> & { id: string }): ProjectedNode => ({
  label: over.id,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});

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

describe('edge styling encodes provenance, not decoration', () => {
  it('deterministic edges are always fully opaque; inferred ones fade with confidence', () => {
    expect(edgeOpacity({ provenance: 'deterministic', confidence: 1 })).toBeGreaterThan(0.85);
    const weak = edgeOpacity({ provenance: 'inferred', confidence: 0.2 });
    const strong = edgeOpacity({ provenance: 'inferred', confidence: 0.9 });
    expect(weak).toBeLessThan(strong);
    expect(strong).toBeLessThan(edgeOpacity({ provenance: 'deterministic', confidence: 1 }) + 0.05);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 0 })).toBeGreaterThan(0.3);
  });

  it('width grows with rolled-up relations but is capped', () => {
    expect(edgeWidth(1)).toBeLessThan(edgeWidth(8));
    expect(edgeWidth(1_000_000)).toBeLessThanOrEqual(2.6);
  });

  it('labels aggregates with the count and flags mixed provenance', () => {
    expect(edgeLabel(edge())).toBe('');
    expect(edgeLabel(edge({ count: 5, deterministicCount: 5 }))).toBe('×5');
    expect(edgeLabel(edge({ count: 5, deterministicCount: 3, inferredCount: 2 }))).toBe('×5 (2~)');
  });
});

describe('nodeLabel', () => {
  it('shows how many things a collapsed node holds', () => {
    expect(nodeLabel(node({ id: 's', label: 'orders', childCount: 12 }), 0)).toBe('orders  ▸ 12');
  });
  it('says how many children the cap left out of an open node', () => {
    expect(nodeLabel(node({ id: 's', label: 'orders', childCount: 90, expanded: true }), 40)).toBe(
      'orders  (+40)',
    );
  });
  it('drops the contract prefix of endpoints (the colour already says it)', () => {
    expect(
      nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'http:GET /api/orders/{}' }), 0),
    ).toBe('GET /api/orders/{}');
  });
});

describe('toCyElements', () => {
  const view = {
    nodes: [
      node({ id: 'repo:a', kind: 'repo', label: 'a', childCount: 1, expanded: true }),
      node({ id: 'svc:a', parent: 'repo:a', label: 'a-svc', childCount: 2 }),
      node({ id: 'svc:ghost', parent: 'repo:missing', label: 'ghost' }),
    ],
    edges: [
      edge({
        id: 'ok',
        source: 'svc:a',
        target: 'svc:ghost',
        provenance: 'inferred',
        confidence: 0.5,
      }),
      edge({ id: 'dangling', source: 'svc:a', target: 'nope' }),
    ],
    hiddenChildren: {},
  };
  const els = toCyElements(view);

  it('nests children as compound nodes only when the parent is in the view', () => {
    const parentOf = (id: string): string | undefined => {
      const e = els.find((x) => x.data.id === id);
      return e?.group === 'nodes' ? e.data.parent : undefined;
    };
    expect(parentOf('svc:a')).toBe('repo:a');
    expect(parentOf('svc:ghost')).toBeUndefined();
  });

  it('marks closed nodes with contents so the canvas can draw them dashed', () => {
    const svc = els.find((e) => e.data.id === 'svc:a');
    expect(svc?.classes).toContain('collapsible');
    expect(els.find((e) => e.data.id === 'repo:a')?.classes).toContain('expanded');
  });

  it('classes edges by provenance and never emits an edge to a node that is not drawn', () => {
    const edges = els.filter((e) => e.group === 'edges');
    expect(edges.map((e) => e.data.id)).toEqual(['ok']);
    expect(edges[0]?.classes).toBe('inferred');
  });
});

describe('quietEdgeIds — divulgación progresiva', () => {
  // Malla de 10 nodos (90 aristas dirigidas): el caso que se vuelve mancha.
  const mesh = (): OrgEdge[] => {
    const out: OrgEdge[] = [];
    for (let a = 0; a < 10; a++) {
      for (let b = 0; b < 10; b++) {
        if (a !== b)
          out.push(
            edge({
              id: `e${a}-${b}`,
              source: `n${a}`,
              target: `n${b}`,
              count: ((a * 7 + b * 3) % 9) + 1,
            }),
          );
      }
    }
    return out;
  };

  it('quiets nothing in a graph small enough to read whole', () => {
    expect(quietEdgeIds(mesh().slice(0, QUIET_THRESHOLD)).size).toBe(0);
  });

  it('quiets part of a dense graph but never its strongest relation', () => {
    const edges = mesh();
    const quiet = quietEdgeIds(edges);
    expect(quiet.size).toBeGreaterThan(0);
    expect(quiet.size).toBeLessThan(edges.length);
    const strongest = [...edges].sort((a, b) => b.count - a.count)[0];
    expect(quiet.has(strongest?.id ?? '')).toBe(false);
  });

  it('every node keeps at least one visible relation, so nothing looks isolated', () => {
    const edges = mesh();
    const quiet = quietEdgeIds(edges);
    for (const id of new Set(edges.flatMap((e) => [e.source, e.target]))) {
      expect(edges.some((e) => (e.source === id || e.target === id) && !quiet.has(e.id))).toBe(
        true,
      );
    }
  });

  it('keeps at most LOUD_PER_NODE per endpoint plus what its peers promote', () => {
    const edges = mesh();
    const loud = edges.filter((e) => !quietEdgeIds(edges).has(e.id));
    // Cota: cada nodo promueve K aristas, y cada arista la promueven como mucho 2 extremos.
    expect(loud.length).toBeLessThanOrEqual(10 * LOUD_PER_NODE);
  });
});
