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

export type NodeKind = 'repo' | 'service' | 'group' | 'endpoint';
/** Sitios de llamada que se conservan por endpoint consumido. */
const MAX_SITES = 3;

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

export function groupNodeId(service: string, group: string): string {
  return `grp:${service}:${group}`;
}

/** Grupo de contratos bajo un servicio: lo que el usuario entiende, no lo que el sensor emite. */
export interface ContractGroup {
  key: string;
  label: string;
  /** Qué significa el grupo (se muestra al seleccionarlo); sólo si hay algo que aclarar. */
  note?: string;
}

/**
 * A qué grupo pertenece un contrato. La clave del motor decide el tipo
 * (GraphQL query/mutation, tarea Celery, HTTP…). Las rutas HTTP SIN método
 * ("ANY") que nadie llama se separan: el sensor de rutas de LAIN también
 * reporta cadenas con forma de ruta (nombres de evento del navegador, datos de
 * prueba), y mezclarlas con las rutas reales llena el mapa de ruido. No se
 * esconden ni se borran: van a su propio grupo, rotulado, y siguen siendo
 * contratos del motor.
 */
export function contractGroup(key: string, boundConsumers: number): ContractGroup {
  const kind = contractKind(key);
  const rest = key.slice(kind.length + 1);
  if (kind === 'graphql') {
    const op = rest.split(':')[0];
    if (op === 'query') return { key: 'gql-query', label: 'GraphQL queries' };
    if (op === 'mutation') return { key: 'gql-mutation', label: 'GraphQL mutations' };
    if (op === 'subscription') return { key: 'gql-subscription', label: 'GraphQL subscriptions' };
    return { key: 'gql-other', label: 'GraphQL (other)' };
  }
  if (kind === 'topic') {
    return rest.startsWith('celery/')
      ? { key: 'celery', label: 'Celery tasks' }
      : { key: 'topic', label: 'Topics and events' };
  }
  if (kind === 'http') {
    if (rest.startsWith('ANY ') && boundConsumers === 0) {
      return {
        key: 'http-methodless',
        label: 'HTTP patterns (no method)',
        note: 'Route-like strings the engine found with no HTTP method, and nothing calls them. In browser code these are usually event names or test data, not real routes; in server code they can be catch-all URL patterns. Shown separately so they do not mix with real routes.',
      };
    }
    return { key: 'http', label: 'HTTP routes' };
  }
  return { key: `other-${kind}`, label: `Other contracts (${kind})` };
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

export async function buildEndpointTopology(
  adapter: LainAdapter,
  filters: TopologyFilters = {},
  snapshot: LainView = 'live',
): Promise<TopologyResult> {
  const services = await adapter.listServices({ snapshot });

  // list_contracts pagina: hay que seguir el cursor o el grafo queda mudo
  // (en Saleor, la primera página trae 50 de 500 contratos y ninguna
  // dependencia).
  const allContracts: ContractItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await adapter.listContracts({
      snapshot,
      ...(filters.kind ? { kind: filters.kind as never } : {}),
      ...(filters.service ? { service: filters.service } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 500,
    });
    allContracts.push(...((page.items ?? []) as unknown as ContractItem[]));
    cursor = (page as { cursor?: string | null }).cursor ?? undefined;
  } while (cursor);

  const items = allContracts;

  const nodes = new Map<string, TopologyNode>();
  const edges: TopologyEdge[] = [];
  const edgeKeys = new Set<string>();
  const byKind: Record<string, number> = {};
  const serviceRepo = new Map<string, string>();
  // key de contrato → servicio dueño, en orden de alta (el primero gana).
  const endpointOwner = new Map<string, string>();

  // Cada endpoint cuelga de un GRUPO del servicio (queries, mutaciones, tareas, rutas…).
  const ensureGroup = (service: string, key: string, bound: number): string => {
    const g = contractGroup(key, bound);
    const id = groupNodeId(service, g.key);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        label: g.label,
        kind: 'group',
        parent: serviceNodeId(service),
        meta: {
          service,
          group: g.key,
          contractKind: contractKind(key),
          ...(g.note ? { note: g.note } : {}),
        },
      });
    }
    return id;
  };

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
    if (!endpointOwner.has(key)) endpointOwner.set(key, owner);
    const definePath = item.providers?.[0]?.path ?? null;
    nodes.set(epId, {
      id: epId,
      label: key,
      kind: 'endpoint',
      // El endpoint cuelga de un grupo del servicio que lo expone; así colapsar
      // el repo (o el servicio, o el grupo) oculta también sus contratos.
      parent: ensureGroup(owner, key, item.bound_consumers ?? 0),
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
  }

  // Consumos: una pasada por SERVICIO con get_service. Es donde LAIN
  // resuelve los vínculos (en Saleor, 762 usos graphql de dashboard a api),
  // mientras que get_contract por endpoint no devuelve consumidores.
  for (const s of services.items) {
    const detail = await adapter.getService({ snapshot, service: s.service });
    for (const c of detail.consumers) {
      const callerRepo = c.repo ?? '';
      // Lectura interna del propio servicio: no es dependencia.
      if (callerRepo && callerRepo === s.service) continue;

      const consumerService =
        resolveServiceForPath(c.uses[0]?.caller?.path, serviceIndex) ??
        c.service ??
        callerRepo ??
        'unknown';
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

      // Agrupa por endpoint consumido: un consumidor puede tocar varios.
      const byEndpoint = new Map<
        string,
        {
          fields: string[];
          binding: string;
          confidence: number;
          useCount: number;
          staticUses: number;
          heuristicUses: number;
          sites: Array<{ repo?: string; path: string; line?: number }>;
        }
      >();
      for (const u of c.uses) {
        const ekey = u.endpoint?.key;
        if (!ekey) continue;
        const ownerOfKey = u.endpoint?.service ?? s.service;
        const bindingKind = u.binding?.kind ?? 'static';
        const confidence = u.binding?.confidence ?? 1;
        if (filters.binding && bindingKind !== filters.binding) continue;
        if (filters.minConfidence !== undefined && confidence < filters.minConfidence) continue;

        const acc = byEndpoint.get(ekey) ?? {
          fields: [] as string[],
          binding: bindingKind,
          confidence,
          useCount: 0,
          staticUses: 0,
          heuristicUses: 0,
          sites: [] as Array<{ repo?: string; path: string; line?: number }>,
        };
        acc.useCount++;
        const at = u.caller ?? u.site;
        if (
          at?.path &&
          acc.sites.length < MAX_SITES &&
          !acc.sites.some((x) => x.path === at.path && x.line === at.line)
        ) {
          acc.sites.push({
            ...(at.repo ? { repo: at.repo } : {}),
            path: at.path,
            ...(at.line ? { line: at.line } : {}),
          });
        }
        // Procedencia por uso: un vínculo mixto no se etiqueta con el primer
        // uso que apareció; el mapa necesita saber cuánto es duro y cuánto no.
        if (bindingKind === 'heuristic') acc.heuristicUses++;
        else acc.staticUses++;
        acc.confidence = Math.max(acc.confidence, confidence);
        for (const f of u.fields ?? []) if (f && !acc.fields.includes(f)) acc.fields.push(f);
        byEndpoint.set(ekey, acc);

        // El endpoint puede ser de otro servicio (cross-service); si no está
        // en el inventario, lo damos de alta para no perder la arista.
        const epId = endpointNodeId(ekey, ownerOfKey);
        if (!nodes.has(epId)) {
          nodes.set(epId, {
            id: epId,
            label: ekey,
            kind: 'endpoint',
            // Alguien lo consume (por eso está aquí): no es un patrón huérfano.
            parent: ensureGroup(ownerOfKey, ekey, 1),
            meta: { service: ownerOfKey, contractKind: contractKind(ekey) },
          });
          byKind[contractKind(ekey)] = (byKind[contractKind(ekey)] ?? 0) + 1;
          if (!endpointOwner.has(ekey)) endpointOwner.set(ekey, ownerOfKey);
        }
      }

      for (const [ekey, acc] of byEndpoint) {
        const ownerOfKey = endpointOwner.get(ekey);
        const epId = endpointNodeId(ekey, ownerOfKey ?? s.service);

        // 1) consumidor → endpoint
        const eKey = `consumes:${consumerId}->${epId}`;
        if (!edgeKeys.has(eKey)) {
          edgeKeys.add(eKey);
          edges.push({
            source: consumerId,
            target: epId,
            kind: 'consumes',
            label: acc.fields.length > 0 ? acc.fields.slice(0, 3).join(', ') : 'uses',
            meta: {
              binding: acc.binding,
              confidence: acc.confidence,
              fields: acc.fields,
              useCount: acc.useCount,
              staticUses: acc.staticUses,
              heuristicUses: acc.heuristicUses,
              sites: acc.sites,
            },
          });
        }

        // 2) endpoint → proveedor: cierra la cadena y convierte el radio en red.
        const targetService = ownerOfKey ?? s.service;
        const servedKey = `servedBy:${epId}->${serviceNodeId(targetService)}`;
        if (!edgeKeys.has(servedKey)) {
          edgeKeys.add(servedKey);
          edges.push({
            source: epId,
            target: serviceNodeId(targetService),
            kind: 'servedBy',
            label: 'served by',
            meta: { relation: 'servedBy' },
          });
        }
      }
    }
  }

  // Cuántos contratos tiene cada grupo (el mapa lo muestra sin abrirlo).
  const perGroup = new Map<string, number>();
  for (const n of nodes.values()) {
    if (n.kind === 'endpoint' && n.parent)
      perGroup.set(n.parent, (perGroup.get(n.parent) ?? 0) + 1);
  }
  for (const n of nodes.values()) {
    if (n.kind === 'group') n.meta = { ...n.meta, contracts: perGroup.get(n.id) ?? 0 };
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
