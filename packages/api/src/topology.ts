import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from './lain-adapter/types.js';

// Topología como red de dependencias, no como soles.
//
// El error anterior: todas las aristas apuntaban al endpoint (provider y
// consumidor), así que cada endpoint quedaba como centro de un radio y el
// grafo se leía como estrellas sueltas. La lectura correcta de una
// dependencia es una CADENA:
//
//     consumidor  ──consumes──▶  endpoint  ──served by──▶  proveedor
//
// Eso hace que cada endpoint tenga una entrada y una salida, y que el grafo
// se lea como flujo entre servicios.
//
// Además los repos son nodos contenedores colapsables: repo → servicio →
// endpoint. Colapsar un repo oculta lo que contiene y las aristas que
// dependen de ello.

export type NodeKind = 'repo' | 'service' | 'endpoint';
export type EdgeKind = 'contains' | 'consumes' | 'servedBy';

export interface TopologyNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Nodo padre en la jerarquía colapsable (repo → servicio → endpoint). */
  parent: string | null;
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: EdgeKind;
  meta?: Record<string, unknown>;
}

export interface TopologyStats {
  repos: number;
  services: number;
  endpoints: number;
  dependencies: number;
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
  /** Sólo este servicio (como proveedor) y sus consumidores. */
  readonly service?: string;
  /** Sólo vínculos de este tipo de binding: static | heuristic. */
  readonly binding?: string;
  /** Descarta vínculos con confianza menor. */
  readonly minConfidence?: number;
}

export function repoNodeId(repo: string): string {
  return `repo:${repo}`;
}
export function serviceNodeId(service: string): string {
  return `svc:${service}`;
}
export function endpointNodeId(key: string, service: string): string {
  return `ep:${key}@${service}`;
}

export function contractKind(key: string): string {
  return key.includes(':') ? (key.split(':')[0] ?? 'unknown') : 'unknown';
}

/**
 * A qué servicio pertenece un archivo, según los `paths` que declaró la
 * configuración. En un monorepo esto distingue `services/shipping/main.py` de
 * `services/inventory/…` en vez de achacar todo al repo.
 */
export function resolveServiceForPath(
  path: string | undefined,
  index: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (!path) return null;
  let best: { service: string; len: number } | null = null;
  for (const [service, paths] of index) {
    for (const p of paths) {
      if (p && path.startsWith(p) && (!best || p.length > best.len)) {
        best = { service, len: p.length };
      }
    }
  }
  return best?.service ?? null;
}

interface ContractItem {
  endpoint: { key: string; service: string };
  has_schema?: boolean;
  bound_consumers?: number;
  providers?: Array<{ repo?: string; path?: string; line?: number }>;
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
  providers?: Array<{ repo?: string; path?: string; line?: number; id?: string }>;
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
  const byKind: Record<string, number> = {};
  const serviceRepo = new Map<string, string>();

  const ensureRepo = (repo: string | null | undefined): string | null => {
    if (!repo) return null;
    const id = repoNodeId(repo);
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: repo, kind: 'repo', parent: null, meta: {} });
    }
    return id;
  };

  // Servicios: cada uno cuelga de su repo.
  const serviceIndex = new Map<string, readonly string[]>();
  for (const s of services.items) {
    serviceRepo.set(s.service, s.repo);
    if (s.paths && s.paths.length > 0) serviceIndex.set(s.service, s.paths);
    const parent = ensureRepo(s.repo);
    nodes.set(serviceNodeId(s.service), {
      id: serviceNodeId(s.service),
      label: s.service,
      kind: 'service',
      parent,
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

    const ownerId = serviceNodeId(owner);
    const ownerRepo = serviceRepo.get(owner) ?? item.providers?.[0]?.repo ?? null;
    const ownerRepoId = ensureRepo(ownerRepo);
    if (!nodes.has(ownerId)) {
      nodes.set(ownerId, {
        id: ownerId,
        label: owner,
        kind: 'service',
        parent: ownerRepoId,
        meta: { repo: ownerRepo },
      });
    }

    const epId = endpointNodeId(key, owner);
    const definePath = item.providers?.[0]?.path ?? null;
    nodes.set(epId, {
      id: epId,
      label: key,
      kind: 'endpoint',
      // El endpoint cuelga del servicio que lo expone; así colapsar el repo
      // oculta también sus contratos.
      parent: ownerId,
      meta: {
        service: owner,
        contractKind: kind,
        hasSchema: item.has_schema ?? false,
        boundConsumers: item.bound_consumers ?? 0,
        definedAt: definePath,
        providers: item.providers ?? [],
      },
    });

    // Jerarquía: servicio expone el endpoint. Se dibuja tenue porque la
    // información está en la cadena de dependencia.
    const exposeKey = `exposes:${ownerId}->${epId}`;
    if (!edgeKeys.has(exposeKey)) {
      edgeKeys.add(exposeKey);
      edges.push({
        source: ownerId,
        target: epId,
        kind: 'contains',
        meta: { relation: 'exposes' },
      });
    }

    // Cadena de dependencia: consumidor → endpoint → proveedor.
    const detail = (await adapter.getContract({ snapshot, key })) as unknown as {
      items?: ContractDetail[];
    };
    for (const d of detail.items ?? []) {
      for (const c of d.consumers ?? []) {
        const callerRepo = c.caller?.repo ?? '';
        // Lectura interna del propio servicio: no es dependencia.
        if (callerRepo && callerRepo === owner) continue;

        const confidence = c.binding?.confidence ?? 1;
        const bindingKind = c.binding?.kind ?? 'static';
        if (filters.binding && bindingKind !== filters.binding) continue;
        if (filters.minConfidence !== undefined && confidence < filters.minConfidence) continue;

        // El consumidor es el servicio dueño del archivo que llama, no el
        // repo: en un monorepo, services/shipping/main.py llama a inventory y
        // nombrar la dependencia "platform → inventory" esconde el módulo.
        const consumerService = resolveServiceForPath(c.caller?.path, serviceIndex) ?? callerRepo ?? c.caller?.name ?? 'unknown';
        const consumerId = serviceNodeId(consumerService);
        const consumerRepoId = ensureRepo(callerRepo || null);
        if (!nodes.has(consumerId)) {
          nodes.set(consumerId, {
            id: consumerId,
            label: consumerService,
            kind: 'service',
            parent: consumerRepoId,
            meta: { repo: callerRepo || null },
          });
        }

        const fields = (c.reads ?? [])
          .map((r) => r.json_path)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);

        // 1) consumidor → endpoint
        const eKey = `consumes:${consumerId}->${epId}`;
        if (!edgeKeys.has(eKey)) {
          edgeKeys.add(eKey);
          edges.push({
            source: consumerId,
            target: epId,
            kind: 'consumes',
            label: fields.length > 0 ? fields.slice(0, 3).join(', ') : (c.match ?? 'uses'),
            meta: {
              binding: bindingKind,
              confidence,
              source: c.binding?.source ?? null,
              match: c.match ?? null,
              fields,
              callSite: c.caller?.id ?? null,
              callerPath: c.caller?.path ?? null,
              callerLine: c.caller?.line ?? null,
            },
          });
        }

        // 2) endpoint → proveedor: es lo que cierra la cadena y convierte el
        //    radio en red.
        const servedKey = `servedBy:${epId}->${ownerId}`;
        if (!edgeKeys.has(servedKey)) {
          edgeKeys.add(servedKey);
          edges.push({
            source: epId,
            target: ownerId,
            kind: 'servedBy',
            label: 'served by',
            meta: { relation: 'servedBy' },
          });
        }
      }
    }
  }

  const all = [...nodes.values()];
  return {
    nodes: all,
    edges,
    stats: {
      repos: all.filter((n) => n.kind === 'repo').length,
      services: all.filter((n) => n.kind === 'service').length,
      endpoints: all.filter((n) => n.kind === 'endpoint').length,
      dependencies: edges.filter((e) => e.kind === 'consumes').length,
      byKind,
    },
  };
}
