import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from './lain-adapter/types.js';

// Topología a nivel de endpoint (§10: "el mapa agrupa usos por par de
// servicios, pero mantiene cada uso inspeccionable").
//
// Un grafo servicio→servicio aplasta la información que importa: si billing
// consume tres endpoints distintos de orders, son tres relaciones, no una.
// Aquí cada endpoint es su nodo, y cada consumidor se engancha al endpoint
// concreto que usa, rotulado con el campo que lee.

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'service' | 'endpoint';
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'provides' | 'consumes';
  meta?: Record<string, unknown>;
}

export interface TopologyStats {
  services: number;
  endpoints: number;
  dependencies: number;
  repos: string[];
  byKind: Record<string, number>;
}

export interface TopologyResult {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  stats: TopologyStats;
}

/** Sólo nodos y aristas, para quien no necesita las estadísticas. */
export type TopologyViewData = Pick<TopologyResult, 'nodes' | 'edges'>;

export interface TopologyFilters {
  /** Sólo endpoints de este tipo: http, topic, graphql, table, rpc, websocket. */
  readonly kind?: string;
  /** Sólo este servicio (como provider) y sus consumidores. */
  readonly service?: string;
  /** Sólo vínculos de este tipo de binding: static | heuristic. */
  readonly binding?: string;
  /** Descarta vínculos con confianza menor. */
  readonly minConfidence?: number;
}

export function endpointNodeId(key: string, service: string): string {
  return `ep:${key}@${service}`;
}

export function serviceNodeId(service: string): string {
  return `svc:${service}`;
}

export function contractKind(key: string): string {
  return key.includes(':') ? (key.split(':')[0] ?? 'unknown') : 'unknown';
}

interface ContractItem {
  endpoint: { key: string; service: string };
  has_schema?: boolean;
  bound_consumers?: number;
  providers?: Array<Record<string, unknown>>;
}

interface ContractConsumer {
  caller?: { repo?: string; name?: string; path?: string; line?: number; id?: string };
  binding?: { confidence?: number; kind?: string; source?: string };
  match?: string;
  reads?: Array<{ json_path?: string }>;
}

interface ContractDetail {
  endpoint?: { key: string; service: string };
  consumers?: ContractConsumer[];
  providers?: Array<Record<string, unknown>>;
  schemas?: unknown[];
}

export async function buildEndpointTopology(
  adapter: LainAdapter,
  filters: TopologyFilters = {},
  snapshot: LainView = 'live',
): Promise<TopologyResult> {
  const services = await adapter.listServices({ snapshot });
  const contracts = await adapter.listContracts({
    snapshot,
    ...(filters.kind ? { kind: filters.kind as never } : {}),
    ...(filters.service ? { service: filters.service } : {}),
  });

  const items = (contracts.items ?? []) as unknown as ContractItem[];

  const nodes = new Map<string, TopologyNode>();
  const edges: TopologyEdge[] = [];
  const edgeKeys = new Set<string>();
  const repos = new Set<string>();
  const byKind: Record<string, number> = {};

  for (const s of services.items) {
    repos.add(s.repo);
    nodes.set(serviceNodeId(s.service), {
      id: serviceNodeId(s.service),
      label: s.service,
      kind: 'service',
      meta: {
        repo: s.repo,
        endpoints: s.endpoints,
        consumerServices: s.consumer_services,
      },
    });
  }

  for (const item of items) {
    const key = item.endpoint.key;
    const owner = item.endpoint.service;
    const kind = contractKind(key);
    byKind[kind] = (byKind[kind] ?? 0) + 1;

    const epId = endpointNodeId(key, owner);
    if (!nodes.has(epId)) {
      nodes.set(epId, {
        id: epId,
        label: key,
        kind: 'endpoint',
        meta: {
          service: owner,
          contractKind: kind,
          hasSchema: item.has_schema ?? false,
          boundConsumers: item.bound_consumers ?? 0,
          providers: item.providers ?? [],
        },
      });
    }
    // El servicio que expone el endpoint.
    const ownerId = serviceNodeId(owner);
    if (!nodes.has(ownerId)) {
      nodes.set(ownerId, {
        id: ownerId,
        label: owner,
        kind: 'service',
        meta: { repo: null },
      });
    }
    const providesKey = `provides:${ownerId}->${epId}`;
    if (!edgeKeys.has(providesKey)) {
      edgeKeys.add(providesKey);
      edges.push({
        source: ownerId,
        target: epId,
        kind: 'provides',
        label: item.has_schema ? 'schema' : 'no schema',
        meta: { hasSchema: item.has_schema ?? false },
      });
    }

    // Quién lo consume, con el campo que lee.
    const detail = (await adapter.getContract({ snapshot, key })) as unknown as {
      items?: ContractDetail[];
    };
    for (const d of detail.items ?? []) {
      for (const c of d.consumers ?? []) {
        const callerRepo = c.caller?.repo ?? '';
        // Un servicio que se consume a sí mismo es una lectura interna, no un
        // vínculo de topología.
        if (callerRepo && callerRepo === owner) continue;

        const confidence = c.binding?.confidence ?? 1;
        const bindingKind = c.binding?.kind ?? 'static';
        if (filters.binding && bindingKind !== filters.binding) continue;
        if (filters.minConfidence !== undefined && confidence < filters.minConfidence) continue;

        const consumerService = callerRepo || c.caller?.name || 'unknown';
        const consumerId = serviceNodeId(consumerService);
        if (!nodes.has(consumerId)) {
          nodes.set(consumerId, {
            id: consumerId,
            label: consumerService,
            kind: 'service',
            meta: { repo: callerRepo || null },
          });
        }
        if (callerRepo) repos.add(callerRepo);

        const surfaces = (c.reads ?? [])
          .map((r) => r.json_path)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);
        const eKey = `consumes:${consumerId}->${epId}`;
        if (edgeKeys.has(eKey)) continue;
        edgeKeys.add(eKey);

        edges.push({
          source: consumerId,
          target: epId,
          kind: 'consumes',
          // El rótulo dice qué consume, no el transporte: "customer_id" y no
          // "http:ANY /".
          label: surfaces.length > 0 ? surfaces.slice(0, 3).join(', ') : (c.match ?? 'uses'),
          meta: {
            binding: bindingKind,
            confidence,
            source: c.binding?.source ?? null,
            match: c.match ?? null,
            fields: surfaces,
            callSite: c.caller?.id ?? null,
            callerPath: c.caller?.path ?? null,
            callerLine: c.caller?.line ?? null,
          },
        });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    stats: {
      services: [...nodes.values()].filter((n) => n.kind === 'service').length,
      endpoints: [...nodes.values()].filter((n) => n.kind === 'endpoint').length,
      dependencies: edges.filter((e) => e.kind === 'consumes').length,
      repos: [...repos],
      byKind,
    },
  };
}
