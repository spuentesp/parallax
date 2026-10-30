import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { deriveLainRepoId } from './code-graph.js';
import * as schema from './db/schema.js';
import { getLainClient, type LainClientConfig } from './lain-adapter/client.js';
import { isLainCallError } from './lain-adapter/errors.js';
import type { LainAdapter } from './lain-adapter/types.js';
import { annotateRepos, type OrgGraph, toOrgGraph } from './org-graph.js';
import { OrgGraphCache } from './org-graph-cache.js';
import { buildEndpointTopology } from './topology.js';

// Quién construye y cachea el grafo del mapa por workspace. Lo comparten las
// rutas del mapa y /api/query: así el agente sólo apunta a nodos que el mapa
// realmente tiene (mismo grafo, mismos ids, misma caché).

export const CACHE_TTL_MS = 5 * 60_000;

export type LoadedOrgGraph =
  | { ok: true; graph: OrgGraph; meta: Record<string, unknown> }
  | { ok: false; source: 'none' | 'unconfigured' | 'error'; error?: string };

export interface OrgGraphService {
  load(workspaceId: string, refresh: boolean): Promise<LoadedOrgGraph>;
  /** El workspace cambió (repos, LAIN): el grafo cacheado ya no vale. */
  invalidate(workspaceId: string): void;
}

export function createOrgGraphService(deps: {
  db: BetterSQLite3Database<typeof schema>;
  ttlMs?: number;
  now?: () => number;
  /** Transporte hacia LAIN; por defecto el pool real. Se inyecta en los tests. */
  getClient?: (config: LainClientConfig) => Promise<LainAdapter>;
}): OrgGraphService {
  const cache = new OrgGraphCache({
    ttlMs: deps.ttlMs ?? CACHE_TTL_MS,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const getClient = deps.getClient ?? getLainClient;

  return {
    invalidate(workspaceId) {
      cache.invalidatePrefix(`${workspaceId}|`);
    },
    async load(workspaceId, refresh) {
      const rows = await deps.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, workspaceId))
        .limit(1);
      const ws = rows[0];
      if (!ws) return { ok: false, source: 'none' };
      if (!ws.lainUrl) return { ok: false, source: 'unconfigured' };
      const lainUrl = ws.lainUrl;

      const repos = await deps.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, workspaceId));
      const lainRepoIds = new Set(repos.map((r) => deriveLainRepoId(r)));

      const build = async (): Promise<OrgGraph> => {
        const client = await getClient({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });
        return annotateRepos(toOrgGraph(await buildEndpointTopology(client)), lainRepoIds);
      };
      const key = `${ws.id}|${lainUrl}|live`;
      try {
        const cached = refresh ? await cache.refresh(key, build) : await cache.get(key, build);
        return {
          ok: true,
          graph: cached.graph,
          meta: {
            source: 'lain',
            lainUrl,
            generatedAt: cached.generatedAt,
            stale: cached.stale,
            refreshing: cached.refreshing,
            ...(cached.lastError !== undefined ? { lastError: cached.lastError } : {}),
          },
        };
      } catch (e) {
        return {
          ok: false,
          source: 'error',
          error: isLainCallError(e)
            ? e.message
            : e instanceof Error
              ? e.message
              : 'lain unreachable',
        };
      }
    },
  };
}
