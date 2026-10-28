import type { OrgGraph } from '../org-graph.js';
import { ancestorsOf } from '../org-graph.js';

// Una pregunta que pide el RECORRIDO de un dato ("trace X end to end") o el RADIO DE
// IMPACTO de un cambio ("what breaks if I change X") no necesita un investigador que
// improvise: se reconoce por palabras y se responde con la función dedicada. Sólo se
// actúa cuando la pregunta nombra UN contrato sin ambigüedad; si no, sigue el camino normal.

export type RoadmapKind = 'trace' | 'blast';
export interface RoadmapIntent {
  kind: RoadmapKind;
  key: string;
  service: string;
}

const TRACE =
  /\b(trace|follow|end[- ]to[- ]end|data ?flow|roadmap|journey|lifecycle|where (does|do|is) .{0,40}(come|coming|stored|end|go)|from the (database|db|table))\b/i;
const BLAST =
  /\b(blast[- ]radius|what (would|will|could|might|does|do) .{0,30}(break|affect|impact)|impact (of|on)|who (is|would be|are) affected|affected by|downstream|ripple|if (i|we) (change|remove|rename|delete|drop|modify))\b/i;

const norm = (s: string) => s.toLowerCase();

/** ¿La pregunta menciona este contrato? Clave completa, o su nombre de operación/ruta. */
function mentions(question: string, key: string): 'full' | 'name' | null {
  const q = norm(question);
  if (q.includes(norm(key))) return 'full';
  const name = key.split(':').pop() ?? key;
  if (name.length < 4) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${esc}($|[^a-z0-9_])`, 'i').test(question) ? 'name' : null;
}

export function detectRoadmap(question: string, graph: OrgGraph): RoadmapIntent | null {
  const blast = BLAST.test(question);
  // "what breaks if I change X" suele contener "change"/"if": el impacto gana al recorrido.
  const kind: RoadmapKind | null = blast ? 'blast' : TRACE.test(question) ? 'trace' : null;
  if (!kind) return null;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const owner = (id: string) =>
    [id, ...ancestorsOf(id, byId)].map((a) => byId.get(a)).find((n) => n?.kind === 'service');
  const uses = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind === 'consumes') uses.set(e.target, (uses.get(e.target) ?? 0) + e.count);
  }
  const hits = graph.nodes
    .filter((n) => n.kind === 'endpoint')
    .map((n) => ({ n, how: mentions(question, n.label) }))
    .filter((h): h is { n: typeof h.n; how: 'full' | 'name' } => h.how !== null);
  if (hits.length === 0) return null;

  // Una clave completa nombrada en la pregunta gana a un nombre suelto.
  const full = hits.filter((h) => h.how === 'full');
  const pool = full.length > 0 ? full : hits;
  const keys = new Set(pool.map((h) => h.n.label));
  // Varias claves distintas con el mismo nombre (query y mutation, p. ej.): ambiguo.
  if (keys.size !== 1) return null;
  const best = [...pool].sort((a, b) => (uses.get(b.n.id) ?? 0) - (uses.get(a.n.id) ?? 0))[0];
  if (!best) return null;
  return { kind, key: best.n.label, service: owner(best.n.id)?.label ?? '' };
}
