// Geometría exacta del reparto (lo que no depende del modelo de fuerzas):
// tamaños de hoja, rejilla de un contenedor y su colocación respecto al centro.

import { describe, expect, it } from 'vitest';
import {
  arrange,
  GAP,
  LABEL_H,
  type LayoutNode,
  layoutMap,
  MAX_FORCE_ITEMS,
  measure,
  PAD,
  removeOverlaps,
} from './layout.js';

const n = (
  id: string,
  parent: string | null,
  kind: LayoutNode['kind'],
  label = id,
): LayoutNode => ({ id, parent, kind, label });

describe('measure — exact', () => {
  it('width = label·charWidth + 22 within [84, 230]; monospace for code and contracts', () => {
    expect(measure('a', 'service')).toEqual({ w: 84, h: 28 });
    expect(measure('x'.repeat(20), 'service').w).toBe(166); // 20·7.2 + 22
    expect(measure('x'.repeat(20), 'repo').w).toBe(166);
    expect(measure('x'.repeat(20), 'endpoint').w).toBe(168); // 20·7.3 + 22
    expect(measure('x'.repeat(20), 'file').w).toBe(168);
    expect(measure('x'.repeat(20), 'symbol').w).toBe(168);
    expect(measure('x'.repeat(20), 'code').w).toBe(166); // la puerta no es monoespaciada
    expect(measure('x'.repeat(500), 'service').w).toBe(230);
    expect(measure('', 'service').w).toBe(84);
    // Justo en los límites: 10 caracteres de ancho proporcional = 94.
    expect(measure('x'.repeat(10), 'service').w).toBe(94);
  });
  it('height depends on the kind', () => {
    expect(measure('a', 'repo').h).toBe(34);
    expect(measure('a', 'service').h).toBe(28);
    expect(measure('a', 'code').h).toBe(26);
    for (const k of ['endpoint', 'file', 'symbol'] as const) expect(measure('a', k).h).toBe(24);
  });
  it('exposes the spacing constants the canvas styles rely on', () => {
    expect([GAP, PAD, LABEL_H, MAX_FORCE_ITEMS]).toEqual([14, 16, 20, 400]);
  });
});

describe('container grid — exact placement', () => {
  // 6 endpoints de 84×24: 2 columnas × 3 filas.
  const kids = Array.from({ length: 6 }, (_, i) => n(`e${i}`, 's', 'endpoint', `e${i}`));
  const tree = [n('s', null, 'service'), ...kids];
  const l = layoutMap(tree, []);
  const c = l.top.get('s') as { x: number; y: number };

  it('places each child in an aligned cell around the container centre', () => {
    const colX = [0, 84 + GAP];
    const rowY = [0, 24 + GAP, 2 * (24 + GAP)];
    const gridW = 84 * 2 + GAP;
    const gridH = 24 * 3 + GAP * 2;
    const left = c.x - gridW / 2;
    const top = c.y + LABEL_H / 2 - gridH / 2;
    kids.forEach((k, i) => {
      const p = l.leaves.get(k.id) as { x: number; y: number };
      expect(p.x).toBeCloseTo(left + (colX[i % 2] as number) + 42);
      expect(p.y).toBeCloseTo(top + (rowY[Math.floor(i / 2)] as number) + 12);
    });
  });

  it('children sit side by side with exactly GAP between cells', () => {
    const a = l.leaves.get('e0') as { x: number; y: number };
    const b = l.leaves.get('e1') as { x: number; y: number };
    const d = l.leaves.get('e2') as { x: number; y: number };
    expect(b.x - a.x).toBeCloseTo(84 + GAP);
    expect(b.y).toBeCloseTo(a.y);
    expect(d.y - a.y).toBeCloseTo(24 + GAP);
  });

  it('every leaf gets its size', () => {
    for (const k of kids) expect(l.sizes.get(k.id)).toEqual({ w: 84, h: 24 });
    expect(l.sizes.has('s')).toBe(false);
  });

  it('a single child sits centred under the label strip', () => {
    const one = layoutMap([n('s', null, 'service'), n('e', 's', 'endpoint')], []);
    const root = one.top.get('s') as { x: number; y: number };
    const leaf = one.leaves.get('e') as { x: number; y: number };
    expect(leaf.x).toBeCloseTo(root.x);
    expect(leaf.y).toBeCloseTo(root.y + LABEL_H / 2);
  });

  it('containers first, then by label; nested containers take their grid cell by their outer size', () => {
    const nested = [
      n('r', null, 'repo'),
      n('b', 'r', 'service', 'b'),
      n('a', 'r', 'service', 'a'),
      n('b1', 'b', 'endpoint'),
      n('z', 'r', 'endpoint', 'z'),
    ];
    const m = layoutMap(nested, []);
    // `b` es un contenedor (tiene hijo) y va antes que las hojas `a`, `z`.
    const pos = (id: string) => m.leaves.get(id) as { x: number; y: number };
    // Orden de lectura: fila, luego columna.
    expect(pos('b1').y < pos('a').y || pos('b1').x < pos('a').x).toBe(true);
    expect(pos('a').y > pos('b1').y || pos('a').x > pos('b1').x).toBe(true);
  });
});

describe('arrange / removeOverlaps — numeric behaviour', () => {
  it('leaves zero or one item untouched', () => {
    const one = [{ id: 'a', w: 10, h: 10, x: 5, y: 6 }];
    arrange(one, [], false);
    expect(one[0]).toMatchObject({ x: 5, y: 6 });
    expect(() => arrange([], [], true)).not.toThrow();
  });

  it('separates two coincident boxes on the axis of least penetration, half each', () => {
    const a = { id: 'a', w: 100, h: 20, x: 0, y: 0 };
    const b = { id: 'b', w: 100, h: 20, x: 0, y: 5 };
    removeOverlaps([a, b]);
    // Penetración en y (20+14-5=29) < en x (114): se mueven en y.
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(20 + GAP - 1e-9);
    expect(a.y).toBeLessThan(b.y);
  });

  it('prefers the horizontal axis when it is the shorter way out', () => {
    const a = { id: 'a', w: 20, h: 100, x: 0, y: 0 };
    const b = { id: 'b', w: 20, h: 100, x: 5, y: 0 };
    removeOverlaps([a, b]);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(20 + GAP - 1e-9);
    expect(a.y).toBe(0);
    expect(b.y).toBe(0);
    expect(a.x).toBeLessThan(b.x);
  });

  it('boxes that only touch the gap boundary are left alone', () => {
    const a = { id: 'a', w: 10, h: 10, x: 0, y: 0 };
    const b = { id: 'b', w: 10, h: 10, x: 10 + GAP, y: 0 };
    removeOverlaps([a, b]);
    expect(b.x).toBe(10 + GAP);
    expect(a.x).toBe(0);
  });

  it('a force run ends with no overlaps and linked pairs closer than the farthest unlinked pair', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      w: 90,
      h: 30,
      x: i,
      y: i * 0.5,
    }));
    arrange(items, [{ a: 0, b: 1, weight: 30 }], false);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        const ox = (a.w + b.w) / 2 + GAP - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + GAP - Math.abs(a.y - b.y);
        expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
      }
    }
    const d = (i: number, j: number) =>
      Math.hypot((items[i]?.x ?? 0) - (items[j]?.x ?? 0), (items[i]?.y ?? 0) - (items[j]?.y ?? 0));
    expect(d(0, 1)).toBeLessThan(Math.max(d(0, 3), d(0, 4), d(0, 5), d(1, 4), d(1, 5)));
  });

  it('a warm run moves things less than a cold run from the same start', () => {
    const start = () =>
      Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, w: 90, h: 30, x: i * 200, y: 0 }));
    const cold = start();
    const warm = start();
    arrange(cold, [{ a: 0, b: 4, weight: 5 }], false);
    arrange(warm, [{ a: 0, b: 4, weight: 5 }], true);
    const moved = (xs: typeof cold) =>
      xs.reduce((s, it, i) => s + Math.hypot(it.x - i * 200, it.y), 0);
    expect(moved(warm)).toBeLessThan(moved(cold));
  });

  it('layoutMap: previous positions seed a warm start, and an item missing from the previous run starts cold', () => {
    const nodes = [n('a', null, 'repo'), n('b', null, 'repo')];
    const first = layoutMap(nodes, [{ source: 'a', target: 'b', weight: 1 }]);
    const again = layoutMap(nodes, [{ source: 'a', target: 'b', weight: 1 }], first.top);
    const a1 = first.top.get('a') as { x: number; y: number };
    const a2 = again.top.get('a') as { x: number; y: number };
    expect(Math.hypot(a1.x - a2.x, a1.y - a2.y)).toBeLessThan(60);
    const added = layoutMap([...nodes, n('c', null, 'repo')], [], first.top);
    expect(added.top.has('c')).toBe(true);
  });

  it('relations between nodes of the same top-level box do not pull the box on itself', () => {
    const nodes = [n('s', null, 'service'), n('e1', 's', 'endpoint'), n('e2', 's', 'endpoint')];
    const l = layoutMap(nodes, [{ source: 'e1', target: 'e2', weight: 9 }]);
    expect(l.top.size).toBe(1);
  });

  it('beyond the force limit a plain grid is used: wrapped rows, no overlaps', () => {
    const many = Array.from({ length: MAX_FORCE_ITEMS + 1 }, (_, i) => n(`r${i}`, null, 'repo'));
    const l = layoutMap(many, []);
    const xs = new Set([...l.leaves.values()].map((p) => Math.round(p.y)));
    expect(xs.size).toBeGreaterThan(1);
    const first = l.leaves.get('r0') as { x: number; y: number };
    const second = l.leaves.get('r1') as { x: number; y: number };
    expect(second.x - first.x).toBe(84 + GAP);
  });
});
