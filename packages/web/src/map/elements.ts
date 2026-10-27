import type { MapViewResponse, OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import type { LayoutEdge, LayoutNode } from './layout.js';

// Proyección del servidor → elementos de Cytoscape. Funciones puras: aquí vive
// toda la decisión visual que depende de los datos (qué es compound, qué
// trazo lleva una relación), para poder probarla sin canvas.

export interface CyNodeData {
  id: string;
  parent?: string;
  label: string;
  kind: ProjectedNode['kind'];
  contract?: string;
  childCount: number;
  expanded: boolean;
  /** Nodo plegado con hijos: lleva "▸ N" en la etiqueta. */
  collapsible: boolean;
}

export interface CyEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  provenance: OrgEdge['provenance'];
  confidence: number;
  count: number;
  /** Ancho del trazo: crece con log2 del número de relaciones agregadas. */
  width: number;
  /** Opacidad: lo inferido se atenúa con su confianza; lo determinista es pleno. */
  opacity: number;
  mixed: boolean;
}

export type CyElement =
  | { group: 'nodes'; data: CyNodeData; classes: string }
  | { group: 'edges'; data: CyEdgeData; classes: string };

/** Etiqueta del nodo: "nombre" o "nombre  ▸ 12" si se puede abrir. */
export function nodeLabel(n: ProjectedNode, hidden: number): string {
  const base = n.kind === 'endpoint' ? trimContract(n.label) : n.label;
  if (n.childCount === 0) return base;
  if (n.expanded) return hidden > 0 ? `${base}  (+${hidden})` : base;
  return `${base}  ▸ ${n.childCount}`;
}

/** `http:GET /api/orders/{}` → `GET /api/orders/{}`: el tipo ya lo dice el color. */
function trimContract(label: string): string {
  const at = label.indexOf(':');
  return at > 0 && at < 10 ? label.slice(at + 1) : label;
}

export function edgeWidth(count: number): number {
  return Math.min(1.5 + Math.log2(Math.max(1, count)) * 0.8, 5);
}

/** Con más aristas que esto, las que no son "fuertes" se atenúan hasta que se miran. */
export const QUIET_THRESHOLD = 40;
export const LOUD_PER_NODE = 2;

/**
 * Divulgación progresiva: un grafo denso dibujado entero es una mancha. Cada
 * nodo conserva sus `LOUD_PER_NODE` relaciones más fuertes a plena vista (por
 * número de relaciones, luego confianza); el resto queda en segundo plano y
 * reaparece al seleccionar el nodo o al enfocarlo. Con pocas aristas no se
 * atenúa nada: aquí no se oculta información, sólo se jerarquiza.
 */
export function quietEdgeIds(edges: readonly OrgEdge[]): Set<string> {
  if (edges.length <= QUIET_THRESHOLD) return new Set();
  const byNode = new Map<string, OrgEdge[]>();
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      const list = byNode.get(id) ?? [];
      list.push(e);
      byNode.set(id, list);
    }
  }
  const loud = new Set<string>();
  for (const list of byNode.values()) {
    list.sort(
      (a, b) => b.count - a.count || b.confidence - a.confidence || a.id.localeCompare(b.id),
    );
    for (const e of list.slice(0, LOUD_PER_NODE)) loud.add(e.id);
  }
  return new Set(edges.filter((e) => !loud.has(e.id)).map((e) => e.id));
}

export function edgeOpacity(e: Pick<OrgEdge, 'provenance' | 'confidence'>): number {
  if (e.provenance === 'deterministic') return 0.9;
  return 0.35 + 0.55 * Math.min(1, Math.max(0, e.confidence));
}

export function edgeLabel(e: OrgEdge): string {
  const mixed = e.provenance === 'deterministic' && e.inferredCount > 0;
  if (e.count <= 1 && !mixed) return '';
  return mixed ? `×${e.count} (${e.inferredCount}~)` : `×${e.count}`;
}

export function toCyElements(
  view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>,
): CyElement[] {
  const ids = new Set(view.nodes.map((n) => n.id));
  const quiet = quietEdgeIds(view.edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
  const out: CyElement[] = [];
  for (const n of view.nodes) {
    const data: CyNodeData = {
      id: n.id,
      label: nodeLabel(n, view.hiddenChildren[n.id] ?? 0),
      kind: n.kind,
      childCount: n.childCount,
      expanded: n.expanded,
      collapsible: n.childCount > 0 && !n.expanded,
      ...(n.parent && ids.has(n.parent) ? { parent: n.parent } : {}),
      ...(n.contract ? { contract: n.contract } : {}),
    };
    out.push({
      group: 'nodes',
      data,
      classes: [n.kind, n.expanded ? 'expanded' : '', data.collapsible ? 'collapsible' : '']
        .filter(Boolean)
        .join(' '),
    });
  }
  for (const e of view.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    out.push({
      group: 'edges',
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: edgeLabel(e),
        provenance: e.provenance,
        confidence: e.confidence,
        count: e.count,
        width: edgeWidth(e.count),
        opacity: edgeOpacity(e),
        mixed: e.provenance === 'deterministic' && e.inferredCount > 0,
      },
      classes: quiet.has(e.id) ? `${e.provenance} quiet` : e.provenance,
    });
  }
  return out;
}

/** Entrada del reparto espacial (layout.ts) para una proyección. */
export function layoutInput(view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
} {
  return {
    nodes: view.nodes.map((n) => ({
      id: n.id,
      parent: n.parent,
      kind: n.kind,
      label: nodeLabel(n, view.hiddenChildren[n.id] ?? 0),
    })),
    edges: view.edges.map((e) => ({ source: e.source, target: e.target, weight: e.count })),
  };
}
