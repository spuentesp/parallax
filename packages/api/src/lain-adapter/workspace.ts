// Resolvedor de adaptadores LAIN por organización. Cada workspace tiene su
// propio servidor LAIN (workspace.lainUrl); analizar o investigar contra el
// adapter global (mock en dev) produciría datos inventados — por eso el
// AssessmentWorker y el investigador de /api/query comparten este resolvedor.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { createLainClient } from './client.js';
import type { LainAdapter } from './types.js';

export type WorkspaceLainResolver = (orgId: string) => Promise<LainAdapter | undefined>;

export function createWorkspaceLainResolver(deps: {
  db: BetterSQLite3Database<typeof schema>;
  defaultAdapter: LainAdapter;
  /** Cómo se crea el cliente (por defecto el real); permite inyectar el borde en tests. */
  createClient?: typeof createLainClient;
}): WorkspaceLainResolver {
  const cache = new Map<string, LainAdapter>();
  return async (orgId: string): Promise<LainAdapter | undefined> => {
    const cached = cache.get(orgId);
    if (cached) return cached;
    const rows = await deps.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, orgId))
      .limit(1);
    const lainUrl = rows[0]?.lainUrl;
    if (!lainUrl) {
      // Un workspace sin LAIN propio usa el adapter configurado por defecto
      // (mock en desarrollo, real si LAIN_ADAPTER=real).
      return deps.defaultAdapter;
    }
    const adapter = await (deps.createClient ?? createLainClient)({
      lainUrl,
      apiVersion: '1',
      timeoutMs: 30_000,
    });
    cache.set(orgId, adapter);
    return adapter;
  };
}
