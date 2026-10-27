import type { OrgGraph } from './org-graph.js';

// Caché del grafo COMPLETO (sin filtros) por workspace + vista. Construir la
// topología pagina todos los contratos y hace una llamada get_service por
// servicio: es caro y no depende de los filtros, que se aplican en memoria
// (org-graph.ts). Política:
//
//   - fresco (edad ≤ ttl): se sirve tal cual.
//   - viejo (edad > ttl): se sirve YA el último grafo, marcado `stale`, y se
//     reconstruye en segundo plano (stale-while-revalidate). El mapa nunca se
//     queda esperando al motor con algo utilizable en memoria.
//   - refresh(): reconstrucción explícita, que sí espera.
//   - una reconstrucción fallida conserva el grafo anterior y expone el error;
//     nunca lo reemplaza por uno vacío (un fallo no es "cero relaciones").
//   - las reconstrucciones concurrentes de la misma clave se comparten.

export interface CachedGraph {
  graph: OrgGraph;
  /** ms epoch de la construcción que produjo `graph`. */
  generatedAt: number;
  /** true si superó el ttl (se está reconstruyendo en segundo plano). */
  stale: boolean;
  /** Último intento fallido de reconstrucción, si lo hubo tras `generatedAt`. */
  lastError?: string;
  refreshing: boolean;
}

interface Entry {
  graph: OrgGraph;
  generatedAt: number;
  lastError?: string;
}

export interface OrgGraphCacheOptions {
  ttlMs: number;
  now?: () => number;
}

export class OrgGraphCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: OrgGraphCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  /** Último grafo en caché, construyéndolo (esperando) sólo si no hay ninguno. */
  async get(key: string, build: () => Promise<OrgGraph>): Promise<CachedGraph> {
    let entry = this.entries.get(key);
    if (!entry) {
      // La primera construcción sí se espera, y si falla el error llega tal
      // cual: no hay grafo anterior que servir en su lugar.
      await this.rebuild(key, build);
      entry = this.entries.get(key);
      if (!entry) throw new Error('org graph build failed');
    }
    const stale = this.now() - entry.generatedAt > this.ttlMs;
    if (stale && !this.pending.has(key)) {
      // Segundo plano: el error queda en la entrada, no en quien pidió el mapa.
      void this.rebuild(key, build).catch(() => undefined);
    }
    return this.snapshot(key, entry, stale);
  }

  /** Reconstrucción explícita: espera y devuelve el grafo nuevo. */
  async refresh(key: string, build: () => Promise<OrgGraph>): Promise<CachedGraph> {
    let failure: unknown;
    await this.rebuild(key, build).catch((e: unknown) => {
      failure = e;
    });
    const entry = this.entries.get(key);
    // Sin grafo previo y con la construcción caída: el error, no un grafo vacío.
    if (!entry) throw failure instanceof Error ? failure : new Error('org graph build failed');
    return this.snapshot(key, entry, false);
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  private snapshot(key: string, entry: Entry, stale: boolean): CachedGraph {
    return {
      graph: entry.graph,
      generatedAt: entry.generatedAt,
      stale,
      refreshing: this.pending.has(key),
      ...(entry.lastError !== undefined ? { lastError: entry.lastError } : {}),
    };
  }

  private rebuild(key: string, build: () => Promise<OrgGraph>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const run = (async () => {
      try {
        const graph = await build();
        this.entries.set(key, { graph, generatedAt: this.now() });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'org graph build failed';
        const prev = this.entries.get(key);
        if (prev) prev.lastError = message;
        else throw e;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, run);
    return run;
  }
}
