// DTOs del mapa de la organización. Los comparten la api (que los produce) y
// la web (que los dibuja): un solo contrato, sin copias que se desvíen.
// Sólo tipos — la lógica vive en packages/api/src/org-graph.ts.

/** deterministic = binding estático / relación estructural; inferred = heurístico. */
export type Provenance = 'deterministic' | 'inferred';
export type OrgNodeKind = 'repo' | 'service' | 'endpoint';
export type OrgEdgeKind = 'consumes' | 'servedBy';

export interface OrgNode {
  id: string;
  label: string;
  kind: OrgNodeKind;
  parent: string | null;
  /** Tipo de contrato (http, topic, graphql…) — sólo endpoints. */
  contract?: string;
  meta: Record<string, unknown>;
}

export interface OrgEdge {
  id: string;
  source: string;
  target: string;
  kind: OrgEdgeKind;
  provenance: Provenance;
  confidence: number;
  /** Cuántas relaciones concretas representa (1 si no está agregada). */
  count: number;
  /** Desglose por procedencia de esas relaciones. */
  deterministicCount: number;
  inferredCount: number;
  label?: string;
}

export interface OrgGraphFilters {
  contract?: string | undefined;
  provenance?: Provenance | undefined;
  minConfidence?: number | undefined;
  service?: string | undefined;
}

export interface ProjectedNode extends OrgNode {
  /** Hijos directos en el grafo (filtrado), visibles o no. */
  childCount: number;
  /** true si sus hijos ya vienen en la proyección. */
  expanded: boolean;
}

export interface Projection {
  nodes: ProjectedNode[];
  edges: OrgEdge[];
  /** Hijos que el tope por padre dejó fuera, por id de padre expandido. */
  hiddenChildren: Record<string, number>;
}

export interface MapMeta {
  source: 'lain' | 'none' | 'unconfigured' | 'error';
  error?: string | null;
  lainUrl?: string;
  /** ms epoch de la construcción del grafo servido. */
  generatedAt?: number;
  stale?: boolean;
  refreshing?: boolean;
  lastError?: string;
}

export interface MapViewResponse extends Projection {
  focus: { seed: string; ids: string[] } | null;
  unknownExpand: string[];
  totals?: { nodes: number; edges: number; shownNodes: number; shownEdges: number };
  meta: MapMeta;
}

export interface NodeRelation {
  edge: OrgEdge;
  peer: OrgNode;
}

export interface NodeDetail {
  node: OrgNode;
  /** Del padre a la raíz: servicio, repo… */
  path: OrgNode[];
  children: OrgNode[];
  consumers: NodeRelation[];
  providers: NodeRelation[];
}
