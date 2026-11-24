import type { LainAdapter } from '../lain-adapter/types.js';
import type { LooseEndsModel } from '../loose-ends/service.js';
import type { MultiChoice } from './collect.js';
import type { Recommendation } from './types.js';

// El modelo NO valida nada: el motor ya aceptó cada propuesta (check_binding) o la
// sugirió con puntuación (list_service_refs). Aquí el modelo sólo
//   1) explica en una frase, leyendo el código, por qué la propuesta tiene sentido; y
//   2) entre varios candidatos que el motor YA aceptó, dice cuál encaja con el código.
// Lo que devuelve se lee de forma estricta: una respuesta que no es JSON, un id
// desconocido o un índice fuera de rango se descartan sin intentar "arreglarlos".

export type RecommendModel = LooseEndsModel;

const BATCH = 8;
const MAX_BATCHES = 3;
const MAX_RATIONALE_CHARS = 240;
const SNIPPET_CHARS = 700;
// Algunos modelos (visto con MiniMax-M3) escriben su razonamiento en el propio contenido,
// dentro de <think>…</think>, y sólo después la respuesta. Con un tope corto se cortan
// antes de llegar a ella; hace falta sitio para pensar Y contestar.
const MAX_TOKENS = 4000;

const SYSTEM = `You help a maintainer declare missing links for a static-analysis engine that maps how services call each other.
The engine has ALREADY checked every proposal you are shown: never say whether a link is valid or safe, and never invent facts that are not in the code snippet.
Reply with JSON only, no prose and no code fences.`;

/**
 * La respuesta sin el razonamiento. `truncated` = el modelo empezó a razonar y se quedó
 * sin espacio antes de contestar: no hay respuesta, que es distinto de "no sé".
 */
export function stripReasoning(content: string): { answer: string; truncated: boolean } {
  const noBlocks = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = noBlocks.search(/<think>/i);
  if (open >= 0) return { answer: noBlocks.slice(0, open).trim(), truncated: true };
  return { answer: noBlocks.trim(), truncated: false };
}

/** Primer array JSON de la respuesta (el modelo a veces lo envuelve en ``` o en texto). */
export function parseJsonArray(content: string): unknown[] | null {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function parseRationales(content: string, ids: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of parseJsonArray(content) ?? []) {
    if (row === null || typeof row !== 'object') continue;
    const { id, rationale } = row as { id?: unknown; rationale?: unknown };
    if (typeof id !== 'string' || !ids.has(id) || typeof rationale !== 'string') continue;
    const text = rationale.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    out.set(
      id,
      text.length > MAX_RATIONALE_CHARS ? `${text.slice(0, MAX_RATIONALE_CHARS - 1)}…` : text,
    );
  }
  return out;
}

export interface Picks {
  picks: Map<string, number>;
  /** El modelo contestó que el código no lo aclara (`choice: null`): una respuesta válida. */
  declined: Set<string>;
}

export function parsePicks(content: string, sizes: ReadonlyMap<string, number>): Picks {
  const out: Picks = { picks: new Map(), declined: new Set() };
  for (const row of parseJsonArray(content) ?? []) {
    if (row === null || typeof row !== 'object') continue;
    const { id, choice } = row as { id?: unknown; choice?: unknown };
    const n = typeof id === 'string' ? sizes.get(id) : undefined;
    if (n === undefined) continue;
    if (choice === null) out.declined.add(id as string);
    else if (typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < n) {
      out.picks.set(id as string, choice);
    }
  }
  return out;
}

async function snippetOf(
  adapter: Pick<LainAdapter, 'getCodeSnippet'>,
  at: { repo: string; path: string; line: number | null },
): Promise<string> {
  try {
    const r = await adapter.getCodeSnippet({
      path: at.path,
      repo_id: at.repo,
      ...(at.line ? { line: at.line } : {}),
      context_lines: 3,
    });
    return r.text.slice(0, SNIPPET_CHARS);
  } catch {
    return '';
  }
}

export interface PickOutcome {
  picks: Map<string, number>;
  declined: Set<string>;
  /** Casos cuyo lote no produjo una respuesta utilizable (cortada o ilegible). */
  unanswered: Set<string>;
}

/** Casos que se le plantean al modelo por ejecución (uno por llamada). */
const MAX_PICK_CASES = 6;

export async function pickAmongValid(
  model: RecommendModel,
  adapter: Pick<LainAdapter, 'getCodeSnippet'>,
  multi: readonly MultiChoice[],
): Promise<PickOutcome> {
  const out: PickOutcome = { picks: new Map(), declined: new Set(), unanswered: new Set() };
  // Un caso por llamada: un modelo que razona se enreda cuando se le juntan varios
  // sin resolver (medido: tres casos juntos agotaron 4000 tokens sin contestar).
  const asked = multi.slice(0, MAX_PICK_CASES);
  for (const m of multi.slice(MAX_PICK_CASES)) out.unanswered.add(m.item.key);
  for (const m of asked) {
    const code = await snippetOf(adapter, m.item);
    const site = `${m.item.repo}:${m.item.path}${m.item.line ? `:${m.item.line}` : ''}`;
    const user = `The engine accepts ALL of the candidates below for this call. Choose the one the code actually calls.
Answer null right away when the snippet does not settle it: for example when the base URL is a variable whose value is not shown, or when several candidates fit equally well. Do not guess and do not assume anything about code you cannot see.
Answer exactly: [{"id": "${m.item.key}", "choice": <candidate index or null>}]

site: ${site}
code:
${code}
candidates:
${m.valid.map((v, idx) => `${idx}: ${v.ref.service} ${v.ref.key}`).join('\n')}`;
    const res = await model.complete(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      { model: 'worker', maxTokens: MAX_TOKENS, thinking: false },
    );
    const { answer } = stripReasoning(res.content ?? '');
    const got = parsePicks(answer, new Map([[m.item.key, m.valid.length]]));
    if (got.picks.has(m.item.key)) out.picks.set(m.item.key, got.picks.get(m.item.key) as number);
    else if (got.declined.has(m.item.key)) out.declined.add(m.item.key);
    else out.unanswered.add(m.item.key);
  }
  return out;
}

/** Una frase por recomendación, rotulada como lectura del modelo; sin respuesta = sin texto. */
export async function explainRecommendations(
  model: RecommendModel,
  adapter: Pick<LainAdapter, 'getCodeSnippet'>,
  recs: readonly Recommendation[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withSite = recs.filter((r) => r.site !== null);
  for (let b = 0; b < MAX_BATCHES && b * BATCH < withSite.length; b++) {
    const batch = withSite.slice(b * BATCH, (b + 1) * BATCH);
    const cases = await Promise.all(
      batch.map(async (r) => ({
        id: r.id,
        proposal: r.title,
        site: r.site as NonNullable<Recommendation['site']>,
        code: await snippetOf(adapter, r.site as NonNullable<Recommendation['site']>),
      })),
    );
    const user = `For each proposal, write ONE sentence (max 30 words) saying what the code at that site does and why the proposed link fits it. Use only the snippet. If the snippet does not show why, use an empty string. Keep your reasoning short.
Answer: [{"id": "<case id>", "rationale": "<sentence>"}]

${cases
  .map(
    (c) =>
      `id: ${c.id}\nproposal: ${c.proposal}\nsite: ${c.site.repo}:${c.site.path}${c.site.line ? `:${c.site.line}` : ''}\ncode:\n${c.code}`,
  )
  .join('\n\n---\n\n')}`;
    const res = await model.complete(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      { model: 'worker', maxTokens: MAX_TOKENS, thinking: false },
    );
    const { answer } = stripReasoning(res.content ?? '');
    for (const [id, text] of parseRationales(answer, new Set(batch.map((r) => r.id)))) {
      out.set(id, text);
    }
  }
  return out;
}
