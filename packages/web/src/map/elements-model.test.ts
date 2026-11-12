// Valores exactos del puente datos → elementos del lienzo (etiquetas, trazos,
// clases y datos de cada elemento), para que un cambio de umbral o de formato
// rompa un test y no pase por "decoración".

import type { OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { describe, expect, it } from 'vitest';
import {
  type CyEdgeData,
  type CyNodeData,
  edgeLabel,
  edgeOpacity,
  edgeWidth,
  LOUD_PER_NODE,
  layoutInput,
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

describe('nodeLabel — every state', () => {
  it('plain nodes show their label; endpoints lose a short contract prefix only', () => {
    expect(nodeLabel(node({ id: 's', label: 'orders' }), 0)).toBe('orders');
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'http:GET /a' }), 0)).toBe('GET /a');
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'websocket:/ws' }), 0)).toBe('/ws');
    // 10 o más caracteres antes de ':' no es un prefijo de contrato.
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'abcdefghij:rest' }), 0)).toBe(
      'abcdefghij:rest',
    );
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'abcdefghi:rest' }), 0)).toBe('rest');
    // Sin ':' o con ':' al inicio no hay prefijo; y sólo los endpoints se recortan.
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'plain' }), 0)).toBe('plain');
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: ':x' }), 0)).toBe(':x');
    expect(nodeLabel(node({ id: 's', label: 'a:b' }), 0)).toBe('a:b');
  });

  it('loading wins over everything else', () => {
    expect(nodeLabel(node({ id: 'x', label: 'f', lazy: true, meta: { loading: true } }), 0)).toBe(
      'f  …',
    );
    expect(
      nodeLabel(node({ id: 'x', label: 'f', childCount: 3, meta: { loading: true } }), 0),
    ).toBe('f  …');
    // `loading: false` no es cargando.
    expect(nodeLabel(node({ id: 'x', label: 'f', meta: { loading: false } }), 0)).toBe('f');
  });

  it('lazy code nodes show an opener without a count; open ones show the bare label', () => {
    expect(nodeLabel(node({ id: 'x', label: 'f', lazy: true }), 0)).toBe('f  ▸');
    expect(nodeLabel(node({ id: 'x', label: 'f', lazy: true, expanded: true }), 5)).toBe('f');
  });

  it('analysed nodes show the child count closed, and the hidden count only when open and > 0', () => {
    expect(nodeLabel(node({ id: 'x', label: 'f', childCount: 12 }), 0)).toBe('f  ▸ 12');
    expect(nodeLabel(node({ id: 'x', label: 'f', childCount: 12, expanded: true }), 0)).toBe('f');
    expect(nodeLabel(node({ id: 'x', label: 'f', childCount: 12, expanded: true }), 1)).toBe(
      'f  (+1)',
    );
    expect(nodeLabel(node({ id: 'x', label: 'f', childCount: 12, expanded: false }), 7)).toBe(
      'f  ▸ 12',
    );
  });
});

describe('edge encodings — exact values', () => {
  it('width: 1 for one relation, +0.35 per doubling, capped at 2.6', () => {
    expect(edgeWidth(1)).toBeCloseTo(1);
    expect(edgeWidth(0)).toBeCloseTo(1);
    expect(edgeWidth(2)).toBeCloseTo(1.35);
    expect(edgeWidth(8)).toBeCloseTo(2.05);
    expect(edgeWidth(1024)).toBe(2.6);
  });

  it('opacity: deterministic 0.9; inferred 0.35 + 0.55·confidence, clamped to [0,1]', () => {
    expect(edgeOpacity({ provenance: 'deterministic', confidence: 0 })).toBe(0.9);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 0 })).toBeCloseTo(0.35);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 0.5 })).toBeCloseTo(0.625);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 1 })).toBeCloseTo(0.9);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 7 })).toBeCloseTo(0.9);
    expect(edgeOpacity({ provenance: 'inferred', confidence: -3 })).toBeCloseTo(0.35);
  });

  it('label: empty for a single clean relation; ×N for aggregates; ×N (k~) for mixed', () => {
    expect(edgeLabel(edge())).toBe('');
    expect(edgeLabel(edge({ count: 2 }))).toBe('×2');
    expect(
      edgeLabel(
        edge({ provenance: 'inferred', count: 3, inferredCount: 3, deterministicCount: 0 }),
      ),
    ).toBe('×3');
    expect(
      edgeLabel(
        edge({ provenance: 'inferred', count: 1, inferredCount: 1, deterministicCount: 0 }),
      ),
    ).toBe('');
    // Una arista mixta de un solo uso visible sigue diciendo que hay inferencia.
    expect(edgeLabel(edge({ count: 1, inferredCount: 1 }))).toBe('×1 (1~)');
    expect(edgeLabel(edge({ count: 4, inferredCount: 1 }))).toBe('×4 (1~)');
    expect(edgeLabel(edge({ count: 4, inferredCount: 0 }))).toBe('×4');
  });
});

describe('quietEdgeIds — thresholds', () => {
  const mesh = (n: number): OrgEdge[] => {
    const out: OrgEdge[] = [];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
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
  it('does nothing at the threshold and starts one edge above it', () => {
    const all = mesh(10);
    expect(quietEdgeIds(all.slice(0, QUIET_THRESHOLD)).size).toBe(0);
    expect(quietEdgeIds(all.slice(0, QUIET_THRESHOLD + 1)).size).toBeGreaterThan(0);
  });
  it('ranks by count, then confidence, then id; LOUD_PER_NODE is 2', () => {
    expect(LOUD_PER_NODE).toBe(2);
    // Un hub con 45 relaciones salientes: las dos de más peso quedan a la vista.
    const hub: OrgEdge[] = Array.from({ length: 45 }, (_, i) =>
      edge({
        id: `h${String(i).padStart(2, '0')}`,
        source: 'hub',
        target: `t${i}`,
        count: i === 7 ? 9 : i === 3 ? 8 : 1,
        confidence: i === 20 ? 0.9 : 0.5,
      }),
    );
    const quiet = quietEdgeIds(hub);
    // Cada hoja conserva su única arista, así que el hub sólo "decide" por las suyas.
    expect(quiet.size).toBe(0);
    const twoHubs: OrgEdge[] = [
      ...hub,
      ...hub.map((h) => ({ ...h, id: `x${h.id}`, source: 'hub2', target: h.target })),
    ];
    const q = quietEdgeIds(twoHubs);
    expect(q.has('h07')).toBe(false);
    expect(q.has('h03')).toBe(false);
  });
});

describe('toCyElements / layoutInput — data fields', () => {
  const view = {
    nodes: [
      node({ id: 'r', kind: 'repo', label: 'repo', childCount: 2, expanded: true }),
      node({ id: 's', parent: 'r', label: 'svc', childCount: 1 }),
      node({ id: 'ep', kind: 'endpoint', parent: 's', label: 'http:GET /x', contract: 'http' }),
      node({ id: 'leaf', parent: 'r', label: 'leaf' }),
    ],
    edges: [
      edge({
        id: 'ed',
        source: 'leaf',
        target: 'ep',
        provenance: 'inferred',
        confidence: 0.5,
        count: 3,
        inferredCount: 3,
        deterministicCount: 0,
      }),
    ],
    hiddenChildren: { r: 4 },
  };
  const els = toCyElements(view);
  const nodeData = (id: string) =>
    els.find((x) => x.group === 'nodes' && x.data.id === id) as {
      data: CyNodeData;
      classes: string;
    };
  const edgeEl = els.find((x) => x.group === 'edges') as { data: CyEdgeData; classes: string };

  it('node data carries label, kind, counts and the parent only when it is in the view', () => {
    expect(nodeData('r').data).toMatchObject({
      id: 'r',
      label: 'repo  (+4)',
      kind: 'repo',
      childCount: 2,
      expanded: true,
      collapsible: false,
    });
    expect(nodeData('r').data.parent).toBeUndefined();
    expect(nodeData('s').data).toMatchObject({
      parent: 'r',
      label: 'svc  ▸ 1',
      collapsible: true,
      expanded: false,
    });
    expect(nodeData('ep').data).toMatchObject({ label: 'GET /x', contract: 'http', parent: 's' });
    expect(nodeData('leaf').data.contract).toBeUndefined();
    expect(nodeData('leaf').data.collapsible).toBe(false);
  });

  it('node classes: kind, plus expanded / collapsible when they apply', () => {
    expect(nodeData('r').classes).toBe('repo expanded');
    expect(nodeData('s').classes).toBe('service collapsible');
    expect(nodeData('leaf').classes).toBe('service');
  });

  it('edge data: label, provenance, confidence, count, width, opacity, mixed', () => {
    expect(edgeEl.data).toMatchObject({
      id: 'ed',
      source: 'leaf',
      target: 'ep',
      label: '×3',
      provenance: 'inferred',
      confidence: 0.5,
      count: 3,
      mixed: false,
    });
    expect(edgeEl.data.width).toBeCloseTo(edgeWidth(3));
    expect(edgeEl.data.opacity).toBeCloseTo(0.625);
    expect(edgeEl.classes).toBe('inferred');
    const mixed = toCyElements({
      ...view,
      edges: [
        edge({
          id: 'm',
          source: 'leaf',
          target: 'ep',
          count: 3,
          inferredCount: 1,
          deterministicCount: 2,
        }),
      ],
    });
    expect((mixed.find((x) => x.group === 'edges') as { data: CyEdgeData }).data.mixed).toBe(true);
    const clean = toCyElements({
      ...view,
      edges: [edge({ id: 'm', source: 'leaf', target: 'ep' })],
    });
    expect((clean.find((x) => x.group === 'edges') as { data: CyEdgeData }).data.mixed).toBe(false);
  });

  it('drops an edge when either end is not drawn', () => {
    const only = toCyElements({
      ...view,
      edges: [
        edge({ id: 'a', source: 'leaf', target: 'ghost' }),
        edge({ id: 'b', source: 'ghost', target: 'leaf' }),
      ],
    });
    expect(only.filter((x) => x.group === 'edges')).toEqual([]);
  });

  it('quiets edges of a dense view: the class is added and the provenance class kept', () => {
    const dense = {
      nodes: Array.from({ length: 10 }, (_, i) => node({ id: `n${i}` })),
      edges: (() => {
        const out: OrgEdge[] = [];
        for (let a = 0; a < 10; a++)
          for (let b = 0; b < 10; b++)
            if (a !== b)
              out.push(
                edge({
                  id: `e${a}-${b}`,
                  source: `n${a}`,
                  target: `n${b}`,
                  count: ((a * 7 + b * 3) % 9) + 1,
                }),
              );
        return out;
      })(),
      hiddenChildren: {},
    };
    const classes = toCyElements(dense)
      .filter((x) => x.group === 'edges')
      .map((x) => x.classes);
    expect(classes.some((c) => c === 'deterministic quiet')).toBe(true);
    expect(classes.some((c) => c === 'deterministic')).toBe(true);
  });

  it('layoutInput mirrors nodes (with their final label) and weights edges by count', () => {
    const li = layoutInput(view);
    expect(li.nodes.find((x) => x.id === 'r')).toEqual({
      id: 'r',
      parent: null,
      kind: 'repo',
      label: 'repo  (+4)',
    });
    expect(li.nodes.find((x) => x.id === 's')).toEqual({
      id: 's',
      parent: 'r',
      kind: 'service',
      label: 'svc  ▸ 1',
    });
    expect(li.edges).toEqual([{ source: 'leaf', target: 'ep', weight: 3 }]);
  });

  it('the hidden count only applies to the node it is keyed by', () => {
    const li = layoutInput({ ...view, hiddenChildren: { s: 2 } });
    expect(li.nodes.find((x) => x.id === 'r')?.label).toBe('repo');
  });
});
