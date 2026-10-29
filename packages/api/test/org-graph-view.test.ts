import { describe, expect, it } from 'vitest';
import type { OrgEdge, OrgGraph, OrgNode } from '../src/org-graph.js';
import { MAX_HOPS, viewOrgGraph } from '../src/org-graph-view.js';

const n = (id: string, kind: OrgNode['kind'], parent: string | null = null): OrgNode => ({
  id,
  label: id,
  kind,
  parent,
  meta: {},
});
const e = (source: string, target: string): OrgEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  kind: 'consumes',
  provenance: 'deterministic',
  confidence: 1,
  count: 1,
  deterministicCount: 1,
  inferredCount: 0,
});

// r1 ⊃ s1 ⊃ e1 ; r2 ⊃ s2 ; r3 ⊃ s3 ⊃ e3 ; cadena s2 → e1 ; s3 → s2
const graph: OrgGraph = {
  nodes: [
    n('r1', 'repo'),
    n('s1', 'service', 'r1'),
    n('e1', 'endpoint', 's1'),
    n('r2', 'repo'),
    n('s2', 'service', 'r2'),
    n('r3', 'repo'),
    n('s3', 'service', 'r3'),
    n('e3', 'endpoint', 's3'),
  ],
  edges: [e('s2', 'e1'), e('s3', 's2'), e('s3', 'e3')],
};
const ids = (v: { nodes: Array<{ id: string }> }) => v.nodes.map((x) => x.id).sort();

describe('viewOrgGraph', () => {
  it('returns the top level with totals when nothing is asked', () => {
    const v = viewOrgGraph(graph, {});
    expect(ids(v)).toEqual(['r1', 'r2', 'r3']);
    expect(v.focus).toBeNull();
    expect(v.unknownExpand).toEqual([]);
    expect(v.totals).toEqual({ nodes: 8, edges: 3, shownNodes: 3, shownEdges: v.edges.length });
  });

  it('opens what is asked and reports ids that are not in the (filtered) graph', () => {
    const v = viewOrgGraph(graph, { expand: ['r1', 'ghost'] });
    expect(ids(v)).toEqual(['r1', 'r2', 'r3', 's1']);
    expect(v.unknownExpand).toEqual(['ghost']);
  });

  it('filters first: an id the filter removed is "unknown", and totals count the filtered graph', () => {
    const v = viewOrgGraph(graph, { expand: ['r1'], filters: { contract: 'http' } });
    expect(v.unknownExpand).toEqual(['r1']);
    expect(v.totals.nodes).toBe(0);
  });

  it('focus reveals the neighbourhood, defaults to 1 hop, and lists the ids to highlight', () => {
    const v = viewOrgGraph(graph, { focus: 'e1' });
    expect(v.focus?.seed).toBe('e1');
    expect([...(v.focus?.ids ?? [])].sort()).toEqual(['e1', 's2']);
    expect(ids(v)).toEqual(expect.arrayContaining(['e1', 's1', 's2', 'r1', 'r2']));
  });

  it('hops: 0 stays on the seed, more hops reach further, and the cap is MAX_HOPS', () => {
    expect(viewOrgGraph(graph, { focus: 'e1', hops: 0 }).focus?.ids).toEqual(['e1']);
    expect([...(viewOrgGraph(graph, { focus: 'e1', hops: 2 }).focus?.ids ?? [])].sort()).toEqual([
      'e1',
      's2',
      's3',
    ]);
    expect(MAX_HOPS).toBe(4);
    const huge = viewOrgGraph(graph, { focus: 'e1', hops: 99 });
    const capped = viewOrgGraph(graph, { focus: 'e1', hops: MAX_HOPS });
    expect(huge.focus?.ids).toEqual(capped.focus?.ids);
    expect(viewOrgGraph(graph, { focus: 'e1', hops: -3 }).focus?.ids).toEqual(['e1']);
  });

  it('a focus that does not exist gives no focus instead of an empty view', () => {
    const v = viewOrgGraph(graph, { focus: 'ghost', hops: 2 });
    expect(v.focus).toBeNull();
    expect(ids(v)).toEqual(['r1', 'r2', 'r3']);
  });

  it('pinning reveals the pinned node and its ancestors; unknown pins are ignored', () => {
    const v = viewOrgGraph(graph, { pin: ['e3', 'ghost'] });
    expect(ids(v)).toEqual(expect.arrayContaining(['e3', 's3', 'r3']));
    expect(ids(v)).not.toContain('e1');
  });

  it('a pinned node survives the per-parent cap', () => {
    const big: OrgGraph = {
      nodes: [
        n('r', 'repo'),
        n('s', 'service', 'r'),
        ...Array.from({ length: 5 }, (_, i) => n(`k${i}`, 'endpoint', 's')),
      ],
      edges: [],
    };
    const v = viewOrgGraph(big, { expand: ['r', 's'], limits: { s: 2 }, pin: ['k4'] });
    expect(ids(v)).toContain('k4');
    expect(v.hiddenChildren).toEqual({ s: 3 });
    expect(ids(viewOrgGraph(big, { expand: ['r', 's'], limits: { s: 5 } }))).toHaveLength(7);
  });

  it('every focused node is pinned even past the cap', () => {
    const big: OrgGraph = {
      nodes: [
        n('r', 'repo'),
        n('s', 'service', 'r'),
        ...Array.from({ length: 4 }, (_, i) => n(`k${i}`, 'endpoint', 's')),
        n('o', 'service'),
      ],
      edges: [e('o', 'k3')],
    };
    const v = viewOrgGraph(big, { focus: 'o', limits: { s: 1 } });
    expect(ids(v)).toContain('k3');
  });
});
