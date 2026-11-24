// El lienzo contra una instancia real de Cytoscape (jsdom, contexto 2D inerte):
// se inspecciona el grafo vivo por el gancho de desarrollo `__parallaxCy`.

import type { MapViewResponse, OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, render } from '@testing-library/react';
import type { Core, NodeSingular } from 'cytoscape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStyle, MapCanvas, type MapCanvasProps } from './MapCanvas.js';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
});

const pn = (id: string, over: Partial<ProjectedNode> = {}): ProjectedNode => ({
  id,
  label: id,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});
const edge = (
  id: string,
  source: string,
  target: string,
  over: Partial<OrgEdge> = {},
): OrgEdge => ({
  id,
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

type V = Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>;
const view = (over: Partial<V> = {}): V => ({
  nodes: [
    pn('repo:a', { kind: 'repo', childCount: 1, expanded: true }),
    pn('svc:a', { parent: 'repo:a' }),
    pn('svc:b'),
    pn('svc:c'),
  ],
  edges: [
    edge('e1', 'svc:a', 'svc:b'),
    edge('e2', 'svc:b', 'svc:c', { provenance: 'inferred', confidence: 0.5 }),
  ],
  hiddenChildren: {},
  ...over,
});
const cy = () => (window as unknown as { __parallaxCy: Core }).__parallaxCy;

function mount(v: V = view(), over: Partial<MapCanvasProps> = {}) {
  const h = { onSelect: vi.fn(), onToggle: vi.fn() };
  const props: MapCanvasProps = { view: v, selectedId: null, focusIds: null, ...h, ...over };
  const r = render(<MapCanvas {...props} />);
  return {
    ...h,
    props,
    rerender: (next: Partial<MapCanvasProps>) => r.rerender(<MapCanvas {...props} {...next} />),
    r,
  };
}

describe('MapCanvas data', () => {
  it('draws every node and edge, nesting children under their parent, and reports counts', () => {
    const { r } = mount();
    expect(cy().nodes()).toHaveLength(4);
    expect(cy().edges()).toHaveLength(2);
    expect(cy().getElementById('svc:a').parent().first().id()).toBe('repo:a');
    expect(cy().getElementById('svc:b').parent().empty()).toBe(true);
    const host = r.getByTestId('map-canvas');
    expect(host.getAttribute('data-nodes')).toBe('4');
    expect(host.getAttribute('data-edges')).toBe('2');
  });

  it('carries labels, classes and encodings from the elements', () => {
    mount(view({ nodes: [pn('repo:a', { kind: 'repo', childCount: 2 })], edges: [] }));
    const n = cy().getElementById('repo:a');
    expect(n.data('label')).toBe('repo:a  ▸ 2');
    expect(n.hasClass('repo')).toBe(true);
    expect(n.hasClass('collapsible')).toBe(true);
    cleanup();
    mount();
    const e2 = cy().getElementById('e2');
    expect(e2.hasClass('inferred')).toBe(true);
    expect(e2.data('opacity')).toBeCloseTo(0.75);
    expect(cy().getElementById('e1').hasClass('deterministic')).toBe(true);
  });

  it('assigns each leaf a size and a distinct position (our own layout, not the default origin)', () => {
    mount();
    const leaves = cy()
      .nodes()
      .filter((n) => !n.isParent());
    for (const n of leaves.toArray()) {
      expect(n.data('h')).toBeGreaterThan(0);
      expect(n.data('tw')).toBe(n.data('w') - 12);
      // Las hojas-punto (dot) se dibujan con tamaño fijo (18/14/10px); el
      // resto son cajas cuyo tamaño de datos viene del rótulo.
      if (n.hasClass('dot')) expect(['18px', '14px', '10px']).toContain(n.style('width'));
      else expect(n.data('w')).toBeGreaterThanOrEqual(84);
    }
    const spots = new Set(
      leaves.toArray().map((n) => {
        const p = (n as NodeSingular).position();
        return `${Math.round(p.x)},${Math.round(p.y)}`;
      }),
    );
    expect(spots.size).toBe(leaves.length);
  });

  it('with no size to fit into it says the fit is pending instead of failing', () => {
    const { r } = mount();
    expect(r.getByTestId('map-canvas').getAttribute('data-layout')).toBe('pending');
  });

  it('updates incrementally: removes what left, adds what arrived, and keeps the position of what stayed', () => {
    const { rerender } = mount();
    const before = { ...cy().getElementById('svc:b').position() };
    rerender({
      view: view({
        nodes: [
          pn('repo:a', { kind: 'repo', childCount: 1, expanded: true }),
          pn('svc:a', { parent: 'repo:a' }),
          pn('svc:b'),
          pn('svc:new'),
        ],
        edges: [edge('e1', 'svc:a', 'svc:b')],
      }),
    });
    expect(cy().getElementById('svc:c').empty()).toBe(true);
    expect(cy().getElementById('svc:new').nonempty()).toBe(true);
    expect(cy().getElementById('e2').empty()).toBe(true);
    const after = cy().getElementById('svc:b').position();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(150);
  });

  it('refreshes data and classes of an element that stays (a node that opened)', () => {
    const { rerender } = mount(
      view({ nodes: [pn('r', { kind: 'repo', childCount: 1 })], edges: [] }),
    );
    expect(cy().getElementById('r').data('expanded')).toBe(false);
    rerender({
      view: view({ nodes: [pn('r', { kind: 'repo', childCount: 1, expanded: true })], edges: [] }),
    });
    expect(cy().getElementById('r').data('expanded')).toBe(true);
    expect(cy().getElementById('r').hasClass('expanded')).toBe(true);
    expect(cy().getElementById('r').hasClass('collapsible')).toBe(false);
  });

  it('destroys the instance on unmount', () => {
    const { r } = mount();
    const instance = cy();
    r.unmount();
    expect(instance.destroyed()).toBe(true);
  });
});

describe('MapCanvas interaction', () => {
  it('tap only selects (never toggles); double-tap toggles; background tap clears', () => {
    const { onSelect, onToggle } = mount();
    // Un clic sobre cualquier nodo (contenedor o no) sólo selecciona.
    cy().getElementById('repo:a').emit('tap');
    expect(onSelect).toHaveBeenLastCalledWith('repo:a');
    expect(onToggle).not.toHaveBeenCalled();
    cy().getElementById('svc:b').emit('tap');
    expect(onSelect).toHaveBeenLastCalledWith('svc:b');
    expect(onToggle).not.toHaveBeenCalled();
    // El doble clic es el que abre/cierra.
    cy().getElementById('svc:b').emit('dbltap');
    expect(onToggle).toHaveBeenCalledWith('svc:b');
    // Tap en el fondo: limpia la selección.
    cy().emit('tap');
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('once the user has touched the canvas, a view change does not snap existing nodes back', () => {
    const { rerender, props } = mount();
    const n = cy().getElementById('svc:b');
    const before = { ...n.position() };
    // El usuario toca el lienzo (arrastre/zoom) y mueve el nodo de verdad.
    props.view &&
      (document.querySelector('[aria-label="Architecture map"]') as HTMLElement).dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true }) as unknown as PointerEvent,
      );
    n.emit('dragstart');
    n.position({ x: before.x + 120, y: before.y + 80 });
    n.emit('dragfree');
    // Llega una vista nueva (p. ej. se ancla un archivo al seleccionar): los
    // nodos existentes conservan la posición que el usuario les dio.
    rerender({
      view: {
        ...props.view,
        nodes: [...props.view.nodes, pn('svc:d', { parent: 'repo:a' })],
      },
    });
    expect(n.position().x).toBeCloseTo(before.x + 120);
    expect(n.position().y).toBeCloseTo(before.y + 80);
    // El nodo nuevo sí aparece.
    expect(cy().getElementById('svc:d').nonempty()).toBe(true);
  });

  it('a click that barely moves the node (<8px) snaps back instead of dragging', () => {
    mount();
    const n = cy().getElementById('svc:b');
    const before = { ...n.position() };
    n.emit('dragstart');
    n.position({ x: before.x + 3, y: before.y + 2 });
    n.emit('dragfree');
    expect(n.position().x).toBeCloseTo(before.x);
    expect(n.position().y).toBeCloseTo(before.y);
    // Un arrastre de verdad sí se queda.
    n.emit('dragstart');
    n.position({ x: before.x + 60, y: before.y });
    n.emit('dragfree');
    expect(n.position().x).toBeCloseTo(before.x + 60);
  });

  it('always calls the latest handlers', () => {
    const first = mount();
    const next = vi.fn();
    first.rerender({ onSelect: next });
    cy().getElementById('svc:b').emit('tap');
    expect(next).toHaveBeenCalledWith('svc:b');
    expect(first.onSelect).not.toHaveBeenCalled();
  });
});

describe('MapCanvas selection and focus classes', () => {
  const dimmed = () =>
    cy()
      .elements()
      .filter('.dim')
      .map((e) => e.id())
      .sort();

  it('selecting a connected node dims everything that is not its neighbourhood and highlights its edges', () => {
    mount(view(), { selectedId: 'svc:a' });
    expect(cy().getElementById('svc:a').selected()).toBe(true);
    expect(cy().getElementById('e1').hasClass('hl')).toBe(true);
    expect(cy().getElementById('e2').hasClass('hl')).toBe(false);
    expect(dimmed()).toEqual(['e2', 'svc:c']);
    // El padre de lo seleccionado no se atenúa.
    expect(cy().getElementById('repo:a').hasClass('dim')).toBe(false);
  });

  it('selecting a node with no relations dims nothing', () => {
    mount(view({ nodes: [pn('x'), pn('y')], edges: [] }), { selectedId: 'x' });
    expect(cy().getElementById('x').selected()).toBe(true);
    expect(dimmed()).toEqual([]);
  });

  it('an unknown selection is ignored', () => {
    mount(view(), { selectedId: 'ghost' });
    expect(cy().$(':selected')).toHaveLength(0);
    expect(dimmed()).toEqual([]);
  });

  it('changing or clearing the selection removes the old marks', () => {
    const { rerender } = mount(view(), { selectedId: 'svc:a' });
    rerender({ selectedId: 'svc:c' });
    expect(cy().getElementById('svc:a').selected()).toBe(false);
    expect(cy().getElementById('e1').hasClass('hl')).toBe(false);
    expect(cy().getElementById('e2').hasClass('hl')).toBe(true);
    rerender({ selectedId: null });
    expect(dimmed()).toEqual([]);
    expect(cy().$(':selected')).toHaveLength(0);
    expect(cy().elements().filter('.hl')).toHaveLength(0);
  });

  it('focus dims leaves outside the focus, keeps containers, and makes the edges inside it loud', () => {
    mount(view(), { focusIds: new Set(['svc:a', 'svc:b']) });
    expect(dimmed()).toEqual(['e2', 'svc:c']);
    expect(cy().getElementById('e1').hasClass('loud')).toBe(true);
    expect(cy().getElementById('e2').hasClass('loud')).toBe(false);
    expect(cy().getElementById('repo:a').hasClass('dim')).toBe(false);
  });

  it('clearing the focus restores everything', () => {
    const { rerender } = mount(view(), { focusIds: new Set(['svc:a']) });
    rerender({ focusIds: null });
    expect(dimmed()).toEqual([]);
    expect(cy().elements().filter('.loud')).toHaveLength(0);
  });
});

describe('buildStyle', () => {
  const rule = (sel: string) =>
    (
      buildStyle().find((r) => r.selector === sel) as
        | { style?: Record<string, unknown> }
        | undefined
    )?.style;

  it('covers every node kind, both provenances and the states', () => {
    const selectors = buildStyle().map((r) => r.selector);
    for (const s of [
      'node',
      'node.repo',
      'node.service',
      'node.group',
      'node.interfaces',
      'node.endpoint.row',
      'node.code',
      'node.file',
      'node.symbol',
      ':parent',
      'node.collapsible',
      'node:selected',
      'edge',
      'edge.deterministic',
      'edge.inferred',
      '.dim',
      'edge.quiet',
    ]) {
      expect(selectors, s).toContain(s);
    }
  });

  it('reads colours from the theme tokens at call time', () => {
    document.documentElement.style.setProperty('--color-border-strong', '#111111');
    document.documentElement.style.setProperty('--color-repo-fill', '#121212');
    document.documentElement.style.setProperty('--color-service', '#161616');
    document.documentElement.style.setProperty('--color-inferred', '#222222');
    document.documentElement.style.setProperty('--color-deterministic', '#333333');
    expect(rule('node.repo')?.['border-color']).toBe('#111111');
    expect(rule('node.repo')?.['background-color']).toBe('#121212');
    expect(rule('node.service')?.['border-color']).toBe('#161616');
    expect(rule('edge.inferred')?.['line-color']).toBe('#222222');
    expect(rule('edge.deterministic')?.['line-color']).toBe('#333333');
  });

  it('falls back to defaults when a token is missing', () => {
    expect(rule('node.repo')?.['border-color']).toBe('#343b45');
    expect(rule('node.repo')?.['background-color']).toBe('#0f1216');
    expect(rule('node.service')?.['border-color']).toBe('#4f46e5');
    expect(rule('node.service')?.['background-color']).toBe('#141824');
    expect(rule('node.endpoint.row')?.['border-color']).toBe('#343b45');
  });

  it('inferred edges are dashed, deterministic solid; dim/quiet never hide information below readable', () => {
    expect(rule('edge.inferred')?.['line-style']).toBe('dashed');
    expect(rule('edge.deterministic')?.['line-style']).toBe('solid');
    // Nada se apaga por defecto (no hay .muted); el modo foco atenúa a 0.38
    // (legible) y las aristas secundarias a 0.35: presentes, nunca invisibles.
    expect(buildStyle().some((r) => r.selector === '.muted')).toBe(false);
    expect(rule('.dim')?.opacity).toBe(0.38);
    expect(rule('edge.quiet')).toMatchObject({ opacity: 0.35, width: 1 });
    expect(rule('node.collapsible')?.['border-style']).toBe('dashed');
  });

  it('leaf sizes come from data so the layout and the drawing agree', () => {
    for (const k of ['repo', 'service', 'group', 'file', 'symbol']) {
      expect(rule(`node.${k}`)).toMatchObject({ width: 'data(w)', height: 'data(h)' });
    }
    // Las filas de interfaz también toman tamaño del layout.
    expect(rule('node.endpoint.row')).toMatchObject({ width: 'data(w)', height: 'data(h)' });
    // La puerta de código abierta es caja (tamaño del layout); plegada es
    // pastilla fija, no una caja fantasma vacía.
    expect(rule('node.code:parent')).toMatchObject({ width: 'data(w)', height: 'data(h)' });
    expect(rule('node.code:childless')).toMatchObject({ width: 96, height: 26 });
  });
});
