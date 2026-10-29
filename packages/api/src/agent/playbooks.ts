// Ejemplos de trabajo (few-shot) por TIPO de pregunta. El tipo se reconoce por palabras, sin
// modelo; sólo se inyecta el que corresponde y cada uno es corto, porque la entrada se
// reenvía en cada ronda y es lo que más gasta (docs/agent-spend.md). Muestran la SECUENCIA
// de herramientas y la forma de las afirmaciones, con nombres inventados (nunca preguntas
// del conjunto de evaluación: ver docs/testing/red-team-protocol.md).

import { officialDomainsFor } from './web-search.js';

export type QuestionType =
  | 'orientation'
  | 'why'
  | 'blast'
  | 'trace'
  | 'locate'
  | 'relation'
  | 'other';

// El orden importa: lo más específico primero. "what breaks if I change X" es radio de
// impacto aunque contenga "where"; "what is Django's X" es orientación aunque diga "how".
const RULES: ReadonlyArray<readonly [QuestionType, RegExp]> = [
  [
    'blast',
    /\b(blast[- ]radius|what (would|will|could|might|does|do) .{0,30}(break|affect|impact)|who (is|would be|are) affected|downstream|if (i|we) (change|remove|rename|delete|drop|modify))\b/i,
  ],
  [
    'trace',
    /\b(trace|end[- ]to[- ]end|data ?flow|journey|lifecycle|how does .{1,60} (reach|get to|flow)|from the (database|db|table))\b/i,
  ],
  [
    'orientation',
    /\b(what is|what are|what's|explain|how does .{1,40}(work|handle|implement)|official docs?|best practice|recommended way|difference between|vs\.?|versus|what (does|do) .{1,60}\bdo)\b/i,
  ],
  [
    'why',
    /\b(why|how do we|what (was|were) (decided|chosen)|convention|decision|adr|how (to|do i) (run|test|contribute|build)|policy|rule)\b/i,
  ],
  [
    'relation',
    /\b(consumes?|depends? on|calls?|uses?|talks? to)\b.{0,60}\b(service|api|dashboard|storefront|backend|frontend)\b|\bwhich services\b/i,
  ],
  ['locate', /\b(where|which (file|function|module|class)|find|locate|implemented|defined)\b/i],
];

export function classifyQuestion(question: string): QuestionType {
  for (const [type, re] of RULES) if (re.test(question)) return type;
  // Nombra una librería pública conocida y nada más específico casó: es orientación.
  return officialDomainsFor(question).length > 0 ? 'orientation' : 'other';
}

const ORIENTATION_WEB = `Example (orientation question about a public library):
Q: "How does Foo's retry decorator work and do we use it?"
1. search_code("retry decorator") -> where this workspace uses it (file:line).
2. get_context(<that symbol>) -> how it is called.
3. web_search("Foo retry decorator") -> official docs first.
4. submit_answer: "Per the Foo docs, ... (doc_quote, repo web). Observed here: it wraps X at path:line (location claim)." Keep the two voices apart; if the docs and the code disagree, say so.`;

const ORIENTATION_REPO = `Example (orientation question about a library the workspace uses):
Q: "How does Foo's retry decorator work and do we use it?"
1. search_code("retry decorator") -> where this workspace uses it (file:line).
2. get_context(<that symbol>) and find_docs("retry") -> how it is called and what the repos document.
3. submit_answer: "Observed: it wraps X at path:line (location claim). Documented: ... (doc_quote)." You have no web source here: say what you could not check about the library itself instead of guessing.`;

const PLAYBOOKS: Record<Exclude<QuestionType, 'other' | 'orientation'>, string> = {
  why: `Example (why / convention question):
Q: "Why do payment adjustments take a row lock?"
1. find_docs("payment adjustment lock") -> the repo's own ADRs.
2. get_code_snippet(<best doc>) -> read it.
3. search_code("lock") -> where the code does it.
4. submit_answer: "Documented: ADR 4 says ... (doc_quote: section heading + literal phrase). Observed: the lock is taken at path:line (location claim)." If nothing is documented, say so only after find_docs came back empty.`,
  blast: `Example (blast radius):
Q: "What breaks if we rename Order.total?"
1. find_symbol("total", repo) -> exact symbol and id.
2. get_blast_radius(symbol) -> direct and transitive dependents; get_cross_repo_blast_radius if other repos may use it.
3. get_coverage -> what the engine could NOT see.
4. submit_answer: list dependents with file:line (location claims), then state what is unknown. Never call a change safe from an incomplete view.`,
  trace: `Example (end-to-end trace):
Q: "Follow the checkout create call from the storefront to the database."
1. consumers_of(provider, endpoint_contains) -> who calls the endpoint, with evidence ids.
2. get_call_chain(from, to) -> the exact path inside the provider.
3. get_code_snippet at the hops you will cite.
4. submit_answer: one hop per line, each with a location claim; relation claims for service-to-service links.`,
  locate: `Example (where is it implemented):
Q: "Where is the discount applied to an order?"
1. search_code("discount order") -> candidate symbols with file:line.
2. find_symbol(<best name>) -> exact definition.
3. get_context(symbol) -> callers and callees if the question asks how it is reached.
4. submit_answer: path:line for each place, each as a location claim whose "contains" is a name literally on that line.`,
  relation: `Example (who consumes whom):
Q: "Does the dashboard consume the product query of the API?"
1. consumers_of(service=<api>, consumer=<dashboard>, endpoint_contains="product").
2. If the answer is "no", check coverage before concluding an absence (get_coverage / list_unresolved).
3. submit_answer: a relation claim (polarity present or absent) per pair; the engine verifies it.`,
};

// Medido: sin esta línea, 2 de 12 respuestas con ejemplo llegaron en prosa y sin afirmaciones
// (failed:citations_missing); sin ejemplos ninguna. El ejemplo enseña la secuencia, no sustituye la regla.
const CLAIMS_RULE =
  'Whatever the type, submit_answer MUST carry the "claims" array: one claim per checkable statement (relation, location or doc_quote). A prose-only answer is rejected.';

/** El ejemplo que toca para esta pregunta, o null (tipo `other`: no se inyecta nada). */
export function playbookFor(
  question: string,
  opts: { web?: boolean } = {},
): { type: QuestionType; text: string | null } {
  const type = classifyQuestion(question);
  if (type === 'other') return { type, text: null };
  const example =
    type === 'orientation' ? (opts.web ? ORIENTATION_WEB : ORIENTATION_REPO) : PLAYBOOKS[type];
  return { type, text: `${example}\n${CLAIMS_RULE}` };
}
