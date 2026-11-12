import {
  expansionToReveal,
  filterOrgGraph,
  neighborhood,
  type OrgGraph,
  type OrgGraphFilters,
  type Projection,
  projectOrgGraph,
} from './org-graph.js';

// Una vista del mapa = filtros → expansión → proyección. Es lo que sirve
// POST /map/view y lo que el agente reutiliza para apuntar a un subgrafo: el
// cliente no calcula jerarquía ni agregación, sólo dibuja lo recibido.

export interface MapViewRequest {
  /** Nodos abiertos por el usuario (sus hijos vienen en la respuesta). */
  expand?: readonly string[];
  filters?: OrgGraphFilters;
  /** Nodo a enfocar: se revelan él y su vecindad de `hops` saltos. */
  focus?: string;
  hops?: number;
  /** Tope de hijos por padre; "mostrar más" sube el de un padre concreto. */
  limits?: Readonly<Record<string, number>>;
  /** Nodos que deben verse aunque excedan el tope (p. ej. la selección). */
  pin?: readonly string[];
}

export interface MapViewResponse extends Projection {
  /** Ids a resaltar (vecindad del foco); vacío si no hay foco. */
  focus: { seed: string; ids: string[] } | null;
  /** Ids que el cliente pidió expandir y ya no existen bajo estos filtros. */
  unknownExpand: string[];
  totals: { nodes: number; edges: number; shownNodes: number; shownEdges: number };
}

export const MAX_HOPS = 4;

export function viewOrgGraph(full: OrgGraph, req: MapViewRequest): MapViewResponse {
  const graph = req.filters ? filterOrgGraph(full, req.filters) : full;
  const known = new Set(graph.nodes.map((n) => n.id));

  const expanded = new Set<string>();
  const unknownExpand: string[] = [];
  for (const id of req.expand ?? []) {
    if (known.has(id)) expanded.add(id);
    else unknownExpand.push(id);
  }

  let focus: MapViewResponse['focus'] = null;
  if (req.focus !== undefined && known.has(req.focus)) {
    const hops = Math.min(Math.max(req.hops ?? 1, 0), MAX_HOPS);
    const ids = neighborhood(graph, req.focus, hops);
    // La vecindad se revela abriendo los ancestros de cada nodo alcanzado.
    for (const a of expansionToReveal(graph, ids)) expanded.add(a);
    focus = { seed: req.focus, ids: [...ids] };
  }

  const pinned = new Set(req.pin?.filter((id) => known.has(id)));
  for (const id of focus?.ids ?? []) pinned.add(id);
  // Fijar un nodo obliga a abrir sus ancestros para que sea alcanzable.
  for (const a of expansionToReveal(graph, pinned)) expanded.add(a);
  const projection = projectOrgGraph(graph, expanded, {
    ...(req.limits ? { limits: req.limits } : {}),
    pinned,
  });
  return {
    ...projection,
    focus,
    unknownExpand,
    totals: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      shownNodes: projection.nodes.length,
      shownEdges: projection.edges.length,
    },
  };
}
