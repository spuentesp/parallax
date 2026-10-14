// Correlación señales ↔ motor (§4-2 del contrato). La paginación de
// list_unresolved y list_contracts es OBLIGATORIA: sumar una sola página es
// un error — ese exacto error produjo el informe falso de "storefront tiene
// 0 ítems" (eran 78, repartidas en el cursor).

import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from '../lain-adapter/types.js';
import type {
  AdvisorSignal,
  ContractItem,
  Correlation,
  EnvUnmappedCorrelation,
  ProviderGroup,
  UnresolvedItem,
} from './types.js';

const PAGE_LIMIT = 1000;
const MAX_PAGES = 200;

/** Navega el subset del adaptador que el advisor necesita. */
export interface CorrelationEngine {
  listUnresolved: LainAdapter['listUnresolved'];
  listContracts: LainAdapter['listContracts'];
}

export interface DecodedGlobalId {
  readonly repo: string;
  readonly nodeType: string;
  readonly path: string;
  readonly name: string;
  readonly line: number;
}

/**
 * GlobalId del motor: `repo:Type:path:encoded-name:line`. El nombre del nodo
 * viene URL-encoded dentro del id (`graphql-call%3Aquery%3Aproduct`) — hay
 * que decodificarlo para derivar las llaves.
 */
export function decodeGlobalId(id: string): DecodedGlobalId | null {
  const parts = id.split(':');
  if (parts.length < 5) return null;
  const repo = parts[0] ?? '';
  const nodeType = parts[1] ?? '';
  const lineRaw = parts[parts.length - 1] ?? '';
  const nameRaw = parts[parts.length - 2] ?? '';
  const path = parts.slice(2, parts.length - 2).join(':');
  const line = Number.parseInt(lineRaw, 10);
  if (!repo || !path || !Number.isFinite(line)) return null;
  let name: string;
  try {
    name = decodeURIComponent(nameRaw);
  } catch {
    name = nameRaw;
  }
  return { repo, nodeType, path, name, line };
}

/** `graphql-call:query:product` → `graphql:query:product`; null si no es GraphQL. */
export function derivedKeyFromNodeName(name: string): string | null {
  if (!name.startsWith('graphql-call:')) return null;
  const rest = name.slice('graphql-call:'.length);
  return rest ? `graphql:${rest}` : null;
}

export async function fetchAllUnresolved(
  engine: CorrelationEngine,
  args: { snapshot: LainView; repo?: string },
): Promise<UnresolvedItem[]> {
  const items: UnresolvedItem[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await engine.listUnresolved({
      snapshot: args.snapshot,
      ...(args.repo ? { repo: args.repo } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_LIMIT,
    });
    items.push(...(page.items as unknown as UnresolvedItem[]));
    cursor = (page as { cursor?: string | null }).cursor ?? undefined;
    pages++;
    if (pages > MAX_PAGES) {
      throw new Error(`list_unresolved no se agotó en ${MAX_PAGES} páginas`);
    }
  } while (cursor);
  return items;
}

export async function fetchAllContracts(
  engine: CorrelationEngine,
  args: { snapshot: LainView },
): Promise<ContractItem[]> {
  const items: ContractItem[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await engine.listContracts({
      snapshot: args.snapshot,
      ...(cursor ? { cursor } : {}),
      limit: PAGE_LIMIT,
    });
    items.push(...(page.items as unknown as ContractItem[]));
    cursor = (page as { cursor?: string | null }).cursor ?? undefined;
    pages++;
    if (pages > MAX_PAGES) {
      throw new Error(`list_contracts no se agotó en ${MAX_PAGES} páginas`);
    }
  } while (cursor);
  return items;
}

/** Agrupa los contratos por llave: cada servicio expone la llave con sus archivos. */
export function groupProviderContracts(
  contracts: readonly ContractItem[],
): Map<string, ProviderGroup[]> {
  const byKey = new Map<string, ProviderGroup[]>();
  for (const item of contracts) {
    const { key, service } = item.endpoint;
    const groups = byKey.get(key) ?? [];
    const idx = groups.findIndex((g) => g.service === service);
    const providers = item.providers ?? [];
    if (idx >= 0) {
      const existing = groups[idx];
      if (existing) {
        groups[idx] = {
          ...existing,
          boundConsumers: existing.boundConsumers + (item.bound_consumers ?? 0),
          providers: [...existing.providers, ...providers],
        };
      }
    } else {
      groups.push({
        service,
        key,
        boundConsumers: item.bound_consumers ?? 0,
        providers: [...providers],
      });
    }
    byKey.set(key, groups);
  }
  return byKey;
}

function matchEnvVarFromExpr(expr: string): string | null {
  const m = expr.match(/process\.env\.([A-Za-z0-9_]+)/);
  return m?.[1] ?? null;
}

/**
 * Correlaciona las señales del checkout con lo que el motor reporta. Para
 * cada ítem `graphql_no_op` deriva la llave desde el GlobalId decodificado y
 * la busca entre las señales escaneadas; para las llaves con proveedores
 * múltiples deja los grupos que disparan el `graphql_no_op`.
 */
export function correlate(
  signals: readonly AdvisorSignal[],
  unresolved: readonly UnresolvedItem[],
  contracts: readonly ContractItem[],
): Correlation {
  const byReason: Record<string, number> = {};
  const byRepoReason: Record<string, Record<string, number>> = {};
  for (const item of unresolved) {
    byReason[item.reason] = (byReason[item.reason] ?? 0) + 1;
    const repo = item.consumer.repo ?? 'unknown';
    const perRepo = byRepoReason[repo] ?? {};
    perRepo[item.reason] = (perRepo[item.reason] ?? 0) + 1;
    byRepoReason[repo] = perRepo;
  }

  // Índice de operaciones escaneadas: repo|path|llave → señal.
  const opIndex = new Map<string, AdvisorSignal>();
  for (const s of signals) {
    if (s.kind !== 'graphql_operations' || !s.derivedKey) continue;
    opIndex.set(`${s.repo}|${s.file}|${s.derivedKey}`, s);
  }

  const byKey: Record<string, number> = {};
  const byRepoKeys = new Map<string, Set<string>>();
  const byRepoStats = new Map<string, { total: number; matched: number }>();
  const unmatched: Array<{ repo: string; path: string; key: string; consumerId: string }> = [];
  let graphqlTotal = 0;
  let matched = 0;
  const envUnmapped: EnvUnmappedCorrelation[] = [];

  for (const item of unresolved) {
    const decoded = decodeGlobalId(item.consumer.id);
    if (!decoded) continue;
    if (item.reason === 'graphql_no_op') {
      graphqlTotal++;
      const stats = byRepoStats.get(decoded.repo) ?? { total: 0, matched: 0 };
      stats.total++;
      byRepoStats.set(decoded.repo, stats);
      const key = derivedKeyFromNodeName(decoded.name);
      if (!key) continue;
      byKey[key] = (byKey[key] ?? 0) + 1;
      const keys = byRepoKeys.get(decoded.repo) ?? new Set<string>();
      keys.add(key);
      byRepoKeys.set(decoded.repo, keys);
      if (opIndex.has(`${decoded.repo}|${decoded.path}|${key}`)) {
        matched++;
        stats.matched++;
      } else {
        unmatched.push({
          repo: decoded.repo,
          path: decoded.path,
          key,
          consumerId: item.consumer.id,
        });
      }
    } else if (item.reason === 'env_unmapped') {
      const expr = item.url_expr ?? item.template ?? '';
      const varName = matchEnvVarFromExpr(expr);
      const entry: EnvUnmappedCorrelation = {
        repo: decoded.repo,
        consumerId: item.consumer.id,
        envExpr: expr,
        ...(varName ? { matchedVar: varName } : {}),
        ...(item.target_service ? { targetService: item.target_service } : {}),
      };
      envUnmapped.push(entry);
    }
  }

  const byRepo: Record<string, { total: number; matched: number; keys: number }> = {};
  for (const [repo, stats] of [...byRepoStats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byRepo[repo] = { ...stats, keys: byRepoKeys.get(repo)?.size ?? 0 };
  }

  const providersByKey = groupProviderContracts(contracts);
  const providerGroups: Array<{ key: string; groups: readonly ProviderGroup[] }> = [];
  const duplicatedKeys: string[] = [];
  for (const [key, groups] of [...providersByKey.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!key.startsWith('graphql:')) continue;
    providerGroups.push({ key, groups });
    if (groups.length > 1) duplicatedKeys.push(key);
  }

  return {
    unresolvedTotal: unresolved.length,
    byReason,
    byRepoReason,
    graphqlNoOp: {
      total: graphqlTotal,
      matchedToSignals: matched,
      unmatched,
      byKey,
      byRepo,
    },
    envUnmapped,
    providerGroups,
    duplicatedKeys,
  };
}
