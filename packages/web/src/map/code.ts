// Capa de código del mapa: dentro de un repo abierto aparece "Code", y de ahí
// archivos/módulos → símbolos, pedidos a LAIN al abrir cada nodo (los
// endpoints, servicios y relaciones siguen viniendo de la proyección del
// servidor). Esto es sólo la fusión, en funciones puras: qué nodos aparecen,
// con qué padre y cuáles se pueden abrir.
//
// Las relaciones de código (Calls/Uses/Imports/…) NO se dibujan como aristas:
// el motor no dice dónde vive el otro extremo (sin ruta, sin padre) ni en qué
// sentido va, y un par inventado violaría INV 3. Se listan en el inspector,
// agrupadas por el tipo de arista con que se consultaron.

import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import type { CodeGraphCommGroup, CodeGraphNode } from '../api/hooks.js';

export type CodeEntry =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | {
      state: 'ready';
      children: CodeGraphNode[];
      truncated: boolean;
      /** Ruido que se dejó fuera de la lista (tests, ocultos, utilidades), contado. */
      hidden?: number;
      communications: CodeGraphCommGroup[];
    };

/** Por id del nodo padre (`code:…` o `sym:…`). */
export type CodeState = Readonly<Record<string, CodeEntry>>;

export const codeRootId = (lainRepo: string): string => `code:${lainRepo}`;
export const codeNodeId = (lainRepo: string, type: string, name: string): string =>
  `sym:${lainRepo}|${type}|${name}`;

export type ParsedCodeId =
  | { kind: 'root'; repo: string }
  | { kind: 'node'; repo: string; type: string; name: string };

export function parseCodeId(id: string): ParsedCodeId | null {
  if (id.startsWith('code:')) return { kind: 'root', repo: id.slice(5) };
  if (!id.startsWith('sym:')) return null;
  const body = id.slice(4);
  const a = body.indexOf('|');
  const b = body.indexOf('|', a + 1);
  if (a < 1 || b < 0) return null;
  // El nombre es lo último: puede llevar '|' (p. ej. firmas), el repo y el tipo no.
  return {
    kind: 'node',
    repo: body.slice(0, a),
    type: body.slice(a + 1, b),
    name: body.slice(b + 1),
  };
}

export const isCodeId = (id: string): boolean => parseCodeId(id) !== null;

const CONTAINER_TYPES = new Set(['File', 'Namespace', 'Module', 'Package']);
// Tipos que pueden contener otros (Contains saliente). El resto son hojas.
const OPENABLE_TYPES = new Set([
  ...CONTAINER_TYPES,
  'Class',
  'Interface',
  'Struct',
  'Trait',
  'Enum',
]);

/**
 * ¿Se puede abrir? Con hijos del análisis, o con hijos por pedir (código), o un
 * repo enlazado a LAIN (aunque el análisis de contratos no le vea servicios,
 * tiene código que navegar).
 */
export function canOpen(n: ProjectedNode): boolean {
  return (
    n.childCount > 0 ||
    n.lazy === true ||
    (n.kind === 'repo' && typeof n.meta.lainRepoId === 'string')
  );
}

export const isContainerType = (type: string): boolean => CONTAINER_TYPES.has(type);
export const isOpenableType = (type: string): boolean => OPENABLE_TYPES.has(type);

function codeNode(
  repo: string,
  parent: string,
  child: CodeGraphNode,
  open: ReadonlySet<string>,
  state: CodeState,
): ProjectedNode {
  const id = codeNodeId(repo, child.type, child.name);
  const entry = state[id];
  return {
    id,
    label: child.name,
    kind: isContainerType(child.type) ? 'file' : 'symbol',
    parent,
    // La etiqueta de tipo (FUNCTION, FILE…) reutiliza el chip de contrato.
    contract: child.type,
    meta: {
      repo,
      type: child.type,
      name: child.name,
      ...(entry?.state === 'loading' ? { loading: true } : {}),
      ...(entry?.state === 'error' ? { error: entry.message } : {}),
      ...(entry?.state === 'ready' && entry.truncated ? { truncated: true } : {}),
      ...(entry?.state === 'ready' && entry.hidden ? { hiddenNoise: entry.hidden } : {}),
    },
    childCount: 0,
    expanded: open.has(id),
    ...(isOpenableType(child.type) ? { lazy: true } : {}),
  };
}

/**
 * Proyección del servidor + capa de código. `open` son los nodos de código que
 * el usuario abrió; `state` lo ya pedido a LAIN. Un repo abierto cuyo
 * `lainRepoId` es null (su nombre no coincide con ningún repo del workspace)
 * NO recibe "Code": no se navega código de un repo que no se pudo identificar.
 */
export function mergeCode(
  view: MapViewResponse,
  open: ReadonlySet<string>,
  state: CodeState,
): MapViewResponse {
  const extra: ProjectedNode[] = [];
  const seen = new Set(view.nodes.map((n) => n.id));
  const add = (n: ProjectedNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    extra.push(n);
  };

  const grow = (parent: ProjectedNode, repo: string) => {
    if (!parent.expanded) return;
    const entry = state[parent.id];
    if (entry?.state !== 'ready') return;
    for (const child of entry.children) {
      const node = codeNode(repo, parent.id, child, open, state);
      add(node);
      grow(node, repo);
    }
  };

  for (const n of view.nodes) {
    if (n.kind !== 'repo' || !n.expanded) continue;
    const repo = n.meta.lainRepoId;
    if (typeof repo !== 'string') continue;
    const rootId = codeRootId(repo);
    const entry = state[rootId];
    const root: ProjectedNode = {
      id: rootId,
      label: 'Code',
      kind: 'code',
      parent: n.id,
      meta: {
        repo,
        ...(entry?.state === 'loading' ? { loading: true } : {}),
        ...(entry?.state === 'error' ? { error: entry.message } : {}),
        ...(entry?.state === 'ready' && entry.truncated ? { truncated: true } : {}),
        ...(entry?.state === 'ready' && entry.hidden ? { hiddenNoise: entry.hidden } : {}),
      },
      childCount: 0,
      expanded: open.has(rootId),
      lazy: true,
    };
    add(root);
    grow(root, repo);
  }

  if (extra.length === 0) return view;
  // El repo que ya tenía servicios hijos sigue contándolos; "Code" se suma.
  const bump = new Map<string, number>();
  for (const n of extra) if (n.kind === 'code') bump.set(n.parent as string, 1);
  return {
    ...view,
    nodes: [
      ...view.nodes.map((n) => (bump.has(n.id) ? { ...n, childCount: n.childCount + 1 } : n)),
      ...extra,
    ],
  };
}
