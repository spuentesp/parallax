// Matriz de dependencias: el mismo grafo del mapa, agregado a celdas
// consumidor × proveedor. La celda guarda cuántos call-sites la forman, la
// procedencia dominante (determinista si hay al menos uno estático), la
// confianza mínima de lo inferido y los contratos concretos que la sustentan
// (para el panel "through contracts" del par seleccionado).

import type {
  MatrixCell,
  MatrixData,
  MatrixLink,
  MatrixService,
  OrgEdge,
  OrgNode,
} from '@parallax/shared/org-map';
import { ancestorsOf, indexById, type OrgGraph } from './org-graph.js';

const MAX_LINKS_PER_CELL = 12;

/** Servicio dueño de un nodo: se sube por ancestros hasta kind === 'service'. */
function ownerServiceOf(id: string, byId: Map<string, OrgNode>): OrgNode | undefined {
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    if (n?.kind === 'service') return n;
    cur = n?.parent ?? null;
  }
  return byId.get(id);
}

function repoOf(id: string, byId: Map<string, OrgNode>): OrgNode | null {
  for (const a of ancestorsOf(id, byId)) {
    const n = byId.get(a);
    if (n?.kind === 'repo') return n;
  }
  const n = byId.get(id);
  return n?.kind === 'repo' ? n : null;
}

/**
 * Agrega las aristas `consumes` en celdas servicio × servicio. El consumidor
 * es el servicio del origen de la arista; el proveedor, el servicio del
 * endpoint destino. Se cuentan intra-repo y cross-repo (en la matriz de repos
 * los bloques diagonales son lo intra-repo).
 */
export function buildMatrix(graph: OrgGraph): MatrixData {
  const byId = indexById(graph);
  const services = new Map<string, MatrixService>();
  for (const n of graph.nodes) {
    if (n.kind !== 'service') continue;
    const repo = repoOf(n.id, byId);
    services.set(n.id, {
      id: n.id,
      label: n.label,
      repoId: repo?.id ?? null,
      repoLabel: repo?.label ?? null,
    });
  }

  const cells = new Map<string, MatrixCell>();
  const related = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'consumes') continue;
    const consumer = ownerServiceOf(e.source, byId);
    const endpoint = byId.get(e.target);
    const provider = endpoint ? ownerServiceOf(e.target, byId) : undefined;
    if (!consumer || !provider) continue;
    if (!services.has(consumer.id)) {
      const repo = repoOf(consumer.id, byId);
      services.set(consumer.id, {
        id: consumer.id,
        label: consumer.label,
        repoId: repo?.id ?? null,
        repoLabel: repo?.label ?? null,
      });
    }
    if (!services.has(provider.id)) {
      const repo = repoOf(provider.id, byId);
      services.set(provider.id, {
        id: provider.id,
        label: provider.label,
        repoId: repo?.id ?? null,
        repoLabel: repo?.label ?? null,
      });
    }
    related.add(consumer.id);
    related.add(provider.id);
    const key = `${consumer.id}->${provider.id}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        consumer: consumer.id,
        provider: provider.id,
        count: 0,
        deterministicCount: 0,
        inferredCount: 0,
        confidence: 1,
        provenance: 'deterministic',
        links: [],
      };
      cells.set(key, cell);
    }
    cell.count += e.count;
    cell.deterministicCount += e.deterministicCount;
    cell.inferredCount += e.inferredCount;
    if (e.provenance === 'inferred') {
      cell.provenance = cell.deterministicCount > 0 ? 'deterministic' : 'inferred';
      cell.confidence = Math.min(cell.confidence, e.confidence);
    } else {
      cell.provenance = 'deterministic';
    }
    if (endpoint) {
      pushLink(cell, endpoint, e);
    }
  }

  return {
    services: [...services.values()].sort((a, b) => a.label.localeCompare(b.label)),
    cells: [...cells.values()].sort(
      (a, b) => b.count - a.count || a.consumer.localeCompare(b.consumer),
    ),
    standalone: [...services.values()].filter((s) => !related.has(s.id)).map((s) => s.id),
  };
}

function pushLink(cell: MatrixCell, endpoint: OrgNode, e: OrgEdge): void {
  const at = cell.links.findIndex((l) => l.endpointId === endpoint.id);
  if (at >= 0) {
    const l = cell.links[at] as MatrixLink;
    l.count += e.count;
    if (e.provenance === 'deterministic') l.provenance = 'deterministic';
    l.confidence = Math.max(l.confidence, e.confidence);
    return;
  }
  cell.links.push({
    endpointId: endpoint.id,
    endpointLabel: endpoint.label,
    count: e.count,
    provenance: e.provenance,
    confidence: e.confidence,
  });
  cell.links.sort(
    (a, b) =>
      b.count - a.count ||
      Number(b.provenance === 'deterministic') - Number(a.provenance === 'deterministic'),
  );
  if (cell.links.length > MAX_LINKS_PER_CELL) cell.links.length = MAX_LINKS_PER_CELL;
}
