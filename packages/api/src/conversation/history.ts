import type { ClaimResult } from '../agent/claims.js';

// Memoria de una conversación para el investigador. Todo es determinista y sale
// de lo que se guardó, sin llamar al modelo:
//
//   - los últimos N turnos, tal cual (pregunta + respuesta, la respuesta acotada);
//   - un LIBRO de hechos: las relaciones que el MOTOR verificó, contradijo o no
//     pudo verificar en turnos anteriores, una línea cada una — es contexto, no
//     evidencia: cada turno vuelve a contrastar sus afirmaciones con el motor;
//   - los turnos más viejos, reducidos a una línea (pregunta → resultado).
//
// Lo que NO entra: la prosa de turnos viejos. Resumirla con el modelo añadiría una
// llamada y dejaría que su deriva se convirtiera en "hechos".

export interface StoredTurn {
  seq: number;
  question: string;
  answer: string;
  status: string;
  claims: ReadonlyArray<Pick<ClaimResult, 'claim' | 'verdict' | 'engine'>>;
}

export interface History {
  /** Turnos recientes, en orden, para el hilo del chat. */
  recent: Array<{ question: string; answer: string }>;
  /** Bloque de texto con el libro de hechos y los turnos viejos; null si no hay nada. */
  context: string | null;
}

export interface HistoryOptions {
  /** Cuántos turnos recientes van completos (por defecto 4). */
  verbatim?: number;
  /** Tope de caracteres de cada respuesta reciente (por defecto 1200). */
  maxAnswerChars?: number;
  /** Tope de caracteres del contexto (libro + turnos viejos) (por defecto 3000). */
  maxContextChars?: number;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/** Una línea por relación, con el último veredicto del motor sobre ella. */
export function factsLedger(turns: readonly StoredTurn[]): string[] {
  const latest = new Map<string, string>();
  for (const t of turns) {
    for (const c of t.claims) {
      if (c.claim.kind === 'location') {
        // Un lugar del código que el motor leyó (o no encontró): cuenta como hecho.
        if (c.verdict !== 'verified' && c.verdict !== 'contradicted') continue;
        const l = c.claim;
        latest.set(
          `loc:${l.repo}:${l.path}:${l.line}:${l.contains}`,
          `${l.repo}:${l.path}:${l.line} "${clip(l.contains, 60)}": engine ${c.verdict}`,
        );
        continue;
      }
      if (c.claim.kind === 'doc_quote') {
        // Una cita comprobada contra la sección indexada: cuenta como hecho.
        if (c.verdict !== 'verified' && c.verdict !== 'contradicted') continue;
        const d = c.claim;
        latest.set(
          `doc:${d.repo}:${d.path}:${d.section}:${d.quote}`,
          `${d.repo}:${d.path} "${d.section}" "${clip(d.quote, 60)}": engine ${c.verdict}`,
        );
        continue;
      }
      if (c.claim.kind !== 'relation') continue;
      if (
        c.verdict !== 'verified' &&
        c.verdict !== 'contradicted' &&
        c.verdict !== 'unverifiable'
      ) {
        continue;
      }
      const arrow = c.claim.polarity === 'present' ? '→' : '↛';
      const uses = c.engine && c.engine.uses > 0 ? `, ${c.engine.uses} uses` : '';
      // La clave incluye la polaridad: "A → B" y "A ↛ B" son afirmaciones distintas.
      latest.set(
        `${c.claim.consumer}${arrow}${c.claim.provider}`,
        `${c.claim.consumer} ${arrow} ${c.claim.provider}: engine ${c.verdict}${uses}`,
      );
    }
  }
  return [...latest.values()];
}

function oneLine(t: StoredTurn): string {
  const verified = t.claims.filter((c) => c.verdict === 'verified').length;
  const outcome = t.status === 'available' ? `${verified} verified` : t.status;
  return `- Q${t.seq}: ${clip(t.question.replace(/\s+/g, ' '), 110)} → ${outcome}`;
}

export function buildHistory(turns: readonly StoredTurn[], opts: HistoryOptions = {}): History {
  const verbatim = opts.verbatim ?? 4;
  const maxAnswer = opts.maxAnswerChars ?? 1200;
  const maxContext = opts.maxContextChars ?? 3000;
  if (turns.length === 0) return { recent: [], context: null };

  const ordered = [...turns].sort((a, b) => a.seq - b.seq);
  const recentTurns = ordered.slice(-verbatim);
  const older = ordered.slice(0, ordered.length - recentTurns.length);

  const recent = recentTurns.map((t) => ({
    question: t.question,
    answer: clip(t.answer, maxAnswer),
  }));

  const ledger = factsLedger(ordered);
  const parts: string[] = [];
  if (ledger.length > 0) {
    parts.push(
      `Facts the engine already adjudicated earlier in this conversation (context only: re-verify anything you rely on, and never treat these as evidence ids):\n${ledger.map((l) => `- ${l}`).join('\n')}`,
    );
  }
  if (older.length > 0) {
    parts.push(`Earlier questions in this conversation:\n${older.map(oneLine).join('\n')}`);
  }
  if (parts.length === 0) return { recent, context: null };

  // Lo más viejo se descarta primero: se recorta por el final del bloque de
  // turnos viejos y, si aún sobra, el libro conserva sus líneas más recientes.
  let context = parts.join('\n\n');
  if (context.length > maxContext) context = clip(context, maxContext);
  return { recent, context };
}
