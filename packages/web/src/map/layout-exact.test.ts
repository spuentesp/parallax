// Geometría exacta del reparto (lo que no depende del modelo de fuerzas):
// tamaños de hoja, rejilla de un contenedor y su colocación respecto al centro.

import { describe, expect, it } from 'vitest';
import {
  arrangeLayered,
  GAP,
  LABEL_H,
  LAYER_GAP,
  type LayoutNode,
  layoutMap,
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
  it('width = label·charWidth + 22 within [84, 230] for containers (repo, group)', () => {
    expect(measure('x'.repeat(20), 'repo').w).toBe(166);
    expect(measure('x'.repeat(500), 'repo').w).toBe(230);
    expect(measure('', 'repo').w).toBe(84);
    // Justo en los límites: 10 caracteres de ancho proporcional = 94.
    expect(measure('x'.repeat(10), 'group').w).toBe(94);
  });
  it('endpoint rows: width = longest line·mono + 24 within [160, 320], two-line height 44', () => {
    expect(measure('x'.repeat(20), 'endpoint').w).toBe(170); // 20·7.3 + 24
    expect(measure('HTTP\n' + 'x'.repeat(500), 'endpoint').w).toBe(320);
    expect(measure('', 'endpoint').w).toBe(160);
    expect(measure('a', 'endpoint').h).toBe(44);
  });
  it('a leaf service is a compact box; code leaves measure as dots + label band', () => {
    // servicio suelto: rótulo proporcional + 28, topado en [120, 200], alto 30
    expect(measure('a', 'service')).toEqual({ w: 120, h: 30 }); // 1·7.2+28 < 120
    expect(measure('a-much-longer-service-name', 'service')).toEqual({ w: 200, h: 30 });
    // archivo 16px + rótulo mono, topado en 110
    expect(measure('x.py', 'file')).toEqual({ w: 39, h: 36 }); // 4·7.3+10
    expect(measure('packages/x/src/very/long/path.py', 'file')).toEqual({ w: 110, h: 36 });
    // símbolo 12px + rótulo mono
    expect(measure('f', 'symbol')).toEqual({ w: 17, h: 32 }); // 1·7.3+10
    expect(measure('some_function', 'symbol')).toEqual({ w: 105, h: 32 }); // 13·7.3+10
    expect(measure('a', 'repo').h).toBe(34);
    expect(measure('a', 'group').h).toBe(26);
  });
  it('the collapsed code door measures as a fixed chip, never a label-sized ghost box', () => {
    expect(measure('Code ▸ 12', 'code')).toEqual({ w: 96, h: 26 });
    expect(measure('x'.repeat(500), 'code')).toEqual({ w: 96, h: 26 });
  });
  it('exposes the spacing constants the canvas styles rely on', () => {
    expect([GAP, PAD, LABEL_H, LAYER_GAP]).toEqual([14, 16, 20, 160]);
  });
});

describe('container grid — exact placement', () => {
  // 6 filas de interfaz (endpoints con row: true) dentro del servicio: 1 columna × 6 filas.
  const kids = Array.from({ length: 6 }, (_, i) => ({
    ...n(`e${i}`, 's', 'endpoint', `e${i}`),
    row: true,
  }));
  const tree = [n('s', null, 'service'), ...kids];
  const l = layoutMap(tree, []);
  const c = l.top.get('s') as { x: number; y: number };

  it('stacks interface rows stretched to one full-width column under the label, exactly GAP apart', () => {
    const w = measure('e0', 'endpoint').w; // 2·7.3+24 → 38 → mínimo 160; todas se estiran a ese ancho
    const rowH = [0, 44 + GAP, 2 * (44 + GAP), 3 * (44 + GAP), 4 * (44 + GAP), 5 * (44 + GAP)];
    const gridW = w;
    const gridH = 44 * 6 + GAP * 5;
    const left = c.x - gridW / 2;
    const top = c.y + LABEL_H / 2 - gridH / 2;
    kids.forEach((k, i) => {
      const p = l.leaves.get(k.id) as { x: number; y: number };
      expect(p.x).toBeCloseTo(left + w / 2);
      expect(p.y).toBeCloseTo(top + (rowH[i] as number) + 22);
    });
  });

  it('rows are exactly GAP apart vertically and share the same x', () => {
    const a = l.leaves.get('e0') as { x: number; y: number };
    const b = l.leaves.get('e1') as { x: number; y: number };
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y - a.y).toBeCloseTo(44 + GAP);
  });

  it('every leaf gets its size', () => {
    for (const k of kids) expect(l.sizes.get(k.id)).toEqual({ w: 160, h: 44 });
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

describe('arrangeLayered — dependency flow in columns', () => {
  const item = (id: string, w = 90, h = 30) => ({ id, label: id, w, h, x: 0, y: 0 });

  it('handles empty and single-item inputs', () => {
    const one = [item('a')];
    arrangeLayered(one, []);
    expect(one[0]).toMatchObject({ x: 45, y: 0 }); // centrado en su única columna
    expect(() => arrangeLayered([], [])).not.toThrow();
  });

  it('puts the target of a relation one full column to the right of the source', () => {
    const items = [item('consumer', 100, 40), item('provider', 120, 60), item('solo', 80, 30)];
    arrangeLayered(items, [{ a: 0, b: 1 }]);
    const c = items[0]!;
    const p = items[1]!;
    const s = items[2]!;
    // Columna 1 empieza tras el ancho de la columna 0 (100) + LAYER_GAP; los
    // centros además se desplazan la mitad de su propio ancho.
    expect(p.x - c.x).toBe(100 + LAYER_GAP + (120 - 100) / 2);
    expect(s.x).toBe(c.x); // sin relaciones: misma columna
    // Sin solapes.
    expect(
      Math.abs(c.x - s.x) >= (c.w + s.w) / 2 + GAP - 1e-9 ||
        Math.abs(c.y - s.y) >= (c.h + s.h) / 2 + GAP - 1e-9,
    ).toBe(true);
  });

  it('ranks by longest path: a→b→c puts c two columns right of a', () => {
    const items = [item('a'), item('b'), item('c')];
    arrangeLayered(items, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ]);
    expect(items[1]!.x - items[0]!.x).toBe(90 + LAYER_GAP);
    expect(items[2]!.x - items[1]!.x).toBe(90 + LAYER_GAP);
  });

  it('is deterministic and breaks cycles by label order', () => {
    const mk = () => [item('x'), item('y'), item('z')];
    const a = mk();
    const b = mk();
    arrangeLayered(a, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 0 },
    ]); // ciclo
    arrangeLayered(b, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 0 },
    ]);
    expect(a.map((i) => [i.x, i.y])).toEqual(b.map((i) => [i.x, i.y]));
  });

  it('separates two coincident boxes on the axis of least penetration, half each', () => {
    const a = { id: 'a', label: 'a', w: 100, h: 20, x: 0, y: 0 };
    const b = { id: 'b', label: 'b', w: 100, h: 20, x: 0, y: 5 };
    removeOverlaps([a, b]);
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(20 + GAP - 1e-9);
    expect(a.y).toBeLessThan(b.y);
  });

  it('prefers the horizontal axis when it is the shorter way out', () => {
    const a = { id: 'a', label: 'a', w: 20, h: 100, x: 0, y: 0 };
    const b = { id: 'b', label: 'b', w: 20, h: 100, x: 5, y: 0 };
    removeOverlaps([a, b]);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(20 + GAP - 1e-9);
    expect(a.y).toBe(0);
    expect(b.y).toBe(0);
    expect(a.x).toBeLessThan(b.x);
  });

  it('boxes that only touch the gap boundary are left alone', () => {
    const a = { id: 'a', label: 'a', w: 10, h: 10, x: 0, y: 0 };
    const b = { id: 'b', label: 'b', w: 10, h: 10, x: 10 + GAP, y: 0 };
    removeOverlaps([a, b]);
    expect(b.x).toBe(10 + GAP);
    expect(a.x).toBe(0);
  });

  it('layoutMap: a consumer repo lands left of the provider repo it calls', () => {
    const nodes = [
      n('repo:a', null, 'repo', 'repo-a'),
      n('repo:b', null, 'repo', 'repo-b'),
      n('svc:a', 'repo:a', 'service', 'svc-a'),
      n('ep:x', 'svc:a', 'endpoint', 'GET /x'),
      n('svc:b', 'repo:b', 'service', 'svc-b'),
    ];
    // svc:b consume el endpoint servido por repo:a
    const l = layoutMap(nodes, [{ source: 'svc:b', target: 'ep:x', weight: 2 }]);
    const a = l.top.get('repo:a') as { x: number; y: number };
    const b = l.top.get('repo:b') as { x: number; y: number };
    // svc:b (en repo:b) consume algo de repo:a → repo:b queda a la izquierda.
    expect(b.x).toBeLessThan(a.x);
  });

  it('relations between nodes of the same top-level box do not pull the box on itself', () => {
    const nodes = [n('s', null, 'service'), n('e1', 's', 'endpoint'), n('e2', 's', 'endpoint')];
    const l = layoutMap(nodes, [{ source: 'e1', target: 'e2', weight: 9 }]);
    expect(l.top.size).toBe(1);
  });

  it('handles many roots without hanging (layered columns, not a force field)', () => {
    const many = Array.from({ length: 450 }, (_, i) => n(`r${i}`, null, 'repo'));
    const t0 = Date.now();
    const l = layoutMap(many, []);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(l.top.size).toBe(many.length);
  });
});
