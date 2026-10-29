// Reparto espacial del mapa, independiente de Cytoscape (funciones puras).
//
// Por qué no el layout de compuestos de Cytoscape (cose): con contenedores
// abiertos de decenas de hijos produce una columna deforme y mueve todo en
// cada apertura. Aquí el reparto es explícito y estable:
//
//   1. Dentro de un contenedor abierto, los hijos van en una rejilla (las
//      columnas se alinean): lee como una ficha, no como una nube.
//   2. Los elementos de primer nivel (con su tamaño ya calculado) se colocan
//      con un modelo de fuerzas — las relaciones agregadas los acercan, el
//      tamaño los separa — y una pasada final elimina solapes.
//   3. Es determinista y parte de las posiciones previas: abrir un nodo
//      empuja a sus vecinos lo justo en vez de barajar todo el lienzo.

import type { ProjectedNode } from '@parallax/shared/org-map';

export interface Size {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

/** Hueco entre celdas hermanas, relleno interior de un contenedor y alto de su rótulo. */
export const GAP = 14;
export const PAD = 16;
export const LABEL_H = 20;

const CHAR_W = { proportional: 6.6, mono: 6.1 } as const;

/** Tamaño de una hoja según su rótulo (el lienzo trunca con puntos suspensivos). */
export function measure(label: string, kind: ProjectedNode['kind']): Size {
  // Contratos y código se leen en monoespaciada; repos y servicios son nombres.
  const mono = kind !== 'repo' && kind !== 'service' && kind !== 'group' && kind !== 'code';
  const w = Math.round(
    Math.min(Math.max(label.length * (mono ? CHAR_W.mono : CHAR_W.proportional) + 22, 84), 230),
  );
  return {
    w,
    h:
      kind === 'repo'
        ? 34
        : kind === 'service'
          ? 28
          : kind === 'group' || kind === 'code'
            ? 26
            : 24,
  };
}

export interface LayoutNode {
  id: string;
  parent: string | null;
  /** Rótulo ya final (con "▸ N" / "(+N)"): fija el ancho de las hojas. */
  label: string;
  kind: ProjectedNode['kind'];
}
export interface LayoutEdge {
  source: string;
  target: string;
  weight: number;
}

export interface MapLayout {
  /** Centro de cada HOJA (los contenedores se ajustan solos a sus hijos). */
  leaves: Map<string, Point>;
  /** Tamaño fijo de cada hoja, para el estilo. */
  sizes: Map<string, Size>;
  /** Centro de los elementos de primer nivel (se reutiliza como posición previa). */
  top: Map<string, Point>;
}

interface Tree {
  node: LayoutNode;
  kids: Tree[];
  /** Caja EXTERIOR (incluye el rótulo de un contenedor). */
  outer: Size;
  /** Rejilla de hijos: alto/ancho interior y celdas. */
  grid?: { w: number; h: number; cells: Array<{ kid: Tree; x: number; y: number }> };
}

function buildTrees(nodes: readonly LayoutNode[]): Tree[] {
  const ids = new Set(nodes.map((n) => n.id));
  const trees = new Map<string, Tree>(
    nodes.map((n) => [n.id, { node: n, kids: [], outer: { w: 0, h: 0 } }]),
  );
  const roots: Tree[] = [];
  for (const n of nodes) {
    const t = trees.get(n.id) as Tree;
    const p = n.parent !== null && ids.has(n.parent) ? trees.get(n.parent) : undefined;
    if (p && p !== t) p.kids.push(t);
    else roots.push(t);
  }
  return roots;
}

/** Rejilla con ~1.6 de proporción; columnas alineadas por su celda más ancha. */
function packGrid(kids: Tree[]): NonNullable<Tree['grid']> {
  const sorted = [...kids].sort(
    (a, b) =>
      Number(b.kids.length > 0) - Number(a.kids.length > 0) ||
      a.node.label.localeCompare(b.node.label),
  );
  const avgW = sorted.reduce((s, k) => s + k.outer.w, 0) / sorted.length;
  const avgH = sorted.reduce((s, k) => s + k.outer.h, 0) / sorted.length;
  const cols = Math.max(
    1,
    Math.min(sorted.length, Math.round(Math.sqrt((sorted.length * avgH * 1.6) / avgW))),
  );
  const rows = Math.ceil(sorted.length / cols);

  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  sorted.forEach((k, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, k.outer.w);
    rowH[r] = Math.max(rowH[r] ?? 0, k.outer.h);
  });
  const colX: number[] = [];
  let x = 0;
  for (const w of colW) {
    colX.push(x);
    x += w + GAP;
  }
  const rowY: number[] = [];
  let y = 0;
  for (const h of rowH) {
    rowY.push(y);
    y += h + GAP;
  }
  const cells = sorted.map((kid, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Celda centrada en su hueco de la rejilla.
    return {
      kid,
      x: (colX[c] ?? 0) + ((colW[c] ?? 0) - kid.outer.w) / 2,
      y: (rowY[r] ?? 0) + ((rowH[r] ?? 0) - kid.outer.h) / 2,
    };
  });
  return { w: Math.max(0, x - GAP), h: Math.max(0, y - GAP), cells };
}

function size(t: Tree): void {
  if (t.kids.length === 0) {
    t.outer = measure(t.node.label, t.node.kind);
    return;
  }
  for (const k of t.kids) size(k);
  const grid = packGrid(t.kids);
  t.grid = grid;
  t.outer = { w: grid.w + PAD * 2, h: grid.h + PAD * 2 + LABEL_H };
}

/** Coloca el árbol con su caja exterior centrada en `c` y apunta las hojas. */
function place(t: Tree, c: Point, out: Map<string, Point>): void {
  if (!t.grid) {
    out.set(t.node.id, c);
    return;
  }
  // El rótulo vive arriba; el rectángulo del contenedor está bajo él.
  const rectCenterY = c.y + LABEL_H / 2;
  const left = c.x - t.grid.w / 2;
  const top = rectCenterY - t.grid.h / 2;
  for (const cell of t.grid.cells) {
    place(
      cell.kid,
      { x: left + cell.x + cell.kid.outer.w / 2, y: top + cell.y + cell.kid.outer.h / 2 },
      out,
    );
  }
}

// ── Primer nivel: fuerzas con cajas ─────────────────────────────────────────

interface Item {
  id: string;
  w: number;
  h: number;
  x: number;
  y: number;
}

/** Hash estable → [0,1): la posición inicial de un elemento nuevo no depende del azar. */
function unit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export const MAX_FORCE_ITEMS = 400;

export function arrange(
  items: Item[],
  edges: ReadonlyArray<{ a: number; b: number; weight: number }>,
  warm: boolean,
): void {
  const n = items.length;
  if (n <= 1) return;
  const iterations = warm ? 120 : 320;
  const radius = (it: Item) => 0.5 * Math.hypot(it.w, it.h);

  for (let step = 0; step < iterations; step++) {
    const alpha = (warm ? 0.35 : 1) * (1 - step / iterations) + 0.02;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = items[i] as Item;
      fx[i] = (fx[i] ?? 0) - a.x * 0.004;
      fy[i] = (fy[i] ?? 0) - a.y * 0.004;
      for (let j = i + 1; j < n; j++) {
        const b = items[j] as Item;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = unit(a.id) - 0.5;
          dy = unit(b.id) - 0.5;
          d = Math.hypot(dx, dy) || 1;
        }
        const reach = radius(a) + radius(b) + GAP * 2;
        if (d > reach * 3) continue;
        const push = (reach * reach * 0.9) / (d * d);
        const px = (dx / d) * push;
        const py = (dy / d) * push;
        fx[i] = (fx[i] ?? 0) + px;
        fy[i] = (fy[i] ?? 0) + py;
        fx[j] = (fx[j] ?? 0) - px;
        fy[j] = (fy[j] ?? 0) - py;
      }
    }
    for (const e of edges) {
      const a = items[e.a] as Item;
      const b = items[e.b] as Item;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const ideal = radius(a) + radius(b) + GAP * 3;
      const pull = (d - ideal) * 0.05 * Math.min(3, 1 + Math.log1p(e.weight));
      const px = (dx / d) * pull;
      const py = (dy / d) * pull;
      fx[e.a] = (fx[e.a] ?? 0) + px;
      fy[e.a] = (fy[e.a] ?? 0) + py;
      fx[e.b] = (fx[e.b] ?? 0) - px;
      fy[e.b] = (fy[e.b] ?? 0) - py;
    }
    for (let i = 0; i < n; i++) {
      const it = items[i] as Item;
      const mx = Math.max(-40, Math.min(40, fx[i] ?? 0));
      const my = Math.max(-40, Math.min(40, fy[i] ?? 0));
      it.x += mx * alpha;
      it.y += my * alpha;
    }
  }
  removeOverlaps(items);
}

/** Separa rectángulos solapados por el eje de menor penetración. */
export function removeOverlaps(items: Item[], passes = 80): void {
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i] as Item;
        const b = items[j] as Item;
        const ox = (a.w + b.w) / 2 + GAP - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + GAP - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = a.x <= b.x ? -1 : 1;
          a.x += (s * ox) / 2;
          b.x -= (s * ox) / 2;
        } else {
          const s = a.y <= b.y ? -1 : 1;
          a.y += (s * oy) / 2;
          b.y -= (s * oy) / 2;
        }
      }
    }
    if (!moved) return;
  }
}

/** Rejilla simple para cuando hay demasiados elementos para el modelo de fuerzas. */
function gridPack(items: Item[]): void {
  const cols = Math.ceil(Math.sqrt(items.length * 1.6));
  let x = 0;
  let y = 0;
  let rowH = 0;
  items.forEach((it, i) => {
    if (i > 0 && i % cols === 0) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    it.x = x + it.w / 2;
    it.y = y + it.h / 2;
    x += it.w + GAP;
    rowH = Math.max(rowH, it.h);
  });
}

export function layoutMap(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  previous: ReadonlyMap<string, Point> = new Map(),
): MapLayout {
  const roots = buildTrees(nodes);
  for (const r of roots) size(r);

  const owner = new Map<string, string>();
  const index = new Map<string, number>();
  const mark = (t: Tree, rootId: string) => {
    owner.set(t.node.id, rootId);
    for (const k of t.kids) mark(k, rootId);
  };
  for (const r of roots) mark(r, r.node.id);

  const items: Item[] = roots.map((r, i) => {
    index.set(r.node.id, i);
    const prev = previous.get(r.node.id);
    const angle = i * 2.399963 + unit(r.node.id);
    const spread = 90 * Math.sqrt(i + 1) + Math.hypot(r.outer.w, r.outer.h) * 0.3;
    return {
      id: r.node.id,
      w: r.outer.w,
      h: r.outer.h,
      x: prev?.x ?? Math.cos(angle) * spread,
      y: prev?.y ?? Math.sin(angle) * spread,
    };
  });

  // Relaciones elevadas al primer nivel y agregadas por par.
  const pairs = new Map<string, { a: number; b: number; weight: number }>();
  for (const e of edges) {
    const a = index.get(owner.get(e.source) ?? '');
    const b = index.get(owner.get(e.target) ?? '');
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const prev = pairs.get(key);
    if (prev) prev.weight += e.weight;
    else pairs.set(key, { a: Math.min(a, b), b: Math.max(a, b), weight: e.weight });
  }

  const warm = items.length > 0 && items.every((it) => previous.has(it.id));
  if (items.length > MAX_FORCE_ITEMS) gridPack(items);
  else arrange(items, [...pairs.values()], warm);

  const leaves = new Map<string, Point>();
  const top = new Map<string, Point>();
  roots.forEach((r, i) => {
    const it = items[i] as Item;
    top.set(r.node.id, { x: it.x, y: it.y });
    place(r, { x: it.x, y: it.y }, leaves);
  });
  const sizes = new Map<string, Size>();
  const collect = (t: Tree) => {
    if (t.kids.length === 0) sizes.set(t.node.id, t.outer);
    for (const k of t.kids) collect(k);
  };
  for (const r of roots) collect(r);
  return { leaves, sizes, top };
}
