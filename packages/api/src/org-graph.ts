import type { TopologyEdge, TopologyNode, TopologyViewData } from './topology.js';

// Modelo del mapa de la organización: la misma topología de contratos, pero
// con (a) jerarquía como contención (repo ⊃ servicio ⊃ endpoint, compound
// nodes en el cliente), (b) procedencia de cada relación y (c) proyecciones
// por nivel. Todo son funciones puras sobre un grafo ya construido: el motor
// se consulta una vez (ver org-graph-cache.ts) y los filtros, la expansión y
// el foco se calculan en memoria, sin volver a LAIN.
//
// Procedencia — la distinción que el mapa tiene que mostrar siempre:
//   deterministic  vínculo con binding estático (lo prueba el análisis) o
//                  relación estructural (contiene / es servido por).
//   inferred       vínculo heurístico: lleva confianza y NO se promueve.
// Una arista mixta (algunos usos estáticos, otros heurísticos) es
// deterministic, pero conserva el conteo de usos heurísticos: nada se
// redondea hacia arriba.

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

export interface OrgGraph {
  nodes: OrgNode[];
  edges: OrgEdge[];
}

export interface OrgGraphFilters {
  /** Sólo endpoints de este tipo de contrato. */
  contract?: string | undefined;
  /** Sólo relaciones de esta procedencia. */
  provenance?: Provenance | undefined;
  /** Descarta relaciones inferidas con confianza menor. */
  minConfidence?: number | undefined;
  /** Sólo este servicio y todo lo que lo consume o que él consume. */
  service?: string | undefined;
}

/** Procedencia de una arista de topología según sus conteos de uso. */
function edgeProvenance(e: TopologyEdge): {
  provenance: Provenance;
  deterministicCount: number;
  inferredCount: number;
} {
  if (e.kind !== 'consumes') {
    return { provenance: 'deterministic', deterministicCount: 1, inferredCount: 0 };
  }
  const staticUses = numberMeta(e.meta, 'staticUses');
  const heuristicUses = numberMeta(e.meta, 'heuristicUses');
  if (staticUses === undefined && heuristicUses === undefined) {
    // Topología sin conteo por uso: la procedencia sale del binding único.
    const heuristic = e.meta?.binding === 'heuristic';
    return {
      provenance: heuristic ? 'inferred' : 'deterministic',
      deterministicCount: heuristic ? 0 : 1,
      inferredCount: heuristic ? 1 : 0,
    };
  }
  const det = staticUses ?? 0;
  const inf = heuristicUses ?? 0;
  return {
    provenance: det > 0 ? 'deterministic' : 'inferred',
    deterministicCount: det,
    inferredCount: inf,
  };
}

function numberMeta(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === 'number' ? v : undefined;
}

/** Topología de contratos → grafo del mapa, con procedencia por arista. */
export function toOrgGraph(topology: TopologyViewData): OrgGraph {
  const nodes: OrgNode[] = topology.nodes.map((n: TopologyNode) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    parent: n.parent,
    ...(n.kind === 'endpoint' && typeof n.meta?.contractKind === 'string'
      ? { contract: n.meta.contractKind }
      : {}),
    meta: n.meta ?? {},
  }));
  const edges: OrgEdge[] = [];
  for (const e of topology.edges) {
    // La contención va en `parent`; sólo las relaciones son aristas.
    if (e.kind === 'contains') continue;
    const p = edgeProvenance(e);
    const confidence =
      e.kind === 'consumes'
        ? (numberMeta(e.meta, 'confidence') ?? (p.provenance === 'inferred' ? 0 : 1))
        : 1;
    edges.push({
      id: `${e.kind}:${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      kind: e.kind,
      provenance: p.provenance,
      confidence,
      count: Math.max(1, p.deterministicCount + p.inferredCount),
      deterministicCount: p.deterministicCount,
      inferredCount: p.inferredCount,
      ...(e.label ? { label: e.label } : {}),
    });
  }
  return { nodes, edges };
}

function indexById(graph: OrgGraph): Map<string, OrgNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Ancestros de un nodo, del padre inmediato a la raíz. Tolera ciclos. */
export function ancestorsOf(id: string, byId: ReadonlyMap<string, OrgNode>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parent ?? null;
  }
  return out;
}

/**
 * Filtros en memoria sobre el grafo completo. Con un filtro de relación
 * (procedencia o confianza) el resultado sólo conserva lo que participa en una
 * relación superviviente — más sus ancestros —, para poder mirar "sólo lo
 * inferido" sin ruido. Con un filtro de contrato o servicio se acota por nodo.
 */
export function filterOrgGraph(graph: OrgGraph, f: OrgGraphFilters): OrgGraph {
  const byId = indexById(graph);
  const relationFilter = f.provenance !== undefined || f.minConfidence !== undefined;

  let edges = graph.edges.filter((e) => {
    if (e.kind !== 'consumes') return true;
    if (f.provenance !== undefined && e.provenance !== f.provenance) return false;
    // La confianza sólo discrimina lo inferido: un vínculo estático no tiene
    // un umbral que cruzar.
    if (
      f.minConfidence !== undefined &&
      e.provenance === 'inferred' &&
      e.confidence < f.minConfidence
    ) {
      return false;
    }
    return true;
  });

  let keep: Set<string> | null = null;

  if (f.contract !== undefined) {
    const endpoints = new Set(
      graph.nodes
        .filter((n) => n.kind === 'endpoint' && n.contract === f.contract)
        .map((n) => n.id),
    );
    edges = edges.filter((e) => {
      const ep = byId.get(e.kind === 'consumes' ? e.target : e.source);
      return ep?.kind === 'endpoint' && endpoints.has(ep.id);
    });
    keep = new Set(endpoints);
  }

  if (f.service !== undefined) {
    const svc = graph.nodes.find(
      (n) => n.kind === 'service' && (n.id === f.service || n.label === f.service),
    );
    if (svc) {
      const owned = new Set(graph.nodes.filter((n) => n.parent === svc.id).map((n) => n.id));
      const related = new Set<string>([svc.id, ...owned]);
      for (const e of edges) {
        const touchesOwned =
          owned.has(e.source) || owned.has(e.target) || e.source === svc.id || e.target === svc.id;
        if (!touchesOwned) continue;
        related.add(e.source);
        related.add(e.target);
      }
      keep = keep ? new Set([...keep].filter((id) => related.has(id))) : related;
      edges = edges.filter((e) => related.has(e.source) && related.has(e.target));
    } else {
      keep = new Set();
      edges = [];
    }
  }

  if (relationFilter) {
    const inRelation = new Set<string>();
    for (const e of edges) {
      if (e.kind !== 'consumes') continue;
      inRelation.add(e.source);
      inRelation.add(e.target);
    }
    keep = keep ? new Set([...keep].filter((id) => inRelation.has(id))) : inRelation;
  }

  if (keep === null) return { nodes: graph.nodes, edges };

  // Cierre hacia arriba: un nodo conservado arrastra a su servicio y repo.
  const closed = new Set<string>();
  for (const id of keep) {
    closed.add(id);
    for (const a of ancestorsOf(id, byId)) closed.add(a);
  }
  return {
    nodes: graph.nodes.filter((n) => closed.has(n.id)),
    edges: edges.filter((e) => closed.has(e.source) && closed.has(e.target)),
  };
}

// ── Proyección por nivel ────────────────────────────────────────────────────

export interface ProjectedNode extends OrgNode {
  /** Hijos directos en el grafo (filtrado), visibles o no. */
  childCount: number;
  /** true si sus hijos ya vienen en la proyección. */
  expanded: boolean;
}

export interface Projection {
  nodes: ProjectedNode[];
  edges: OrgEdge[];
}

/**
 * Lo visible dado un conjunto de nodos expandidos: las raíces más los hijos de
 * cada nodo expandido cuyo ancestro también está expandido. Las aristas se
 * ELEVAN al ancestro visible más cercano de cada extremo y se agregan, con
 * conteos por procedencia — colapsar nunca borra relaciones, las resume.
 * Una arista entre un nodo y su propio ancestro (p. ej. endpoint → su
 * servicio) es contención, no relación, y se descarta.
 */
export function projectOrgGraph(graph: OrgGraph, expanded: ReadonlySet<string>): Projection {
  const byId = indexById(graph);
  const childCount = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.parent !== null && byId.has(n.parent)) {
      childCount.set(n.parent, (childCount.get(n.parent) ?? 0) + 1);
    }
  }

  const visible = (n: OrgNode): boolean => {
    let cur = n.parent;
    const seen = new Set<string>([n.id]);
    while (cur !== null && byId.has(cur)) {
      if (!expanded.has(cur) || seen.has(cur)) return false;
      seen.add(cur);
      cur = byId.get(cur)?.parent ?? null;
    }
    return true;
  };

  const visibleNodes = graph.nodes.filter(visible);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  const lift = (id: string): string | null => {
    if (visibleIds.has(id)) return id;
    for (const a of ancestorsOf(id, byId)) if (visibleIds.has(a)) return a;
    return null;
  };

  const agg = new Map<string, OrgEdge>();
  for (const e of graph.edges) {
    const s = lift(e.source);
    const t = lift(e.target);
    if (s === null || t === null || s === t) continue;
    if (ancestorsOf(s, byId).includes(t) || ancestorsOf(t, byId).includes(s)) continue;
    const key = `${e.kind}:${s}->${t}`;
    const prev = agg.get(key);
    if (!prev) {
      agg.set(key, { ...e, id: key, source: s, target: t });
      continue;
    }
    prev.count += e.count;
    prev.deterministicCount += e.deterministicCount;
    prev.inferredCount += e.inferredCount;
    prev.confidence = Math.max(prev.confidence, e.confidence);
    if (e.provenance === 'deterministic') prev.provenance = 'deterministic';
    if (e.label && prev.label !== e.label) delete prev.label;
  }

  return {
    nodes: visibleNodes.map((n) => ({
      ...n,
      childCount: childCount.get(n.id) ?? 0,
      expanded: expanded.has(n.id),
    })),
    edges: [...agg.values()],
  };
}

// ── Foco, detalle y búsqueda ────────────────────────────────────────────────

/**
 * Vecindad de k saltos (por aristas de relación, en ambos sentidos). Devuelve
 * los ids alcanzados incluida la semilla. Los saltos de contención no cuentan:
 * lo que se quiere ver es "quién habla con esto".
 */
export function neighborhood(graph: OrgGraph, seed: string, hops: number): Set<string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adj.get(a) ?? new Set<string>();
    adj.set(a, set);
    set.add(b);
  };
  for (const e of graph.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const reached = new Set<string>([seed]);
  let frontier = [seed];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const peer of adj.get(id) ?? []) {
        if (reached.has(peer)) continue;
        reached.add(peer);
        next.push(peer);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return reached;
}

/** Expansión mínima que deja visibles todos los `ids` dados. */
export function expansionToReveal(graph: OrgGraph, ids: Iterable<string>): Set<string> {
  const byId = indexById(graph);
  const out = new Set<string>();
  for (const id of ids) for (const a of ancestorsOf(id, byId)) out.add(a);
  return out;
}

export interface NodeRelation {
  edge: OrgEdge;
  peer: OrgNode;
}

export interface NodeDetail {
  node: OrgNode;
  /** Del padre a la raíz: repo ⊃ servicio ⊃ … */
  path: OrgNode[];
  children: OrgNode[];
  /** Quién lo consume (consumidores) / a quién consume (proveedores). */
  consumers: NodeRelation[];
  providers: NodeRelation[];
}

/**
 * Detalle de un nodo con sus relaciones a nivel de servicio. Para un endpoint,
 * `consumers` son los servicios que lo consumen; para un servicio, los
 * consumidores de CUALQUIERA de sus endpoints (incluidos otros repos) y los
 * proveedores de los que él depende. Cada relación conserva su procedencia.
 */
export function describeNode(graph: OrgGraph, id: string): NodeDetail | null {
  const byId = indexById(graph);
  const node = byId.get(id);
  if (!node) return null;

  const subtree = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of graph.nodes) {
      if (n.parent !== null && subtree.has(n.parent) && !subtree.has(n.id)) {
        subtree.add(n.id);
        grew = true;
      }
    }
  }

  const ownerOf = (nid: string): OrgNode | undefined => {
    // El servicio (o, si no lo hay, el nodo mismo) que representa a `nid`.
    const chain = [nid, ...ancestorsOf(nid, byId)];
    for (const c of chain) if (byId.get(c)?.kind === 'service') return byId.get(c);
    return byId.get(nid);
  };

  const consumers = new Map<string, NodeRelation>();
  const providers = new Map<string, NodeRelation>();
  for (const e of graph.edges) {
    if (e.kind !== 'consumes') continue;
    const consumerInside = subtree.has(e.source);
    const endpointInside = subtree.has(e.target);
    if (endpointInside && !consumerInside) {
      const peer = ownerOf(e.source);
      if (peer) merge(consumers, peer, e);
    } else if (consumerInside && !endpointInside) {
      const peer = ownerOf(e.target);
      if (peer) merge(providers, peer, e);
    }
  }

  return {
    node,
    path: ancestorsOf(id, byId).flatMap((a) => byId.get(a) ?? []),
    children: graph.nodes.filter((n) => n.parent === id),
    consumers: [...consumers.values()],
    providers: [...providers.values()],
  };
}

function merge(into: Map<string, NodeRelation>, peer: OrgNode, e: OrgEdge): void {
  const prev = into.get(peer.id);
  if (!prev) {
    into.set(peer.id, { peer, edge: { ...e, source: e.source, target: e.target } });
    return;
  }
  prev.edge.count += e.count;
  prev.edge.deterministicCount += e.deterministicCount;
  prev.edge.inferredCount += e.inferredCount;
  prev.edge.confidence = Math.max(prev.edge.confidence, e.confidence);
  if (e.provenance === 'deterministic') prev.edge.provenance = 'deterministic';
}

/** Búsqueda por etiqueta (subcadena, sin mayúsculas); prefijos primero. */
export function searchOrgGraph(graph: OrgGraph, query: string, limit = 25): OrgNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const scored: Array<{ n: OrgNode; rank: number }> = [];
  for (const n of graph.nodes) {
    const label = n.label.toLowerCase();
    const at = label.indexOf(q);
    if (at < 0) continue;
    scored.push({ n, rank: at === 0 ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.n.label.localeCompare(b.n.label));
  return scored.slice(0, limit).map((s) => s.n);
}
