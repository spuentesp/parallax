import { describe, expect, it } from 'vitest';
import {
  GAP,
  type LayoutEdge,
  type LayoutNode,
  layoutMap,
  measure,
  type Point,
  removeOverlaps,
} from './layout.js';

const n = (
  id: string,
  parent: string | null = null,
  kind: LayoutNode['kind'] = 'service',
): LayoutNode => ({
  id,
  parent,
  kind,
  label: id,
});

function boxes(layout: ReturnType<typeof layoutMap>) {
  return [...layout.leaves].map(([id, c]) => {
    const s = layout.sizes.get(id) ?? { w: 0, h: 0 };
    return { id, x1: c.x - s.w / 2, y1: c.y - s.h / 2, x2: c.x + s.w / 2, y2: c.y + s.h / 2 };
  });
}
const overlaps = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe('measure', () => {
  it('endpoint rows are two-line (h 44) and grow with the longest line within bounds', () => {
    expect(measure('a', 'endpoint').h).toBe(44);
    expect(measure('a', 'endpoint').w).toBeLessThan(
      measure('a-much-longer-endpoint-label', 'endpoint').w,
    );
    expect(measure('x'.repeat(500), 'endpoint').w).toBeLessThanOrEqual(320);
    expect(measure('a', 'endpoint').w).toBeGreaterThanOrEqual(160);
  });
  it('a leaf service is a compact box, not a dot; code leaves stay dots with a label band', () => {
    expect(measure('a', 'service').h).toBe(30);
    expect(measure('a', 'service').w).toBeLessThan(
      measure('a-much-longer-service-name', 'service').w,
    );
    expect(measure('x'.repeat(500), 'symbol').w).toBeLessThanOrEqual(110);
    expect(measure('a', 'symbol').h).toBeLessThan(measure('a', 'endpoint').h); // dot 32 < fila de dos líneas 44
  });
  it('repos grow with the label within bounds', () => {
    expect(measure('a', 'repo').w).toBeLessThan(measure('a-much-longer-repo-name', 'repo').w);
    expect(measure('x'.repeat(500), 'repo').w).toBeLessThanOrEqual(230);
    expect(measure('a', 'repo').w).toBeGreaterThanOrEqual(84);
  });
});

describe('layoutMap', () => {
  const repos = Array.from({ length: 12 }, (_, i) => n(`repo:${i}`, null, 'repo'));
  const edges: LayoutEdge[] = repos
    .slice(1)
    .map((r, i) => ({ source: 'repo:0', target: r.id, weight: i + 1 }));

  it('never overlaps two collapsed items', () => {
    const b = boxes(layoutMap(repos, edges));
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        expect(overlaps(b[i] as never, b[j] as never)).toBe(false);
      }
    }
  });

  it('is deterministic: same input, same layout', () => {
    const a = layoutMap(repos, edges);
    const b = layoutMap(repos, edges);
    expect([...a.leaves]).toEqual([...b.leaves]);
  });

  it('flows left→right: a consumer lands in an earlier column than its provider', () => {
    const items = [n('a'), n('b'), n('c'), n('d')];
    const l = layoutMap(items, [{ source: 'a', target: 'b', weight: 20 }]);
    const x = (id: string) => (l.top.get(id) as Point).x;
    expect(x('a')).toBeLessThan(x('b'));
    // Sin relación con a, c y d comparten columna con a (apilados en vertical).
    expect(x('c')).toBe(x('a'));
    expect(x('d')).toBe(x('a'));
  });

  it('packs the children of an open container in an aligned grid, without overlaps', () => {
    const nodes = [
      n('repo:o', null, 'repo'),
      n('svc:o', 'repo:o'),
      ...Array.from({ length: 30 }, (_, i) => n(`ep:${i}`, 'svc:o', 'endpoint')),
    ];
    const l = layoutMap(nodes, []);
    const b = boxes(l).filter((x) => x.id.startsWith('ep:'));
    expect(b).toHaveLength(30);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        expect(overlaps(b[i] as never, b[j] as never)).toBe(false);
      }
    }
    // Una ficha, no una columna: ni demasiado ancha ni demasiado alta.
    const w = Math.max(...b.map((x) => x.x2)) - Math.min(...b.map((x) => x.x1));
    const h = Math.max(...b.map((x) => x.y2)) - Math.min(...b.map((x) => x.y1));
    expect(w / h).toBeGreaterThan(0.8);
    expect(w / h).toBeLessThan(4);
  });

  it('keeps an open container clear of its neighbours', () => {
    const nodes = [
      n('repo:a', null, 'repo'),
      n('svc:a', 'repo:a'),
      ...Array.from({ length: 12 }, (_, i) => n(`ep:${i}`, 'svc:a', 'endpoint')),
      n('repo:b', null, 'repo'),
      n('repo:c', null, 'repo'),
    ];
    const l = layoutMap(nodes, [
      { source: 'repo:b', target: 'ep:0', weight: 3 },
      { source: 'repo:c', target: 'ep:1', weight: 3 },
    ]);
    const eps = boxes(l).filter((x) => x.id.startsWith('ep:'));
    const hull = {
      x1: Math.min(...eps.map((x) => x.x1)),
      y1: Math.min(...eps.map((x) => x.y1)),
      x2: Math.max(...eps.map((x) => x.x2)),
      y2: Math.max(...eps.map((x) => x.y2)),
    };
    for (const other of boxes(l).filter((x) => x.id === 'repo:b' || x.id === 'repo:c')) {
      expect(overlaps({ id: 'hull', ...hull }, other)).toBe(false);
    }
  });

  it('expanding one repo does not move the repos of earlier columns', () => {
    const before = layoutMap(repos, edges);
    const opened = repos.flatMap((r) =>
      r.id === 'repo:3' ? [r, n('svc:3', 'repo:3'), n('svc:3b', 'repo:3')] : [r],
    );
    const after = layoutMap(opened, edges);
    // repo:0 es la única fuente (columna 0): su posición no cambia al crecer otra caja.
    const p = before.top.get('repo:0') as Point;
    const q = after.top.get('repo:0') as Point;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBe(0);
  });

  it('handles empty and single-node views', () => {
    expect(layoutMap([], []).leaves.size).toBe(0);
    expect(layoutMap([n('solo')], []).leaves.size).toBe(1);
  });
});

describe('removeOverlaps', () => {
  it('pushes coincident boxes at least GAP apart', () => {
    const a = { id: 'a', label: 'a', w: 50, h: 20, x: 0, y: 0 };
    const b = { id: 'b', label: 'b', w: 50, h: 20, x: 1, y: 0 };
    removeOverlaps([a, b]);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    expect(dx >= 50 + GAP - 0.01 || dy >= 20 + GAP - 0.01).toBe(true);
  });
});

describe('interface rows inside the service box', () => {
  const row = (id: string, svc: string): LayoutNode => ({
    id,
    parent: svc,
    kind: 'endpoint',
    label: `http:GET /${id}`,
    row: true,
  });

  it('stacks endpoint rows in a single column inside the service, without overlaps', () => {
    const nodes: LayoutNode[] = [
      n('repo', null, 'repo'),
      n('svc', 'repo', 'service'),
      row('p1', 'svc'),
      row('p2', 'svc'),
      row('p3', 'svc'),
    ];
    const l = layoutMap(nodes, []);
    const all = boxes(l);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i] as never, all[j] as never)).toBe(false);
      }
    }
    // Una columna: misma x (centrada), y crecientes con GAP entre filas.
    const pts = ['p1', 'p2', 'p3'].map((id) => l.leaves.get(id) as Point);
    expect(pts.length).toBe(3);
    const xs = pts.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6);
    const ys = pts.map((p) => p.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (let k = 1; k < ys.length; k++) {
      const prev = ys[k - 1] ?? 0;
      const cur = ys[k] ?? 0;
      expect(cur - prev).toBeGreaterThanOrEqual(44 + GAP - 0.01);
    }
  });

  it('many rows fan out into several columns (no skyscraper box) without overlapping', () => {
    const nodes: LayoutNode[] = [
      n('repo', null, 'repo'),
      n('svc', 'repo', 'service'),
      ...Array.from({ length: 40 }, (_, i) => row(`p${i}`, 'svc')),
    ];
    const l = layoutMap(nodes, []);
    const bs = boxes(l).filter((b) => b.id.startsWith('p'));
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        expect(overlaps(bs[i] as never, bs[j] as never)).toBe(false);
      }
    }
    // Más de una columna: hay al menos dos x distintas entre las filas.
    const xs = new Set(bs.map((b) => Math.round((l.leaves.get(b.id) as Point).x)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('a service with only rows still lays out', () => {
    const nodes: LayoutNode[] = [
      n('repo', null, 'repo'),
      n('svc', 'repo', 'service'),
      row('p1', 'svc'),
      row('p2', 'svc'),
    ];
    const l = layoutMap(nodes, []);
    expect(l.leaves.get('p1')).toBeDefined();
    expect(l.leaves.get('p2')).toBeDefined();
  });
});
