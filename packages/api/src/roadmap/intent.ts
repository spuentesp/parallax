import type { OrgGraph } from '../org-graph.js';
import { ancestorsOf } from '../org-graph.js';

// Una pregunta que pide el RECORRIDO de un dato ("trace X end to end") o el RADIO DE
// IMPACTO de un cambio ("what breaks if I change X") no necesita un investigador que
// improvise: se reconoce por palabras y se responde con la función dedicada. Sólo se
// actúa cuando la pregunta nombra UN contrato sin ambigüedad; si no, sigue el camino normal.

export type RoadmapKind = 'trace' | 'blast';

/** Un contrato que el nombre de la pregunta puede querer decir. */
export interface RoadmapCandidate {
  key: string;
  service: string;
}

export interface RoadmapIntent {
  kind: RoadmapKind;
  /** El contrato sin ambigüedad; null cuando el nombre casó con varios. */
  key: string | null;
  service: string;
  /**
   * Todos los contratos que casaron, con más usos primero. Cuando hay más de
   * uno, la pregunta es ambigua: no se elige en silencio, se le pasan al
   * investigador para que lo diga.
   */
  candidates: RoadmapCandidate[];
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
  // Varias claves distintas con el mismo nombre (query y mutation, p. ej.): ambiguo.
  // Los candidatos NO se descartan: se le pasan al investigador.
  const byKey = new Map<string, { node: (typeof pool)[number]['n']; uses: number }>();
  for (const h of pool) {
    const seen = byKey.get(h.n.label);
    const u = uses.get(h.n.id) ?? 0;
    if (!seen || u > seen.uses) byKey.set(h.n.label, { node: h.n, uses: u });
  }
  const ranked = [...byKey.entries()]
    .sort((a, b) => b[1].uses - a[1].uses || a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, service: owner(v.node.id)?.label ?? '' }));
  if (ranked.length === 0) return null;
  if (ranked.length > 1) return { kind, key: null, service: '', candidates: ranked };
  const only = ranked[0] as { key: string; service: string };
  return { kind, key: only.key, service: only.service, candidates: [only] };
}
