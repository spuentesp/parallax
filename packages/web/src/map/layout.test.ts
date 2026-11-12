import { describe, expect, it } from 'vitest';
import {
  GAP,
  type LayoutEdge,
  type LayoutNode,
  layoutMap,
  MAX_FORCE_ITEMS,
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
  it('grows with the label but stays within bounds', () => {
    expect(measure('a', 'service').w).toBeLessThan(
      measure('a-much-longer-service-name', 'service').w,
    );
    expect(measure('x'.repeat(500), 'endpoint').w).toBeLessThanOrEqual(230);
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

  it('draws linked items closer than unlinked ones', () => {
    const items = [n('a'), n('b'), n('c'), n('d')];
    const l = layoutMap(items, [{ source: 'a', target: 'b', weight: 20 }]);
    const d = (x: string, y: string) => {
      const p = l.leaves.get(x) as Point;
      const q = l.leaves.get(y) as Point;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    expect(d('a', 'b')).toBeLessThan(Math.max(d('a', 'c'), d('a', 'd'), d('b', 'c'), d('b', 'd')));
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

  it('opening one node moves its neighbours little (warm start from previous positions)', () => {
    const before = layoutMap(repos, edges);
    const opened = repos.flatMap((r) =>
      r.id === 'repo:3' ? [r, n('svc:3', 'repo:3'), n('svc:3b', 'repo:3')] : [r],
    );
    const after = layoutMap(opened, edges, before.top);
    const moved = repos
      .filter((r) => r.id !== 'repo:3')
      .map((r) => {
        const p = before.top.get(r.id) as Point;
        const q = after.top.get(r.id) as Point;
        return Math.hypot(p.x - q.x, p.y - q.y);
      });
    const median = [...moved].sort((a, b) => a - b)[Math.floor(moved.length / 2)] ?? 0;
    expect(median).toBeLessThan(120);
  });

  it('falls back to a plain grid past the force-layout limit instead of hanging', () => {
    const many = Array.from({ length: MAX_FORCE_ITEMS + 50 }, (_, i) => n(`r${i}`, null, 'repo'));
    const t0 = Date.now();
    const l = layoutMap(many, []);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(l.leaves.size).toBe(many.length);
  });

  it('handles empty and single-node views', () => {
    expect(layoutMap([], []).leaves.size).toBe(0);
    expect(layoutMap([n('solo')], []).leaves.size).toBe(1);
  });
});

describe('removeOverlaps', () => {
  it('pushes coincident boxes at least GAP apart', () => {
    const a = { id: 'a', w: 50, h: 20, x: 0, y: 0 };
    const b = { id: 'b', w: 50, h: 20, x: 1, y: 0 };
    removeOverlaps([a, b]);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    expect(dx >= 50 + GAP - 0.01 || dy >= 20 + GAP - 0.01).toBe(true);
  });
});
