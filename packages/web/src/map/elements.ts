import type { MapViewResponse, OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { canOpen } from './code.js';
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

/** Trunca un rótulo para que quepa en su pastilla (el lienzo no parte filas). */
export function truncateLabel(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Etiqueta del nodo: "nombre" o "nombre  ▸ 12" si se puede abrir. */
export function nodeLabel(n: ProjectedNode, hidden: number): string {
  // La fila de interfaz es de DOS LÍNEAS como en la referencia "Contracts
  // lens": el tipo de contrato arriba (HTTP, GRAPHQL…) y debajo el nombre
  // (método + ruta). El nombre se trunca para caber en la fila.
  let base = n.label;
  if (n.kind === 'endpoint') {
    const at = base.indexOf(':');
    if (at > 0 && at < 10) {
      base = `${base.slice(0, at).toUpperCase()}\n${truncateLabel(base.slice(at + 1).trim(), 30)}`;
    } else {
      base = truncateLabel(base, 34);
    }
  }
  if (n.meta.loading === true) return `${base}  …`;
  // Código: los hijos no se cuentan de antemano, sólo se sabe que pueden existir.
  if (n.lazy) return n.expanded ? base : `${base}  ▸`;
  if (n.childCount === 0) return base;
  if (n.expanded) return hidden > 0 ? `${base}  (+${hidden})` : base;
  return `${base}  ▸ ${n.childCount}`;
}

export function edgeWidth(count: number): number {
  // Como en la referencia: el grosor crece con los call-sites, de 1.4 (1
  // llamada) a 3.5 (40+), en escala logarítmica.
  return 1.4 + 2.1 * Math.min(1, Math.log2(Math.max(1, count)) / Math.log2(40));
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
  // Como en la referencia: lo probado a opacidad plena, lo inferido a 0.75
  // (la confianza se lee en el rótulo "N · c", no en la opacidad).
  if (e.provenance === 'deterministic') return 1;
  return 0.75;
}

/**
 * Rótulo de la arista de relación, siempre visible (como en la referencia de
 * diseño): el número de la arista es el número de call-sites agregados. Lo
 * inferido además muestra su confianza (`4·0.6`): "fainter when less sure" se
 * dibuja en la opacidad, el score va en el rótulo. Las aristas de código
 * (calls/uses/…) siguen ocultas hasta enfocar: son ruido en conjunto.
 */
export function edgeLabel(e: OrgEdge): string {
  if (['calls', 'uses', 'imports', 'produces', 'callshttp'].includes(e.kind.toLowerCase())) {
    return e.label ?? e.kind;
  }
  // Como en la referencia: toda arista de relación lleva su número de
  // call-sites; la inferida añade la confianza con espacios: "4 · 0.6".
  if (e.provenance === 'inferred') return `${e.count} · ${e.confidence.toFixed(1)}`;
  return String(e.count);
}

export interface PortOpts {
  selectedId?: string | null | undefined;
  focusIds?: ReadonlySet<string> | null | undefined;
}

/** Repo del que cuelga un nodo: el ancestro `repo` en el árbol. */
export function repoAncestorOf(
  n: ProjectedNode,
  byId: ReadonlyMap<string, ProjectedNode>,
): string | null {
  let cur: ProjectedNode | undefined = byId.get(n.parent ?? '');
  const seen = new Set<string>([n.id]);
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'repo') return cur.id;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return null;
}

/**
 * Interfaces visibles: cada endpoint es una FILA dentro de la caja de su
 * servicio (modelo de la referencia "Contracts lens"), no un punto en el borde.
 */
export function portEndpointIds(
  view: Pick<MapViewResponse, 'nodes' | 'edges'>,
  _opts: PortOpts = {},
): Set<string> {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const ports = new Set<string>();
  for (const n of view.nodes) {
    if (n.kind !== 'endpoint') continue;
    if (repoAncestorOf(n, byId)) ports.add(n.id);
  }
  return ports;
}

/** Servicio proveedor de un endpoint: el ancestro `service` en el árbol. */
function providerServiceOf(
  n: ProjectedNode,
  byId: ReadonlyMap<string, ProjectedNode>,
): string | null {
  let cur: ProjectedNode | undefined = byId.get(n.parent ?? '');
  const seen = new Set<string>([n.id]);
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'service') return cur.id;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return null;
}

export interface CanvasShape {
  /** Padres efectivos en el lienzo (los caídos se resuelven hacia arriba). */
  parents: Map<string, string | null>;
  /** Nodos que el lienzo no dibuja (cajas vacías: Interfaces, grupos sin aristas). */
  dropped: Set<string>;
}

/**
 * Reubica el extremo de una arista cuando su nodo se cayó del lienzo: una
 * relación que el tope de abanico elevó a un grupo termina en el servicio
 * proveedor (o en el repo). Así no hace falta dibujar cajas que sólo
 * contendrían un título.
 */
function retargetEndpoint(
  id: string,
  byId: ReadonlyMap<string, ProjectedNode>,
  dropped: ReadonlySet<string>,
): string {
  let cur: ProjectedNode | undefined = byId.get(id);
  const seen = new Set<string>();
  while (cur && dropped.has(cur.id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    const svc = providerServiceOf(cur, byId);
    if (svc && !dropped.has(svc)) return svc;
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return cur && !dropped.has(cur.id) ? cur.id : id;
}

/**
 * Extremo de una ARISTA DE RELACIÓN (consumes): como en la referencia
 * "Contracts lens", la arista llega a la FILA de la interfaz proveedora cuando
 * esa fila está visible; sólo se eleva a la caja del servicio cuando la
 * interfaz no está dibujada.
 */
function relationEndpoint(
  id: string,
  byId: ReadonlyMap<string, ProjectedNode>,
  dropped: ReadonlySet<string>,
  drawn: ReadonlySet<string>,
): string {
  const t = retargetEndpoint(id, byId, dropped);
  const n = byId.get(t);
  if (n?.kind === 'endpoint' && !drawn.has(t)) {
    const svc = providerServiceOf(n, byId);
    if (svc && !dropped.has(svc)) return svc;
  }
  return t;
}

/**
 * Jerarquía del lienzo (contención real, como la referencia): repo → servicio →
 * interfaces como FILAS dentro de la caja del servicio (parent = service).
 * Sólo las cajas de grupo puras (Interfaces, clústeres) desaparecen del lienzo:
 * no aportan más que un título; sus aristas se reubican en el servicio proveedor.
 */
export function canvasShape(
  view: Pick<MapViewResponse, 'nodes' | 'edges'>,
  ports: ReadonlySet<string>,
): CanvasShape {
  const ids = new Set(view.nodes.map((n) => n.id));
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const dropped = new Set<string>();
  for (const n of view.nodes) {
    if (n.kind === 'group') dropped.add(n.id);
  }
  const parents = new Map<string, string | null>();
  for (const n of view.nodes) {
    if (dropped.has(n.id)) continue;
    if (ports.has(n.id)) {
      // Contención real: la interfaz cuelga de la caja de SU SERVICIO (el
      // servicio contiene sus interfaces como filas), no de la del repo.
      parents.set(n.id, providerServiceOf(n, byId) ?? repoAncestorOf(n, byId));
      continue;
    }
    let p: string | null = n.parent;
    const seen = new Set<string>([n.id]);
    while (p && dropped.has(p)) {
      if (seen.has(p)) break;
      seen.add(p);
      p = byId.get(p)?.parent ?? null;
    }
    parents.set(n.id, p && ids.has(p) ? p : null);
  }
  return { parents, dropped };
}

export function toCyElements(
  view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>,
  opts: PortOpts = {},
): CyElement[] {
  const ids = new Set(view.nodes.map((n) => n.id));
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const quiet = quietEdgeIds(view.edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
  const ports = portEndpointIds(view, opts);
  const { parents, dropped } = canvasShape(view, ports);
  // Hijos que cada nodo tendrá EN EL LIENZO (tras caer grupos y promover puertos):
  // un nodo sin hijos visibles es una unidad básica → punto, no caja.
  const canvasKids = new Map<string, number>();
  for (const [, p] of parents) {
    if (p) canvasKids.set(p, (canvasKids.get(p) ?? 0) + 1);
  }
  const out: CyElement[] = [];
  for (const n of view.nodes) {
    if (dropped.has(n.id)) continue;
    const isPort = ports.has(n.id);
    const parent = parents.get(n.id) ?? null;
    // Modelo de la referencia: caja = contenedor (repo, servicio, archivo…);
    // fila = interfaz dentro de la caja de su servicio; punto = unidad de código
    // (archivo/símbolo) al abrir el drill-down. Nada se apaga por "no estar
    // llamado desde fuera": todo el grafo se ve y la procedencia se lee en las
    // aristas (sólida = probada, discontinua = inferida, con su confianza).
    const isDot = (n.kind === 'file' || n.kind === 'symbol') && (canvasKids.get(n.id) ?? 0) === 0;
    const data: CyNodeData = {
      id: n.id,
      label: nodeLabel(n, view.hiddenChildren[n.id] ?? 0),
      kind: n.kind,
      childCount: n.childCount,
      expanded: n.expanded,
      collapsible: canOpen(n) && !n.expanded,
      ...(parent && ids.has(parent) ? { parent } : {}),
      ...(n.contract ? { contract: n.contract } : {}),
    };
    out.push({
      group: 'nodes',
      data,
      classes: [
        n.kind,
        isPort ? 'row' : '',
        isDot ? 'dot' : '',
        n.expanded ? 'expanded' : '',
        data.collapsible ? 'collapsible' : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  const drawnEdges: CyElement[] = [];
  const edgePairs = new Set<string>();
  for (const e of view.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    // Las aristas que tocaban una caja caída (grupo/Interfaces) se reubican en
    // el servicio proveedor; las de relación apuntan al servicio del endpoint
    // (las interfaces son filas dentro de su servicio): servicio → servicio.
    const isCode = ['calls', 'uses', 'imports', 'produces', 'callshttp'].includes(
      e.kind.toLowerCase(),
    );
    const climb = isCode
      ? (id: string) => retargetEndpoint(id, byId, dropped)
      : (id: string) => relationEndpoint(id, byId, dropped, ids);
    const source = climb(e.source);
    const target = climb(e.target);
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    const isCodeEdge = isCode;
    edgePairs.add(`${source}->${target}`);
    drawnEdges.push({
      group: 'edges',
      data: {
        id: e.id,
        source,
        target,
        label: edgeLabel(e),
        provenance: e.provenance,
        confidence: e.confidence,
        count: e.count,
        width: isCodeEdge ? 1.4 : edgeWidth(e.count),
        opacity: isCodeEdge ? 0.9 : edgeOpacity(e),
        mixed: e.provenance === 'deterministic' && e.inferredCount > 0,
      },
      classes: [
        e.provenance,
        quiet.has(e.id) ? 'quiet' : '',
        isCodeEdge ? `code-edge ${e.kind.toLowerCase()}` : '',
        e.kind === 'servedBy' ? (e.label === 'implements' ? 'implements' : 'servedby') : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  // La relación puerto → servicio ya la expresa la contención (el puerto cuelga
  // de la caja de su servicio), así que no se dibuja una arista sintética.
  return [...out, ...drawnEdges];
}

/** Entrada del reparto espacial (layout.ts) para una proyección. */
export function layoutInput(
  view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>,
  opts: PortOpts = {},
): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
} {
  const ids = new Set(view.nodes.map((n) => n.id));
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const ports = portEndpointIds(view, opts);
  const { parents, dropped } = canvasShape(view, ports);
  const edges: LayoutEdge[] = view.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => {
      const isCode = ['calls', 'uses', 'imports', 'produces', 'callshttp'].includes(
        e.kind.toLowerCase(),
      );
      const climb = isCode
        ? (id: string) => retargetEndpoint(id, byId, dropped)
        : (id: string) => relationEndpoint(id, byId, dropped, ids);
      const source = climb(e.source);
      const target = climb(e.target);
      return { source, target, weight: e.count };
    })
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  return {
    nodes: view.nodes
      .filter((n) => !dropped.has(n.id))
      .map((n) => ({
        id: n.id,
        parent: parents.get(n.id) ?? null,
        kind: n.kind,
        label: nodeLabel(n, view.hiddenChildren[n.id] ?? 0),
        ...(ports.has(n.id) ? { row: true as const } : {}),
      })),
    edges,
  };
}
