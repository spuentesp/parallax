// Reparto espacial del mapa, independiente de Cytoscape (funciones puras).
//
// Por qué no el layout de compuestos de Cytoscape (cose): con contenedores
// abiertos de decenas de hijos produce una columna deforme y mueve todo en
// cada apertura. Aquí el reparto es explícito, determinista y legible:
//
//   1. Dentro de un contenedor abierto, los hijos van en una rejilla (las
//      columnas se alinean): lee como una ficha, no como una nube. Las
//      interfaces (endpoints) son FILAS apiladas dentro de la caja de su
//      servicio, como en la referencia "Contracts lens".
//   2. Los elementos de primer nivel (las cajas de repo) se colocan en CAPAS
//      según la dirección de las dependencias: consumidor a la izquierda,
//      proveedor a la derecha. El flujo se lee en una pasada, de izquierda
//      a derecha, sin marañas.

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
/** Filas de interfaz por encima de este número pasan a varias columnas. */
export const ROW_SINGLE_COLUMN = 8;
export const LABEL_H = 20;

// Ancho medio de un carácter según la fuente del rótulo: el lienzo dibuja
// Space Grotesk a 13px para repos y servicios, y JetBrains Mono a 12px para
// contratos y código.
const CHAR_W = { proportional: 7.2, mono: 7.3 } as const;

/** Tamaño de una hoja según su rótulo (el lienzo trunca con puntos suspensivos). */
export function measure(label: string, kind: ProjectedNode['kind']): Size {
  // Contratos y código se leen en monoespaciada; repos y servicios son nombres.
  const mono = kind !== 'repo' && kind !== 'service' && kind !== 'group' && kind !== 'code';
  // La puerta de código plegada es una hoja: se mide como pastilla fija, no
  // como caja con rótulo (la caja fantasma vacía era ilegible).
  if (kind === 'code') return { w: 96, h: 26 };
  // Interfaz (endpoint): FILA a todo lo ancho dentro de la caja de su servicio
  // (se estira al ancho de columna en packGrid), de DOS LÍNEAS como en la
  // referencia "Contracts lens": tipo arriba, nombre debajo.
  if (kind === 'endpoint') {
    const longest = Math.max(...label.split('\n').map((l) => l.length));
    return {
      w: Math.round(Math.min(Math.max(longest * CHAR_W.mono + 24, 160), 320)),
      // 44px como las filas de contrato de la referencia "Contracts lens".
      h: 44,
    };
  }
  // Servicio suelto (sin hijos visibles): caja compacta con su nombre.
  if (kind === 'service') {
    return {
      w: Math.round(Math.min(Math.max(label.length * CHAR_W.proportional + 28, 120), 200)),
      h: 30,
    };
  }
  // Hojas de código (archivo, símbolo): punto + banda de rótulo debajo, con el
  // ancho del rótulo (topado) para que las etiquetas de puntos vecinos no se
  // solapen.
  if (kind === 'file' || kind === 'symbol') {
    const dot = kind === 'file' ? 16 : 12;
    const w = Math.round(Math.min(Math.max(label.length * CHAR_W.mono + 10, dot), 110));
    return { w, h: dot + LABEL_H };
  }
  const w = Math.round(
    Math.min(Math.max(label.length * (mono ? CHAR_W.mono : CHAR_W.proportional) + 22, 84), 230),
  );
  return {
    w,
    h: kind === 'repo' ? 34 : kind === 'group' ? 26 : 24,
  };
}

export interface LayoutNode {
  id: string;
  parent: string | null;
  /** Rótulo ya final (con "▸ N" / "(+N)"): fija el ancho de las hojas. */
  label: string;
  kind: ProjectedNode['kind'];
  /** Fila de interfaz: se apila en una columna dentro de la caja de su servicio. */
  row?: boolean;
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
    if (p && p !== t) {
      // Guard against ancestor cycle to prevent recursive call stack overflow
      let cur: Tree | undefined = p;
      let cycle = false;
      const seen = new Set<string>([t.node.id]);
      while (cur) {
        if (seen.has(cur.node.id)) {
          cycle = true;
          break;
        }
        seen.add(cur.node.id);
        const nextId: string | null = cur.node.parent;
        cur = nextId && ids.has(nextId) ? trees.get(nextId) : undefined;
      }
      if (!cycle) {
        p.kids.push(t);
      } else {
        roots.push(t);
      }
    } else {
      roots.push(t);
    }
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
  // Relación de aspecto del contenedor: expandir en horizontal para no apilar
  // en torres verticales estrechas. Con 2+ elementos se reparten en al menos
  // 2 columnas (o 3/4 si hay más hijos), aprovechando el espacio horizontal.
  // Las filas de interfaz (endpoints) se apilan dentro de la caja de su
  // servicio como filas de una lista (modelo de la referencia). Con pocas
  // filas es una columna; con muchas, varias columnas para que la caja no se
  // convierta en una torre alta y estrecha.
  if (sorted.length > 0 && sorted.every((k) => k.node.row) && sorted.length <= ROW_SINGLE_COLUMN) {
    const colW = Math.max(...sorted.map((k) => k.outer.w));
    let y = 0;
    const cells = sorted.map((kid) => {
      // La fila se estira a todo el ancho de la columna (referencia: filas a
      // lo ancho de la caja del servicio).
      kid.outer.w = colW;
      const cell = { kid, x: 0, y };
      y += kid.outer.h + GAP;
      return cell;
    });
    return { w: colW, h: Math.max(0, y - GAP), cells };
  }
  const idealColsByCount =
    sorted.length >= 16 ? 4 : sorted.length >= 7 ? 3 : sorted.length >= 2 ? 2 : 1;
  const rawCols = Math.round(Math.sqrt((sorted.length * avgH * 2.2) / avgW));
  const cols = Math.max(1, Math.min(sorted.length, Math.max(idealColsByCount, rawCols)));
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
    if (kid.node.row) {
      // Fila de interfaz: ocupa todo el ancho de su columna.
      kid.outer.w = colW[c] ?? kid.outer.w;
      return { kid, x: colX[c] ?? 0, y: (rowY[r] ?? 0) + ((rowH[r] ?? 0) - kid.outer.h) / 2 };
    }
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
  const grid = t.kids.length > 0 ? packGrid(t.kids) : { w: 0, h: 0, cells: [] };
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

// ── Primer nivel: capas según la dirección de las dependencias ──────────────

interface Item {
  id: string;
  label: string;
  w: number;
  h: number;
  x: number;
  y: number;
}

/** Separación horizontal entre columnas de capas: deja sitio a las aristas. */
export const LAYER_GAP = 160;

/**
 * Coloca las cajas de primer nivel en columnas por rango topológico: una
 * relación a→b pone a `a` en una columna a la izquierda de `b` (rango = camino
 * más largo desde las fuentes). Dentro de cada columna, apiladas y centradas.
 * Determinista: el mismo grafo siempre produce el mismo reparto, así que abrir
 * un nodo no baraja el lienzo. Los ciclos se rompen por orden de rótulo.
 */
export function arrangeLayered(
  items: Item[],
  pairs: ReadonlyArray<{ a: number; b: number }>,
): void {
  const n = items.length;
  if (n === 0) return;
  const out = new Map<number, number[]>();
  const indeg = new Array<number>(n).fill(0);
  for (const p of pairs) {
    (out.get(p.a) ?? out.set(p.a, []).get(p.a) ?? []).push(p.b);
    indeg[p.b] = (indeg[p.b] ?? 0) + 1;
  }
  const rank = new Array<number>(n).fill(0);
  const byLabel = [...items.keys()].sort((i, j) => items[i]!.label.localeCompare(items[j]!.label));
  const done = new Array<boolean>(n).fill(false);
  const queue = byLabel.filter((i) => (indeg[i] ?? 0) === 0);
  for (const i of queue) done[i] = true;
  let head = 0;
  while (head < queue.length) {
    const a = queue[head++] as number;
    for (const b of out.get(a) ?? []) {
      rank[b] = Math.max(rank[b] ?? 0, (rank[a] ?? 0) + 1);
      indeg[b] = (indeg[b] ?? 1) - 1;
      if (indeg[b] === 0 && !done[b]) {
        done[b] = true;
        queue.push(b);
      }
    }
  }
  // Ciclos: se asignan en orden de rótulo con el rango de sus predecesores ya
  // colocados (o 0), para que el reparto siga siendo determinista.
  for (const i of byLabel) {
    if (done[i]) continue;
    let r = 0;
    for (const p of pairs) if (p.b === i && done[p.a]) r = Math.max(r, (rank[p.a] ?? 0) + 1);
    rank[i] = r;
    done[i] = true;
  }
  // Columnas por rango; dentro, apiladas por rótulo y centradas en vertical.
  const cols = new Map<number, number[]>();
  items.forEach((it, i) => {
    const list = cols.get(rank[i] ?? 0) ?? [];
    list.push(i);
    cols.set(rank[i] ?? 0, list);
  });
  let x = 0;
  for (const r of [...cols.keys()].sort((a, b) => a - b)) {
    const col = (cols.get(r) ?? []).sort((i, j) => items[i]!.label.localeCompare(items[j]!.label));
    const maxW = Math.max(...col.map((i) => items[i]!.w));
    const totalH = col.reduce((s, i) => s + items[i]!.h, 0) + GAP * (col.length - 1);
    let y = -totalH / 2;
    for (const i of col) {
      const it = items[i]!;
      it.x = x + maxW / 2;
      it.y = y + it.h / 2;
      y += it.h + GAP;
    }
    x += maxW + LAYER_GAP;
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

export function layoutMap(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): MapLayout {
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
    return {
      id: r.node.id,
      label: r.node.label,
      w: r.outer.w,
      h: r.outer.h,
      x: 0,
      y: 0,
    };
  });

  // Relaciones elevadas al primer nivel y agregadas por par (a → b: a a la
  // izquierda de b). El reparto en capas es determinista: no hace falta
  // arrastrar posiciones previas.
  const pairs = new Map<string, { a: number; b: number }>();
  for (const e of edges) {
    const a = index.get(owner.get(e.source) ?? '');
    const b = index.get(owner.get(e.target) ?? '');
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}->${b}`;
    if (!pairs.has(key)) pairs.set(key, { a, b });
  }

  arrangeLayered(items, [...pairs.values()]);

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
