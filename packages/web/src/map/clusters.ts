// Clústeres de interfaces: dentro de un grupo de contratos abierto (p. ej.
// "HTTP routes" con 20 rutas) los contratos relacionados se agrupan por afinidad
// (prefijo de ruta común, servicio gRPC, familia de topic…) y los que no
// comparten afinidad caen en "Other". Es una decisión visual pura sobre la
// proyección: el servidor no cambia, sólo se intercalan nodos de grupo
// sintéticos (`clu:…`, role 'cluster') entre el grupo y sus endpoints.
//
// El clúster es transparente al estado de apertura: se muestra cuando su grupo
// está abierto y no se pliega por su cuenta (canOpen lo excluye).

import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';

/** Un grupo con más contratos que esto se parte en clústeres; con pocos queda plano. */
export const CLUSTER_MIN = 5;

/** Primer segmento de ruta que no aporta afinidad por sí solo. */
const GENERIC_SEGMENTS = new Set([
  'api',
  'v1',
  'v2',
  'v3',
  'v4',
  'internal',
  'public',
  'rest',
  'web',
  'app',
  '_next',
  'graphql',
]);

export interface InterfaceCluster {
  key: string;
  label: string;
}

export const OTHER_CLUSTER: InterfaceCluster = { key: 'other', label: 'Other' };

/**
 * Afinidad de un contrato con otros: el prefijo que comparten contratos
 * relacionados. `null` cuando el tipo no tiene jerarquía útil (graphql, table…):
 * el grupo por tipo de contrato ya es semántico ahí.
 *
 * - http:  `GET /mcp/client/tool/list` → `/mcp` (dos segmentos si el primero es
 *   genérico: `/api/v2/orders` → `/api/v2`). Las cadenas sin ruta van a Other.
 * - rpc:   `rpc:ChatService/Stream` → `ChatService`.
 * - topic/celery: `celery:orders.send_email` → `orders`; `events/user.created` → `events`.
 */
export function interfaceClusterOf(contractKey: string): InterfaceCluster | null {
  const colon = contractKey.indexOf(':');
  const kind = colon > 0 ? contractKey.slice(0, colon) : 'unknown';
  const rest = colon > 0 ? contractKey.slice(colon + 1) : contractKey;
  if (kind === 'http') {
    const m = /^[A-Z]+\s+(\S+)/.exec(rest);
    const path = m?.[1] ?? rest;
    if (!path.startsWith('/')) return OTHER_CLUSTER;
    const segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return OTHER_CLUSTER;
    const depth = GENERIC_SEGMENTS.has((segs[0] ?? '').toLowerCase()) && segs.length > 1 ? 2 : 1;
    const prefix = `/${segs.slice(0, depth).join('/')}`;
    return { key: prefix.toLowerCase(), label: prefix };
  }
  if (kind === 'rpc') {
    const slash = rest.lastIndexOf('/');
    const svc = slash > 0 ? rest.slice(0, slash) : rest;
    return svc ? { key: svc, label: svc } : OTHER_CLUSTER;
  }
  if (kind === 'topic' || kind === 'celery' || rest.startsWith('celery/')) {
    const first = rest.split(/[./]/)[0] ?? '';
    return first ? { key: first, label: first } : OTHER_CLUSTER;
  }
  return null;
}

export function clusterNodeId(groupId: string, clusterKey: string): string {
  return `clu:${groupId}:${clusterKey}`;
}

/**
 * Intercala los nodos clúster en la proyección. Sólo grupos de contratos
 * abiertos (role distinto de 'interfaces') con más de `CLUSTER_MIN` endpoints
 * visibles y al menos dos clústeres distintos (related + non-related, o varios
 * related): si todo cae en un único clúster no se gana nada y se queda plano.
 */
export function withInterfaceClusters(view: MapViewResponse): MapViewResponse {
  const kidsByParent = new Map<string, ProjectedNode[]>();
  for (const n of view.nodes) {
    if (!n.parent) continue;
    const list = kidsByParent.get(n.parent) ?? [];
    list.push(n);
    kidsByParent.set(n.parent, list);
  }

  // groupId → clústeres a insertar (con sus endpoints ya reasignados)
  const clustersByGroup = new Map<string, ProjectedNode[]>();
  const reparent = new Map<string, string>();

  for (const g of view.nodes) {
    if (g.kind !== 'group' || g.meta.role === 'interfaces' || !g.expanded) continue;
    const kids = (kidsByParent.get(g.id) ?? []).filter((k) => k.kind === 'endpoint');
    if (kids.length <= CLUSTER_MIN) continue;
    const byCluster = new Map<string, { label: string; members: ProjectedNode[] }>();
    const localReparent = new Map<string, string>();
    for (const k of kids) {
      const c = interfaceClusterOf(k.label) ?? OTHER_CLUSTER;
      const acc = byCluster.get(c.key) ?? { label: c.label, members: [] };
      acc.members.push(k);
      byCluster.set(c.key, acc);
      localReparent.set(k.id, clusterNodeId(g.id, c.key));
    }
    // Un clúster con un solo miembro no es una relación: es un contrato suelto
    // → Other. "Relacionados" significa compartidos por ≥2 contratos.
    for (const [key, acc] of [...byCluster.entries()]) {
      if (key === OTHER_CLUSTER.key || acc.members.length > 1) continue;
      byCluster.delete(key);
      const other = byCluster.get(OTHER_CLUSTER.key) ?? {
        label: OTHER_CLUSTER.label,
        members: [] as ProjectedNode[],
      };
      other.members.push(...acc.members);
      byCluster.set(OTHER_CLUSTER.key, other);
      for (const m of acc.members) localReparent.set(m.id, clusterNodeId(g.id, OTHER_CLUSTER.key));
    }
    const entries = [...byCluster.entries()];
    const named = entries.filter(([key]) => key !== OTHER_CLUSTER.key);
    const hasOther = byCluster.has(OTHER_CLUSTER.key);
    // Se inserta el nivel sólo si realmente parte: 2+ clústeres con nombre, o
    // uno con nombre + Other. Un único clúster que lo absorbe todo es ruido.
    if (named.length + (hasOther ? 1 : 0) < 2) continue;
    for (const [id, parent] of localReparent) reparent.set(id, parent);
    entries.sort((a, b) => {
      const aOther = a[0] === OTHER_CLUSTER.key ? 1 : 0;
      const bOther = b[0] === OTHER_CLUSTER.key ? 1 : 0;
      return aOther - bOther || a[1].label.localeCompare(b[1].label);
    });
    const nodes: ProjectedNode[] = entries.map(([key, acc]) => ({
      id: clusterNodeId(g.id, key),
      label: key === OTHER_CLUSTER.key ? OTHER_CLUSTER.label : acc.label,
      kind: 'group',
      parent: g.id,
      meta: {
        role: 'cluster',
        cluster: key,
        ...(typeof g.meta.group === 'string' ? { group: g.meta.group } : {}),
        ...(typeof g.meta.service === 'string' ? { service: g.meta.service } : {}),
        ...(typeof g.meta.contractKind === 'string' ? { contractKind: g.meta.contractKind } : {}),
      },
      childCount: acc.members.length,
      expanded: true,
    }));
    clustersByGroup.set(g.id, nodes);
  }

  if (clustersByGroup.size === 0) return view;

  const out: ProjectedNode[] = [];
  for (const n of view.nodes) {
    const newParent = reparent.get(n.id);
    out.push(newParent ? { ...n, parent: newParent } : n);
    const clusters = clustersByGroup.get(n.id);
    if (clusters) out.push(...clusters);
  }
  return { ...view, nodes: out };
}
