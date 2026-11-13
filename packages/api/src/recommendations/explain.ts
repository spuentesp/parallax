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

const SYSTEM = `You help a maintainer declare missing links for a static-analysis engine that maps how services call each other.
The engine has ALREADY checked every proposal you are shown: never say whether a link is valid or safe, and never invent facts that are not in the code snippet.
Reply with JSON only, no prose and no code fences.`;

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

export function parsePicks(
  content: string,
  sizes: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of parseJsonArray(content) ?? []) {
    if (row === null || typeof row !== 'object') continue;
    const { id, choice } = row as { id?: unknown; choice?: unknown };
    const n = typeof id === 'string' ? sizes.get(id) : undefined;
    if (n === undefined || typeof choice !== 'number' || !Number.isInteger(choice)) continue;
    if (choice >= 0 && choice < n) out.set(id as string, choice);
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

export async function pickAmongValid(
  model: RecommendModel,
  adapter: Pick<LainAdapter, 'getCodeSnippet'>,
  multi: readonly MultiChoice[],
): Promise<Map<string, number>> {
  const picks = new Map<string, number>();
  for (let i = 0; i < multi.length && i < BATCH * 2; i += BATCH) {
    const batch = multi.slice(i, i + BATCH);
    const cases = await Promise.all(
      batch.map(async (m) => ({
        id: m.item.key,
        site: `${m.item.repo}:${m.item.path}${m.item.line ? `:${m.item.line}` : ''}`,
        code: await snippetOf(adapter, m.item),
        candidates: m.valid.map((v, idx) => `${idx}: ${v.ref.service} ${v.ref.key}`),
      })),
    );
    const user = `For each case, the engine accepts ALL of the candidates below. Choose the one the code actually calls, or null when the snippet does not make it clear.
Answer: [{"id": "<case id>", "choice": <candidate index or null>}]

${cases
  .map(
    (c) =>
      `id: ${c.id}\nsite: ${c.site}\ncode:\n${c.code}\ncandidates:\n${c.candidates.join('\n')}`,
  )
  .join('\n\n---\n\n')}`;
    const res = await model.complete(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      { model: 'planner', maxTokens: 600, thinking: false },
    );
    const sizes = new Map(batch.map((m) => [m.item.key, m.valid.length]));
    for (const [id, c] of parsePicks(res.content ?? '', sizes)) picks.set(id, c);
  }
  return picks;
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
    const user = `For each proposal, write ONE sentence (max 30 words) saying what the code at that site does and why the proposed link fits it. Use only the snippet. If the snippet does not show why, use an empty string.
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
      { model: 'planner', maxTokens: 900, thinking: false },
    );
    for (const [id, text] of parseRationales(res.content ?? '', new Set(batch.map((r) => r.id)))) {
      out.set(id, text);
    }
  }
  return out;
}
