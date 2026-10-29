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

const MAX_COMM_PER_GROUP = 12;

/**
 * Proyección del servidor + capa de código. `open` son los nodos de código que
 * el usuario abrió; `state` lo ya pedido a LAIN. `activeRelations` son los nodos
 * cuyas relaciones de comunicación se proyectan bajo demanda en el lienzo.
 * Un repo abierto cuyo `lainRepoId` es null (su nombre no coincide con ningún
 * repo del workspace) NO recibe "Code": no se navega código de un repo que no se
 * pudo identificar.
 */
export function mergeCode(
  view: MapViewResponse,
  open: ReadonlySet<string>,
  state: CodeState,
  activeRelations?: ReadonlySet<string>,
): MapViewResponse {
  const extra: ProjectedNode[] = [];
  const extraEdges: import('@parallax/shared/org-map').OrgEdge[] = [];
  const seen = new Set(view.nodes.map((n) => n.id));
  const add = (n: ProjectedNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    extra.push(n);
  };

  const grow = (root: ProjectedNode, repo: string) => {
    const queue = [root];
    const visited = new Set<string>([root.id]);
    const MAX_GROW_DEPTH = 32;
    let depth = 0;
    while (queue.length > 0 && depth < MAX_GROW_DEPTH) {
      depth++;
      const parent = queue.shift()!;
      if (!parent.expanded) continue;
      const entry = state[parent.id];
      if (entry?.state !== 'ready') continue;
      for (const child of entry.children) {
        const node = codeNode(repo, parent.id, child, open, state);
        add(node);
        if (!visited.has(node.id)) {
          visited.add(node.id);
          queue.push(node);
        }
      }
    }
  };

  const repoRoots = new Map<string, string>();

  for (const n of view.nodes) {
    if (n.kind !== 'repo' || !n.expanded) continue;
    const repo = n.meta.lainRepoId;
    if (typeof repo !== 'string') continue;
    const rootId = codeRootId(repo);
    repoRoots.set(repo, rootId);
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

  // Relaciones de código proyectadas bajo demanda para los nodos activados
  if (activeRelations && activeRelations.size > 0) {
    for (const activeId of activeRelations) {
      const parsed = parseCodeId(activeId);
      const entry = state[activeId];
      if (!parsed || parsed.kind !== 'node' || entry?.state !== 'ready') continue;
      const rootId = repoRoots.get(parsed.repo) ?? codeRootId(parsed.repo);
      for (const comm of entry.communications) {
        const edgeKind = comm.edge.toLowerCase() as import('@parallax/shared/org-map').OrgEdgeKind;
        for (const peer of comm.nodes.slice(0, MAX_COMM_PER_GROUP)) {
          const peerId = codeNodeId(parsed.repo, peer.type, peer.name);
          if (!seen.has(peerId)) {
            // Asegura que el nodo par exista en el lienzo dentro del contenedor Code
            add({
              id: peerId,
              label: peer.name,
              kind: isContainerType(peer.type) ? 'file' : 'symbol',
              parent: rootId,
              contract: peer.type,
              meta: { repo: parsed.repo, type: peer.type, name: peer.name },
              childCount: 0,
              expanded: false,
              lazy: isOpenableType(peer.type),
            });
          }
          extraEdges.push({
            id: `${edgeKind}:${activeId}->${peerId}`,
            source: activeId,
            target: peerId,
            kind: edgeKind,
            provenance: 'deterministic',
            confidence: 1,
            count: 1,
            deterministicCount: 1,
            inferredCount: 0,
            label: comm.edge,
          });
        }
      }
    }
  }

  if (extra.length === 0 && extraEdges.length === 0) return view;
  // El repo que ya tenía servicios hijos sigue contándolos; "Code" se suma.
  const bump = new Map<string, number>();
  for (const n of extra) if (n.kind === 'code') bump.set(n.parent as string, 1);
  return {
    ...view,
    nodes: [
      ...view.nodes.map((n) => (bump.has(n.id) ? { ...n, childCount: n.childCount + 1 } : n)),
      ...extra,
    ],
    edges: [...view.edges, ...extraEdges],
  };
}
