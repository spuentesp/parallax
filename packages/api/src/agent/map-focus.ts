import { endpointNodeId, serviceNodeId } from '../topology.js';
import type { ClaimResult } from './claims.js';

// Navegación del agente sobre el mapa. Una respuesta del investigador puede
// llevar al usuario a "estas son las relaciones de las que hablo": un foco con
// los ids de nodo que el motor ya adjudicó. Regla de oro: sólo se apunta a lo
// que un recibo respalda — una afirmación `verified` — y sólo a nodos que
// existen en el mapa. Una contradicha, no verificable o sin resolver NO genera
// foco: no se dibuja lo que el motor no sostiene.

export interface MapFocusRelation {
  consumer: string;
  provider: string;
  polarity: 'present' | 'absent';
  /** Usos que el motor registró (0 para una ausencia verificada). */
  uses: number;
  /** Ids de nodo de los endpoints en juego (a lo sumo 3). */
  endpoints: string[];
  /** false = el alcance del motor era incompleto cuando se adjudicó. */
  complete: boolean;
}

export interface MapFocus {
  /** Nodo donde aterriza la vista; el resto de `ids` forma su vecindad. */
  seed: string;
  ids: string[];
  relations: MapFocusRelation[];
  /** Query string para abrir el mapa así: ?tab=map&focus=…&hops=1&sel=…. */
  query: string;
}

export function mapFocusQuery(seed: string, hops = 1): string {
  const p = new URLSearchParams({ tab: 'map', focus: seed, hops: String(hops), sel: seed });
  return `?${p.toString()}`;
}

export function mapFocusFromClaims(
  results: readonly ClaimResult[],
  /** Ids de nodo que existen en el mapa del workspace. */
  known: ReadonlySet<string>,
): MapFocus | null {
  const relations: MapFocusRelation[] = [];
  const ids = new Set<string>();
  const providers: string[] = [];
  const endpointIds: string[] = [];

  for (const r of results) {
    if (r.claim.kind !== 'relation' || r.verdict !== 'verified' || !r.resolved || !r.engine) {
      continue;
    }
    const consumer = serviceNodeId(r.resolved.consumer);
    const provider = serviceNodeId(r.resolved.provider);
    if (!known.has(consumer) || !known.has(provider)) continue;

    const endpoints = r.engine.endpoints
      .map((key) => endpointNodeId(key, r.resolved?.provider ?? ''))
      .filter((id) => known.has(id));
    relations.push({
      consumer: r.resolved.consumer,
      provider: r.resolved.provider,
      polarity: r.claim.polarity,
      uses: r.engine.uses,
      endpoints,
      complete: r.engine.complete,
    });
    ids.add(consumer);
    ids.add(provider);
    providers.push(provider);
    for (const e of endpoints) {
      ids.add(e);
      endpointIds.push(e);
    }
  }
  if (relations.length === 0) return null;

  // Un único endpoint en juego: se aterriza en él ("este endpoint lo consumen
  // estos servicios"). Si no, en el proveedor común, o en el primero.
  const uniqueEndpoints = [...new Set(endpointIds)];
  const uniqueProviders = [...new Set(providers)];
  const seed =
    uniqueEndpoints.length === 1 ? (uniqueEndpoints[0] as string) : (uniqueProviders[0] as string);
  return { seed, ids: [...ids], relations, query: mapFocusQuery(seed) };
}
