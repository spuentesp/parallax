import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema.js';
import { getLainClient } from './lain-adapter/client.js';
import { isLainCallError } from './lain-adapter/errors.js';
import { type OrgGraph, toOrgGraph } from './org-graph.js';
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
}

export function createOrgGraphService(deps: {
  db: BetterSQLite3Database<typeof schema>;
  ttlMs?: number;
}): OrgGraphService {
  const cache = new OrgGraphCache({ ttlMs: deps.ttlMs ?? CACHE_TTL_MS });

  return {
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

      const build = async (): Promise<OrgGraph> => {
        const client = await getLainClient({ lainUrl, apiVersion: '1', timeoutMs: 20_000 });
        return toOrgGraph(await buildEndpointTopology(client));
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
