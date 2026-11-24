// Valores exactos del puente datos → elementos del lienzo (etiquetas, trazos,
// clases y datos de cada elemento), para que un cambio de umbral o de formato
// rompa un test y no pase por "decoración".

import type { OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { describe, expect, it } from 'vitest';
import {
  type CyElement,
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
  it('nodes show their label; endpoint rows keep the full contract (the type is part of the name)', () => {
    expect(nodeLabel(node({ id: 's', label: 'orders' }), 0)).toBe('orders');
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'http:GET /a' }), 0)).toBe(
      'HTTP\nGET /a',
    );
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'websocket:/ws' }), 0)).toBe(
      'WEBSOCKET\n/ws',
    );
    expect(nodeLabel(node({ id: 'e', kind: 'endpoint', label: 'plain' }), 0)).toBe('plain');
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
  it('width: 1.4 for one relation, log scale up to 3.5 at 40+ (reference scale)', () => {
    expect(edgeWidth(1)).toBeCloseTo(1.4);
    expect(edgeWidth(0)).toBeCloseTo(1.4);
    expect(edgeWidth(2)).toBeCloseTo(1.79, 1);
    expect(edgeWidth(8)).toBeCloseTo(2.58, 1);
    expect(edgeWidth(40)).toBeCloseTo(3.5);
    expect(edgeWidth(1024)).toBe(3.5);
  });

  it('opacity: deterministic full (1); inferred fixed 0.75 (reference)', () => {
    expect(edgeOpacity({ provenance: 'deterministic', confidence: 0 })).toBe(1);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 0 })).toBe(0.75);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 0.5 })).toBe(0.75);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 1 })).toBe(0.75);
    expect(edgeOpacity({ provenance: 'inferred', confidence: 7 })).toBe(0.75);
    expect(edgeOpacity({ provenance: 'inferred', confidence: -3 })).toBe(0.75);
  });

  it('label: every relation edge shows its count; inferred = "N · confianza"', () => {
    expect(edgeLabel(edge())).toBe('1');
    expect(edgeLabel(edge({ count: 2 }))).toBe('2');
    // Inferido: siempre "N · confianza" (el score es información visible).
    expect(
      edgeLabel(
        edge({
          provenance: 'inferred',
          confidence: 0.6,
          count: 3,
          inferredCount: 3,
          deterministicCount: 0,
        }),
      ),
    ).toBe('3 · 0.6');
    expect(
      edgeLabel(
        edge({
          provenance: 'inferred',
          confidence: 0,
          count: 1,
          inferredCount: 1,
          deterministicCount: 0,
        }),
      ),
    ).toBe('1 · 0.0');
    expect(edgeLabel(edge({ count: 1, inferredCount: 1 }))).toBe('1');
    expect(edgeLabel(edge({ count: 4, inferredCount: 1 }))).toBe('4');
    expect(edgeLabel(edge({ count: 4, inferredCount: 0 }))).toBe('4');
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
    // 'ep' es interfaz del servicio 's': fila dentro de la caja del servicio
    // (parent = service), con clase 'row'.
    expect(nodeData('ep').data).toMatchObject({ label: 'HTTP\nGET /x', contract: 'http' });
    expect(nodeData('ep').data.parent).toBe('s');
    expect(nodeData('leaf').data.contract).toBeUndefined();
    expect(nodeData('leaf').data.collapsible).toBe(false);
  });

  it('node classes: kind, plus expanded / collapsible / row / dot when they apply', () => {
    expect(nodeData('r').classes).toBe('repo expanded');
    // 's' contiene a su endpoint en el lienzo: es caja, no punto.
    expect(nodeData('s').classes).toBe('service collapsible');
    // Un servicio suelto (sin hijos en el lienzo) ya no es punto: es caja compacta.
    expect(nodeData('leaf').classes).toBe('service');
    expect(nodeData('ep').classes).toContain('endpoint');
    expect(nodeData('ep').classes).toContain('row');
  });

  it('every visible endpoint is a row inside its service box, even with no edges', () => {
    const quiet: typeof view = { ...view, edges: [] };
    const findNode = (els: CyElement[], id: string) =>
      els.find((x) => x.group === 'nodes' && x.data.id === id) as {
        data: CyNodeData;
        classes: string;
      };
    const ep = findNode(toCyElements(quiet), 'ep');
    expect(ep.data.parent).toBe('s');
    expect(ep.classes).toContain('row');
  });

  it('no synthetic port→service edge: containment already expresses the relation', () => {
    for (const opts of [{}, { selectedId: 'ep' }, { focusIds: new Set(['ep']) }]) {
      const els = toCyElements({ ...view, edges: [] }, opts);
      expect(els.some((x) => x.group === 'edges' && x.data.id.startsWith('servedby:'))).toBe(false);
    }
  });

  it('the Interfaces box is dropped and services hang directly from the repo box', () => {
    const v: typeof view = {
      nodes: [
        node({ id: 'r', kind: 'repo', label: 'repo', childCount: 1, expanded: true }),
        node({
          id: 'interfaces:r',
          kind: 'group',
          label: 'Interfaces',
          parent: 'r',
          meta: { role: 'interfaces' },
          childCount: 1,
          expanded: true,
        }),
        node({ id: 's', parent: 'interfaces:r', label: 'svc', childCount: 1 }),
        node({
          id: 'grp:s:http',
          kind: 'group',
          label: 'HTTP routes',
          parent: 's',
          meta: { group: 'http' },
          childCount: 1,
          expanded: true,
        }),
        node({
          id: 'ep',
          kind: 'endpoint',
          parent: 'grp:s:http',
          label: 'http:GET /x',
          contract: 'http',
        }),
      ],
      edges: [],
      hiddenChildren: { r: 0 },
    };
    const els = toCyElements(v);
    const ids = els.filter((x) => x.group === 'nodes').map((x) => x.data.id);
    expect(ids).toContain('r');
    expect(ids).toContain('s');
    expect(ids).toContain('ep');
    expect(ids).not.toContain('interfaces:r');
    expect(ids).not.toContain('grp:s:http'); // grupo vacío (su endpoint es puerto): fuera
    const svc = els.find((x) => x.group === 'nodes' && x.data.id === 's');
    const ep = els.find((x) => x.group === 'nodes' && x.data.id === 'ep');
    expect(svc && 'parent' in svc.data ? svc.data.parent : undefined).toBe('r');
    // El endpoint cuelga de su servicio (contención), no de la caja del repo.
    expect(ep && 'parent' in ep.data ? ep.data.parent : undefined).toBe('s');
  });

  it('a group with visible edges is NOT drawn: the edge is retargeted to the provider service', () => {
    const v: typeof view = {
      nodes: [
        node({ id: 'r', kind: 'repo', label: 'repo', childCount: 1, expanded: true }),
        node({ id: 's', parent: 'r', label: 'svc' }),
        node({
          id: 'grp:s:http',
          kind: 'group',
          label: 'HTTP routes',
          parent: 's',
          meta: { group: 'http' },
          childCount: 20,
          expanded: true,
        }),
        node({
          id: 'ep',
          kind: 'endpoint',
          parent: 'grp:s:http',
          label: 'http:GET /x',
          contract: 'http',
        }),
        node({ id: 'other', parent: 'r', label: 'other' }),
      ],
      edges: [edge({ id: 'e1', source: 'other', target: 'grp:s:http', count: 5 })],
      hiddenChildren: { r: 0 },
    };
    const els = toCyElements(v);
    const ids = els.filter((x) => x.group === 'nodes').map((x) => x.data.id);
    expect(ids).not.toContain('grp:s:http'); // la caja de puro título desaparece
    expect(ids).toContain('ep'); // el endpoint sigue como fila dentro del servicio
    const e1 = els.find((x) => x.group === 'edges' && x.data.id === 'e1');
    expect(e1 && e1.group === 'edges' ? e1.data.target : undefined).toBe('s'); // arista → servicio
  });

  it('nothing is ever muted: with cross-repo edges the whole graph stays visible and provenance lives on the edges', () => {
    const v: typeof view = {
      nodes: [
        node({ id: 'repo:a', kind: 'repo', label: 'a', childCount: 1, expanded: true }),
        node({ id: 'svc:a', parent: 'repo:a', label: 'svc-a', childCount: 0 }),
        node({ id: 'repo:b', kind: 'repo', label: 'b', childCount: 1, expanded: true }),
        node({ id: 'svc:b', parent: 'repo:b', label: 'svc-b', childCount: 1 }),
        node({
          id: 'ep:b',
          kind: 'endpoint',
          parent: 'svc:b',
          label: 'http:GET /x',
          contract: 'http',
        }),
      ],
      edges: [
        edge({
          id: 'e1',
          source: 'svc:a',
          target: 'ep:b',
          kind: 'consumes',
          provenance: 'inferred',
          confidence: 0.6,
          count: 2,
          inferredCount: 2,
          deterministicCount: 0,
        }),
      ],
      hiddenChildren: { r: 0 },
    };
    const els = toCyElements(v);
    for (const x of els) {
      if (x.group === 'nodes') expect(x.classes).not.toContain('muted');
    }
    // La arista llega a la FILA proveedora visible (referencia Contracts lens) y
    // conserva procedencia y rótulo.
    const e1 = els.find((x) => x.group === 'edges' && x.data.id === 'e1');
    expect(e1 && e1.group === 'edges' ? e1.data.source : undefined).toBe('svc:a');
    expect(e1 && e1.group === 'edges' ? e1.data.target : undefined).toBe('ep:b');
    expect(e1 && e1.group === 'edges' ? e1.data.label : undefined).toBe('2 · 0.6');
    expect(e1?.classes).toContain('inferred');
  });

  it('when the relation target is a dropped group (fanout cap), the edge climbs to the provider service box', () => {
    const v: typeof view = {
      nodes: [
        node({ id: 'repo:a', kind: 'repo', label: 'a', childCount: 1, expanded: true }),
        node({ id: 'svc:a', parent: 'repo:a', label: 'svc-a', childCount: 0 }),
        node({ id: 'repo:b', kind: 'repo', label: 'b', childCount: 1, expanded: true }),
        node({ id: 'svc:b', parent: 'repo:b', label: 'svc-b', childCount: 1, expanded: true }),
        // El grupo de contratos queda fuera del lienzo (caja de título): la arista sube al servicio.
        node({
          id: 'grp:b:http',
          kind: 'group',
          parent: 'svc:b',
          label: 'HTTP routes',
          childCount: 18,
        }),
      ],
      edges: [
        edge({
          id: 'e1',
          source: 'svc:a',
          target: 'grp:b:http',
          kind: 'consumes',
          provenance: 'inferred',
          confidence: 0.6,
          count: 2,
          inferredCount: 2,
          deterministicCount: 0,
        }),
      ],
      hiddenChildren: { r: 0 },
    };
    const els = toCyElements(v);
    const e1 = els.find((x) => x.group === 'edges' && x.data.id === 'e1');
    expect(e1 && e1.group === 'edges' ? e1.data.target : undefined).toBe('svc:b');
  });

  it('without cross-repo edges nothing is muted either (single-repo view)', () => {
    const els = toCyElements(view);
    for (const x of els) {
      if (x.group === 'nodes') expect(x.classes).not.toContain('muted');
    }
  });

  it('the hidden count only applies to the node it is keyed by', () => {
    const li = layoutInput({ ...view, hiddenChildren: { s: 2 } });
    expect(li.nodes.find((x) => x.id === 'r')?.label).toBe('repo');
  });
});
