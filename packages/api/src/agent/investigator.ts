// Investigador Nemotron (§14). Bucle real de tool calling:
//
//   Nemotron propone tool_calls → el backend valida nombre/schema/alcance/
//   presupuesto → despacha SOLO lecturas sobre LAIN → devuelve el resultado
//   como role=tool → repite hasta que el modelo responda o se agote el
//   presupuesto (8 llamadas / 120 s, configurables y medidos).
//
// La API del modelo no ejecuta MCP: sólo el despachante toca LAIN, con la
// vista fijada por el análisis. La respuesta final debe citar ids de
// evidencia ENTREGADOS por el backend; el validador los resuelve antes de
// declarar la explicación disponible (INV 1). El serializador mantiene campos
// del motor y del modelo separados: la prosa jamás reescribe la clasificación
// del motor (INV 2).

import type { LainView } from '@parallax/shared/lain';
import { INVESTIGATOR_DEFAULTS } from '../config.js';
import type { History } from '../conversation/history.js';
import type { LainAdapter } from '../lain-adapter/types.js';
import {
  type Claim,
  type ClaimEvidence,
  type ClaimResult,
  type ClaimsSummary,
  describeContradictions,
  extractFileLines,
  SUBMIT_TOOL,
  SUBMIT_TOOL_SPEC,
  SubmitAnswerArgs,
  summarizeClaims,
  verifyClaims,
} from './claims.js';
import {
  createDispatcher,
  type DispatcherBudgetUse,
  type DispatcherConfig,
  type DocSearch,
  type LainDispatcher,
  type Receipt,
} from './dispatcher.js';
import {
  PLANNER_SYSTEM_PROMPT,
  planBlock,
  SUBMIT_PLAN,
  SUBMIT_PLAN_SPEC,
  type SubmitPlan,
  SubmitPlanArgs,
  writeBlock,
} from './handoff.js';
import { memoizeReads } from './memo-lain.js';
import {
  type ChatMessage,
  hasTextToolCall,
  type NemotronResponse,
  stripToolMarkup,
  type ToolSpec,
} from './nemotron.js';
import { classifyQuestion, playbookFor, type QuestionType } from './playbooks.js';
import {
  buildFindings,
  PR_SUBMIT_SPEC,
  PR_SYSTEM_PROMPT,
  PR_TOOL_BUDGET,
  type PrCoverage,
  PrSubmitArgs,
  type PrVerification,
  renderFindingsBlock,
  verifyPrSubmission,
} from './pr-explain.js';
import { WEB_REPO } from './web-search.js';

/**
 * Progreso en vivo de una investigación: lo que el usuario ve mientras espera.
 * `summary` es una frase corta y legible del argumento principal (la consulta, el
 * símbolo, el archivo); nunca el resultado completo.
 */
export type ProgressEvent =
  | { type: 'round'; round: number; toolCallsUsed: number; maxToolCalls: number; forced: boolean }
  | { type: 'tool'; tool: string; summary: string; ok: boolean; ms: number; note?: string }
  | { type: 'wrapup'; reason: 'budget' | 'locations' }
  | { type: 'verify'; claims: number };

/** "search_code · checkout shipping address" en vez de un JSON de argumentos. */
export function summarizeCall(argsJson: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return '';
  }
  const order = [
    'query',
    'name',
    'symbol',
    'path',
    'service',
    'key',
    'endpoint',
    'from',
    'to',
    'node_id',
    'repo',
  ];
  const parts: string[] = [];
  for (const k of order) {
    const v = args[k];
    if (typeof v === 'string' && v)
      parts.push(k === 'repo' ? `in ${v}` : k === 'node_id' ? v.slice(0, 8) : v);
    if (typeof args.line === 'number' && k === 'path' && typeof v === 'string')
      parts[parts.length - 1] = `${v}:${args.line}`;
  }
  return parts.join(' · ').slice(0, 110);
}

/** Llamadas a herramienta que se aceptan de UNA respuesta del modelo. */
const MAX_CALLS_PER_ROUND = 8;

/** Fracción del presupuesto de lecturas a partir de la cual se pide cerrar. */
const SOFT_NUDGE_AT = 0.6;

/**
 * "No hay documentación" dicho SIN haber buscado. Deliberadamente estrecho:
 * sólo la ausencia de documentación, no cualquier negación de la respuesta.
 */
const ABSENCE_OF_DOCS = [
  /\b(no|nothing|not any|neither|nor|is not|are not|isn't|aren't)\b[^.!?\n]{0,60}\b(adr|adrs|documentation|documented|document|docs?|readme|contributing|architecture decision|guide|guides)\b/i,
  /\bnothing\s+(is\s+|was\s+|has\s+been\s+)?(documented|written|recorded|specified)\b/i,
];

/** La respuesta afirma que no existe documentación. */
const claimsNoDocs = (text: string): boolean => ABSENCE_OF_DOCS.some((re) => re.test(text));

export const PROMPT_VERSION = 'parallax-investigator-v10';

// El investigador depende de esta interfaz mínima, no del cliente concreto:
// las pruebas inyectan un modelo guionizado y P08 se prueba sin modelo.
export interface ChatCompleter {
  complete(
    messages: ChatMessage[],
    opts?: {
      model?: 'planner' | 'worker';
      tools?: ToolSpec[];
      toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
      maxTokens?: number;
      thinking?: boolean;
      parallelToolCalls?: boolean;
    },
  ): Promise<NemotronResponse>;
}

export interface InvestigatorBudget {
  maxToolCalls: number;
  maxModelMs: number;
}

// §6 fijó ocho llamadas; las preguntas entre repos (Saleor) necesitan ~12 con
// el modelo que sí responde. El valor vive en INVESTIGATOR_DEFAULTS (config.ts).
export const DEFAULT_INVESTIGATOR_BUDGET: InvestigatorBudget = {
  maxToolCalls: INVESTIGATOR_DEFAULTS.investigatorMaxToolCalls,
  maxModelMs: INVESTIGATOR_DEFAULTS.investigatorMaxModelMs,
};

export interface ToolCallRecord {
  toolCallId: string;
  tool: string;
  args: string;
  ok: boolean;
  code?: string;
  latencyMs: number;
  resultChars: number;
  truncated: boolean;
}

export interface ModelCallRecord {
  model: string;
  latencyMs: number;
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  retry: boolean;
}

export interface CitationRejection {
  ref: string;
  reason: 'not_delivered_by_backend' | 'unresolvable_in_view';
}

export interface ClassificationConflict {
  endpoint: string;
  engineClass: string;
  claimedClass: string;
  sentence: string;
}

export interface InvestigationResult {
  /** 'available' o 'failed:<reason>' — nunca un silencio (P08). */
  explanationStatus: string;
  answer: string | null;
  citations: { accepted: string[]; rejected: CitationRejection[] };
  conflictingClaims: ClassificationConflict[];
  budget: InvestigatorBudget &
    DispatcherBudgetUse & {
      modelMsUsed: number;
      rounds: number;
      /** Tokens de entrada y salida de TODAS las rondas: la entrada es lo que más cuesta. */
      promptTokens: number;
      completionTokens: number;
    };
  toolCallLog: ToolCallRecord[];
  modelLog: ModelCallRecord[];
  effectiveModel: string | null;
  promptVersion: string;
  /** Tipo de pregunta reconocido (elige el ejemplo de trabajo); null en modo PR. */
  questionType: QuestionType | null;
  /** Aristas consumidor→servicio observadas en get_service (estructural). */
  consumedEdges: Array<{ source: string; target: string }>;
  /** Afirmaciones tipadas de submit_answer, con el veredicto del motor. */
  claims: ClaimResult[];
  claimsSummary: ClaimsSummary;
  /** Recibos de consulta (q:N) emitidos en esta investigación. */
  receipts: Receipt[];
  /** Recibos citados en la prosa que existen en esta investigación. */
  citedReceipts: string[];
  /** Modo PR: explicación por hallazgo verificada contra el motor (null fuera de ese modo). */
  pr: Pick<PrVerification, 'findings' | 'unaddressed' | 'unknownIds'> | null;
  errors: string[];
}

/** Espera antes del único reintento: una sobrecarga del proveedor no se resuelve al instante. */
const RETRY_DELAY_MS = 1500;

/** Las secciones de un documento del índice local, por su título. */
export type DocSectionLookup = (
  repo: string,
  path: string,
  section: string,
) => {
  fileFound: boolean;
  sections: Array<{ heading: string; body: string; lineStart: number }>;
  headings: string[];
} | null;

export interface InvestigateOptions {
  /**
   * Modo PR: los hallazgos del motor entran en el contexto, el modelo explica
   * cada uno por id y la entrega se verifica contra ellos.
   */
  pr?: {
    changes: unknown[];
    coverage: PrCoverage;
    /**
     * Snapshot base del PR. La evidencia de un endpoint ELIMINADO (su ruta) sólo
     * existe ahí: resolverla únicamente en head la rechazaría como si el modelo
     * la hubiera inventado.
     */
    baseView?: LainView | undefined;
  };
  /** Pausa antes del reintento (los tests la ponen a 0). */
  retryDelayMs?: number;
  question: string;
  lain: LainAdapter;
  model: ChatCompleter;
  view?: LainView;
  budget?: Partial<InvestigatorBudget>;
  /** Hallazgos del motor (INV 2): contexto y detección de promociones. */
  engineFindings?: unknown[];
  modelRole?: 'planner' | 'worker';
  /** Búsqueda en el índice local de documentación del workspace. */
  docs?: DocSearch;
  /**
   * Las secciones de un documento del índice local, por su título. Sin esto una
   * cita de la documentación no se puede comprobar contra el checkout.
   */
  docsSection?: DocSectionLookup;
  /**
   * Búsqueda web (Tavily) para preguntas técnicas generales. Sin ella la herramienta
   * `web_search` no existe: ni se ofrece ni se acepta.
   */
  web?: DispatcherConfig['web'];
  /** Ejemplos de trabajo por tipo de pregunta; `false` los apaga (la línea base de la evaluación). */
  playbooks?: boolean;
  maxTokens?: number;
  /** Se llama con cada paso (ronda del modelo, lectura al motor, verificación): progreso en vivo. */
  onProgress?: (e: ProgressEvent) => void;
  /** Razonamiento interno del modelo (ver NemotronProvider.complete); sin indicar, el del servidor. */
  thinking?: boolean;
  /**
   * Por defecto 'auto'. Forzar una herramienta concreta sirve para verificar
   * el mecanismo de tool calling sin depender de que el modelo decida
   * consultar: §14 exige que "la respuesta produzca una llamada válida", y
   * eso no puede ser no-determinista.
   */
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Etiqueta del endpoint configurado (sin credenciales) para el traza. */
  endpointLabel?: string;
  /**
   * Si el modelo cierra con prosa tras leer del motor, pedirle UNA vez que
   * entregue con submit_answer (para que el motor verifique sus afirmaciones).
   * Lo activa /api/query; por defecto se acepta la prosa.
   */
  nudgeSubmit?: boolean;
  /** Memoria de la conversación (ver conversation/history.ts); sin ella, pregunta suelta. */
  history?: History;
  /**
   * Contratos que el nombre de la pregunta puede querer decir (más de uno). El
   * investigador decide, o dice que son varios: lo que no hace es elegir uno en
   * silencio.
   */
  contractCandidates?: ReadonlyArray<{ key: string; service: string }>;
  /**
   * El relevo: el modelo fuerte planifica y redacta, el rápido lee. Apagado
   * por defecto (mira docs/agent-spend.md: la decisión es de las mediciones).
   */
  handoff?: boolean;
  maxResultChars?: number;
}

const WEB_UNCITED_MESSAGE =
  'You searched the web but your answer cites nothing from it. Everything you state about the public library or standard must be attributed ("per <source>") and backed by a doc_quote claim (repo "web", path = the result URL, section = its title as shown, quote copied literally from its text). If none of the results was relevant, say so in the answer instead of stating what you know from memory.';

/** ¿Alguna afirmación cita lo que devolvió la web? */
const citesWeb = (claims: readonly Claim[] | undefined): boolean =>
  (claims ?? []).some((c) => c.kind === 'doc_quote' && c.repo === WEB_REPO);

const SYSTEM_PROMPT = `You are Parallax's architecture investigator. You answer questions about a fixed code workspace using ONLY the read-only research tools provided. The workspace view was fixed by the analysis: you cannot choose snapshots, repos outside the workspace, or any write/publish tool.

Method:
1. Gather facts with the tools before answering. The workspace map in the question already lists the services, so do not call list_services just to learn them. consumers_of summarizes who consumes a service and through which endpoints, each with a citable evidence id; get_service gives the raw detail; trace_impact shows who depends on an endpoint; resolve_evidence/read_source verify code locations; list_unresolved and get_coverage tell you what remains unknown.
1b. Code questions ("where is X implemented", "what does changing X break", "how does A reach B") use the code tools, not the contract tools: search_code or search_org to LOCATE a feature by words, find_symbol for an exact name, get_context / get_call_sites / get_call_chain to follow it, get_blast_radius or get_cross_repo_blast_radius for what a change affects, find_anchors / understand_repository to orient in a repo. They return file:line; you may state those locations, but a code location is not evidence of a service relation: relation claims still rest on consumers_of / trace_impact. Do not guess paths for read_source: find them with search_code first. For "why", "how do we", conventions, decisions or how to run/test/contribute, use find_docs FIRST: the repositories document themselves (ADRs, AGENTS.md / CLAUDE.md, CONTRIBUTING, README, docs/). Read the one best file with get_code_snippet, quote it, and add a doc_quote claim whose "section" is the section heading the hint gave you and whose "quote" is a phrase copied literally from that section: the engine checks the phrase against the indexed section of the checkout. Say "documented" for what comes from a doc and "observed" for what comes from code, and when they disagree say so. If nothing is documented, say that — but only after find_docs has come back empty. Stop researching once you can answer: about 6 calls is usually enough.
1c. General or technical questions about a PUBLIC library, framework, protocol or standard ("what is X", "how does Y handle Z", "what do the docs recommend") are answered with web_search, official documentation first, AFTER you have located how this workspace uses it (search_code / find_symbol / get_context), so the answer ties the two together. Never send workspace-internal names to it. Keep three voices apart: "observed" = the engine or the code showed it, "documented" = a repository's own docs say it, "per <source>" = the web says it. The web explains; it never overrides what the engine observed, and when they disagree you say so. Cite a web result with a doc_quote claim (repo "web", path = the result URL, section = its title, quote copied literally from its text), and only for URLs web_search returned.
2. Every factual conclusion MUST cite at least one evidence id you actually received in tool results. Write the id exactly as it appears in the tool result inside the marker, with no angle brackets, quotes or placeholders, for example [ev:billing:Function:src/main.py:fetch_me:35]. Evidence ids are the long anchor strings found in tool results (fields like site.id or caller.id); service names and tool names are not evidence ids. Never invent ids, paths or refs. If you did not receive an id, do not cite it.
3. You cannot change engine classifications. If a finding is NeedsInvestigation or NoKnownImpact, keep it; explain what is unknown and what evidence would resolve it.
4. For design proposals (e.g. a BFF): identify existing contracts/capabilities to reuse, separate DECISIONS from HYPOTHESES explicitly, and list open operational questions. A proposal must not modify the observed map — mark every hypothetical relation as such.
5. If a tool result declares a cut (truncation), ask for a narrower detail call instead of guessing the omitted part.
6. If you cannot verify something, say it is unknown. Never hide uncertainty. Answer in the language of the question.
7. Finish by calling submit_answer. Put the explanation for the human in "answer". Put every statement about whether one service consumes another in "claims" as a relation claim (polarity "present" or "absent"): the engine verifies those itself, so an absence needs no code anchor. If you state any file:line in your answer you MUST add a location claim for it (an answer with file:line and no location claim is sent back). Every file:line you state goes in a location claim (repo, path, line, and "contains": the exact symbol or text that must be on or within a few lines of that line): the engine reads the code back and verifies it (if the location comes from an engine evidence id, also put that id in the claim's "evidence", and make "contains" a name that is literally in the source). Every other statement you want checked goes in a note claim with the evidence ids that support it. A phrase you quote from a document goes in a doc_quote claim (repo, path, section, quote) — the engine reads that section of the checkout and checks the phrase is really there. Each tool result carries a "receipt" id (q:N) you may cite for what a query returned.
8. Copy each file path exactly as a tool printed it. Start the answer with the finding itself: never restate the question, the task or the workspace map. A location claim's line must be a line you actually saw in a tool result (where the symbol is defined or used), never a guess such as line 1.
9. Keep "answer" short (about 200 words): summarize and cite a few representative evidence ids; do not enumerate every endpoint. The claims carry the checkable facts, and a reply that is too long is cut off and lost.`;

function nowMs(): number {
  return Date.now();
}

function isRetryableError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  return (
    name === 'AbortError' ||
    /\b(429|502|503|529)\b|rate.?limit|overload|timeout|aborted/i.test(message)
  );
}

function isTimeoutError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  return name === 'AbortError' || /timeout|aborted/i.test(message);
}

// Extrae las citas de la respuesta.
//
// El marcador canónico es [ev:<id>], pero el modelo lo reescribe con paréntesis
// o backticks (`(ev: id)`), y rechazar una cita real por puntuación es un falso
// negativo que deja el informe sin fuentes. Por eso se aceptan dos formas: el
// marcador, y cualquier id ENTREGADO por el backend que aparezca en la prosa.
//
// Esto no afloja INV 1: sigue sin aceptarse ningún id que el backend no haya
// entregado. Lo que cambia es la tolerancia al formato, no a la verdad.
// Un id tal como lo escribe el modelo -> el id: sin comillas, paréntesis ni
// corchetes (también los de ancho completo) y sin el prefijo ev: si lo trae.
export function cleanRef(raw: string): string {
  return raw
    .trim()
    .replace(/^[`"'“”<([「【]+/, '')
    .replace(/^ev:\s*/i, '')
    .replace(/[`"'“”>)\]】」.,;:]+$/, '')
    .trim();
}

export function extractCitationRefs(
  answer: string,
  deliveredRefs: readonly string[] = [],
): string[] {
  const refs: string[] = [];
  const push = (raw: string | undefined): void => {
    const ref = cleanRef(raw ?? '');
    if (ref && !refs.includes(ref)) refs.push(ref);
  };

  for (const m of answer.matchAll(/\[ev:\s*([^\]]+?)\s*\]/g)) push(m[1]);
  for (const m of answer.matchAll(/\bev:\s*[`'"]?([^\s`'")\]]+)[`'"]?/g)) push(m[1]);

  // Un id entregado que aparezca tal cual también cuenta como cita.
  for (const id of deliveredRefs) {
    if (id.length > 0 && answer.includes(id)) push(id);
  }
  return refs;
}

// INV 2 (detección, no mutación): si la prosa del modelo asocia un hallazgo del
// motor con una clase distinta de la del motor, se registra el conflicto. La
// clasificación persistida jamás cambia.
export function detectClassificationConflicts(
  answer: string,
  engineFindings: unknown[],
): ClassificationConflict[] {
  const classes = ['Verified', 'NeedsInvestigation', 'NoKnownImpact'] as const;
  const conflicts: ClassificationConflict[] = [];
  const sentences = answer
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of engineFindings) {
    const finding = (raw ?? {}) as {
      endpoint?: { key?: string; service?: string };
      impact?: { class?: string };
    };
    const key = finding.endpoint?.key;
    const engineClass = finding.impact?.class;
    if (!key || !engineClass) continue;
    const path = key.includes(' ') ? key.slice(key.indexOf(' ') + 1) : key;
    for (const sentence of sentences) {
      if (!sentence.includes(key) && !sentence.includes(path)) continue;
      for (const cls of classes) {
        if (cls === engineClass) continue;
        if (sentence.includes(cls)) {
          conflicts.push({ endpoint: key, engineClass, claimedClass: cls, sentence });
        }
      }
    }
  }
  return conflicts;
}

/**
 * Ejecuta una investigación completa. Devuelve SIEMPRE el resultado parcial:
 * un fallo del modelo deja el estado failed:<reason> con el traza medido; la
 * parte estructural (aristas observadas) sobrevive al fallo.
 */
export async function investigate(raw: InvestigateOptions): Promise<InvestigationResult> {
  // Las lecturas pesadas repetidas (get_service) se hacen una vez por investigación.
  const opts: InvestigateOptions = { ...raw, lain: memoizeReads(raw.lain) };
  const budget: InvestigatorBudget = {
    maxToolCalls: Math.min(
      opts.budget?.maxToolCalls ?? DEFAULT_INVESTIGATOR_BUDGET.maxToolCalls,
      opts.pr ? PR_TOOL_BUDGET : Number.POSITIVE_INFINITY,
    ),
    maxModelMs: opts.budget?.maxModelMs ?? DEFAULT_INVESTIGATOR_BUDGET.maxModelMs,
  };
  const view: LainView = opts.view ?? 'live';
  const dispatcher: LainDispatcher = createDispatcher({
    lain: opts.lain,
    view,
    maxToolCalls: budget.maxToolCalls,
    ...(opts.docs ? { docs: opts.docs } : {}),
    ...(opts.web ? { web: opts.web } : {}),
    ...(opts.maxResultChars !== undefined ? { maxResultChars: opts.maxResultChars } : {}),
  });
  const prFindings = opts.pr ? buildFindings(opts.pr.changes) : null;
  if (prFindings) dispatcher.deliverEvidence(prFindings.flatMap((f) => f.evidenceIds));
  const tools = [...dispatcher.toolSpecs(), opts.pr ? PR_SUBMIT_SPEC : SUBMIT_TOOL_SPEC];
  const modelRole = opts.modelRole ?? 'worker';
  // Una respuesta con muchas afirmaciones y citas supera con facilidad 2048:
  // el valor por defecto sale de la config (INVESTIGATOR_MAX_TOKENS, 4096).
  const maxTokens = opts.maxTokens ?? 4096;

  const toolCallLog: ToolCallRecord[] = [];
  const modelLog: ModelCallRecord[] = [];
  const errors: string[] = [];
  let modelMsUsed = 0;
  /** Los resultados de las herramientas, para el escritor del relevo. */
  const toolResults: string[] = [];
  /** El plan del planificador (el relevo). */
  let plan: SubmitPlan | null = null;

  // Orientación sin gastar presupuesto: el mapa sale del mismo catálogo que fija
  // el alcance, así el modelo no gasta sus primeras llamadas descubriéndolo.
  const workspaceMap = await dispatcher.workspaceMap();
  const mapBlock = workspaceMap
    ? `Workspace map (from the engine, fixed view):\n${workspaceMap}`
    : '';
  // Lo que acompaña a la pregunta: el mapa del workspace y, si lo hay, el libro
  // de hechos de la conversación.
  // Documentación de los propios repos que parece tratar el tema (sin gastar lecturas).
  const docLines = opts.pr ? '' : await dispatcher.docsFor(opts.question);
  /** La pregunta no recibió ninguna pista de documentación. */
  const docHintEmpty = docLines === '';
  const docsBlock = docLines
    ? `Documentation files in the repositories that may cover this (read the best one with get_code_snippet before answering a why / convention / decision question, and cite it):\n${docLines}`
    : '';

  // ── El relevo, fase 1: el planificador dice qué leer ─────────────────────
  // Si el plan falla o no sirve, el trabajador corre igual: la investigación no
  // depende del plan. Lo que no se hace es fingir que hubo plan.
  if (opts.handoff && !opts.pr) {
    try {
      const resp = await opts.model.complete(
        [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              mapBlock,
              docsBlock,
              `Read-only tools available: ${dispatcher
                .toolSpecs()
                .map((t) => t.function.name)
                .join(', ')}`,
              `Question: ${opts.question}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        {
          model: 'planner',
          tools: [SUBMIT_PLAN_SPEC],
          toolChoice: { type: 'function', function: { name: SUBMIT_PLAN } },
          maxTokens: 1200,
          // Pensar le cuesta tokens de más en una respuesta corta y estructurada.
          thinking: false,
          parallelToolCalls: false,
        },
      );
      modelMsUsed += resp.latencyMs;
      modelLog.push({
        model: resp.model,
        latencyMs: resp.latencyMs,
        finishReason: resp.finishReason,
        promptTokens: resp.usage.promptTokens,
        completionTokens: resp.usage.completionTokens,
        toolCalls: resp.toolCalls.length,
        retry: false,
      });
      const call = resp.toolCalls.find((c) => c.function?.name === SUBMIT_PLAN);
      let parsed: unknown = null;
      try {
        parsed = call ? JSON.parse(call.function?.arguments || '{}') : null;
      } catch {
        parsed = null;
      }
      const checked = SubmitPlanArgs.safeParse(parsed);
      if (checked.success) plan = checked.data;
      else errors.push('the planner returned no usable plan; the worker runs without one');
    } catch (e) {
      errors.push(
        `planner plan failed (${e instanceof Error ? e.message : String(e)}); the worker runs without one`,
      );
    }
  }

  const contextBlocks = [mapBlock, docsBlock, opts.history?.context ?? ''].filter(Boolean);
  if (plan) contextBlocks.push(planBlock(plan));
  // El nombre de la pregunta casó con varios contratos: se le dan todos, con el
  // servicio de cada uno, para que no elija uno en silencio.
  const candidatesBlock =
    opts.contractCandidates && opts.contractCandidates.length > 1
      ? `The name in the question matches more than one contract. Candidates: ${opts.contractCandidates
          .map((c) => `${c.key} (service ${c.service})`)
          .join(
            '; ',
          )}. Work out which one the question is about, or answer for each of them; do not pick one silently.`
      : '';
  if (candidatesBlock) contextBlocks.push(candidatesBlock);
  // Un ejemplo corto del tipo de pregunta (few-shot): cómo se encadenan las herramientas y
  // qué afirmaciones se presentan. Sólo uno, y nada en modo PR ni si el tipo no se reconoce.
  const playbook =
    prFindings || opts.playbooks === false
      ? null
      : playbookFor(opts.question, { web: Boolean(opts.web) });
  if (playbook?.text) contextBlocks.push(playbook.text);
  const messages: ChatMessage[] = [
    { role: 'system', content: prFindings ? PR_SYSTEM_PROMPT : SYSTEM_PROMPT },
    // Turnos recientes de la conversación, como hilo normal de chat.
    ...(opts.history?.recent ?? []).flatMap((t): ChatMessage[] => [
      { role: 'user', content: t.question },
      { role: 'assistant', content: t.answer },
    ]),
    {
      role: 'user',
      content:
        prFindings && opts.pr
          ? [renderFindingsBlock(prFindings, opts.pr.coverage), mapBlock]
              .filter(Boolean)
              .join('\n\n')
          : contextBlocks.length > 0
            ? `${contextBlocks.join('\n\n')}\n\nQuestion: ${opts.question}`
            : opts.question,
    },
  ];
  let answer: string | null = null;
  let effectiveModel: string | null = null;
  let status = 'failed:no_answer';
  let rounds = 0;
  let retried = false;
  let pushedBack = false;
  let submitNudged = false;
  let softNudged = false;
  let locationPushedBack = false;
  let claimsPushedBack = false;
  let absencePushedBack = false;
  let webPushedBack = false;
  let webUncitedPushedBack = false;
  /** El borrador del trabajador (el relevo): lo reescribe el planificador. */
  let draft: { answer: string } | null = null;
  /** Las afirmaciones del MOTOR sobre la entrega aceptada (verificadas dentro del bucle). */
  let verifiedClaims: ClaimResult[] = [];
  let prSubmission: PrSubmitArgs | null = null;

  // El tope de rondas evita bucles infinitos con un modelo que sólo pide
  // herramientas inválidas; el tiempo límite es el presupuesto real.
  // Los errores del motor no consumen presupuesto, así que las rondas dejan
  // margen proporcional para que un modelo que se corrige no se quede sin ellas.
  const maxRounds = budget.maxToolCalls * 2 + 2;
  const deadline = nowMs() + budget.maxModelMs;

  // Sin servicios en el catálogo toda lectura quedaría fuera de alcance: se
  // dice por qué y no se gasta el modelo (P08: nunca un no_answer mudo).
  const catalog = await dispatcher.catalogStatus();
  const preflightFailure = catalog.error
    ? {
        status: 'failed:catalog_unavailable',
        message: `service catalog unavailable: ${catalog.error}`,
      }
    : catalog.empty
      ? {
          status: 'failed:empty_service_catalog',
          message:
            'LAIN reports no configured services for this view (list_services is empty). Declare services in the LAIN config (services: name/repo) and reindex.',
        }
      : null;
  if (preflightFailure) errors.push(preflightFailure.message);

  // Las afirmaciones se comprueban DURANTE el bucle, no al final: lo que se
  // contradice tiene que volver al modelo con lo que el motor leyó de verdad.
  const cleanedValidate = async (refs: readonly string[]) => {
    const r = await validateRefs(
      opts.lain,
      view,
      [...new Set(refs.map(cleanRef).filter(Boolean))],
      dispatcher,
      opts.pr?.baseView,
    );
    return { accepted: r.accepted, receipts: r.receipts, rejected: r.rejected };
  };
  const claimDeps = {
    lain: opts.lain,
    view,
    resolveService: (name: string) => dispatcher.resolveService(name),
    validateRefs: cleanedValidate,
    hasRepo: (name: string) => dispatcher.hasRepo(name),
    ...(opts.docsSection ? { docSection: opts.docsSection } : {}),
  };

  while (!preflightFailure && rounds < maxRounds) {
    // La primera llamada siempre se intenta; el límite se aplica a partir de
    // la segunda para que un presupuesto ya consumido por arranque no impida
    // ni siquiera la primera consulta.
    if (rounds > 0 && nowMs() >= deadline) {
      status = 'failed:model_time_budget';
      errors.push(`model time budget exhausted (${budget.maxModelMs} ms)`);
      break;
    }

    // Convergencia: cuando queda una sola lectura o poco tiempo, el modelo ya no
    // elige — la siguiente llamada ES la entrega. Así una investigación termina
    // siempre en una respuesta (aunque diga lo que no pudo comprobar) en vez de
    // buscar hasta agotar el presupuesto.
    const used = dispatcher.budgetUse().toolCallsUsed;
    const mustSubmit =
      opts.toolChoice === undefined &&
      used > 0 &&
      // Las llamadas rechazadas (repetidas, sobre el tope de una herramienta) no gastan
      // lecturas pero SÍ rondas: contar sólo lecturas dejaría dar vueltas sin fin.
      (used >= budget.maxToolCalls - 1 ||
        rounds >= budget.maxToolCalls ||
        deadline - nowMs() < budget.maxModelMs * 0.3);
    opts.onProgress?.({
      type: 'round',
      round: rounds + 1,
      toolCallsUsed: used,
      maxToolCalls: budget.maxToolCalls,
      forced: mustSubmit,
    });
    let resp: NemotronResponse;
    try {
      resp = await opts.model.complete(messages, {
        model: modelRole,
        tools,
        toolChoice: mustSubmit
          ? { type: 'function', function: { name: SUBMIT_TOOL } }
          : (opts.toolChoice ?? 'auto'),
        maxTokens,
        ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
        // Forzando la entrega, UNA llamada: con varias el modelo la repetía hasta agotar los tokens.
        ...(mustSubmit ? { parallelToolCalls: false } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isRetryableError(e) && !retried && nowMs() < deadline) {
        // Timeout o 429: se reintenta UNA vez dentro del presupuesto (§14).
        retried = true;
        await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? RETRY_DELAY_MS));
        modelLog.push({
          model: 'unknown',
          latencyMs: 0,
          finishReason: isTimeoutError(e) ? 'timeout' : 'rate_limited',
          promptTokens: 0,
          completionTokens: 0,
          toolCalls: 0,
          retry: true,
        });
        errors.push(`model call failed (${message}); retrying within budget`);
        continue;
      }
      status = isTimeoutError(e) ? 'failed:model_timeout' : 'failed:model_error';
      errors.push(message);
      break;
    }

    // Una respuesta con cientos de llamadas es una repetición degenerada, no un plan:
    // se conservan las primeras (una sola si se forzó la entrega). Si no, cada una
    // recibe su mensaje de herramienta y el historial crece decenas de miles de tokens.
    const maxCalls = mustSubmit ? 1 : MAX_CALLS_PER_ROUND;
    if (resp.toolCalls.length > maxCalls) {
      errors.push(
        `model sent ${resp.toolCalls.length} tool calls in one reply; only the first ${maxCalls} were kept`,
      );
      resp = { ...resp, toolCalls: resp.toolCalls.slice(0, maxCalls) };
    }

    modelMsUsed += resp.latencyMs;
    effectiveModel = resp.model;
    modelLog.push({
      model: resp.model,
      latencyMs: resp.latencyMs,
      finishReason: resp.finishReason,
      promptTokens: resp.usage.promptTokens,
      completionTokens: resp.usage.completionTokens,
      toolCalls: resp.toolCalls.length,
      retry: false,
    });

    if (resp.toolCalls.length === 0) {
      // Un modelo que contesta sin leer nada sólo puede repetir el mapa del
      // workspace. Se le devuelve UNA vez a reunir evidencia; si insiste, su
      // respuesta sigue su curso y la validación de citas la declara fallida.
      if (!opts.pr && !pushedBack && dispatcher.budgetUse().toolCallsUsed === 0) {
        pushedBack = true;
        messages.push({ role: 'assistant', content: resp.content });
        messages.push({
          role: 'user',
          content:
            'You answered without using any tool. The workspace map is orientation, not evidence. Gather facts with the tools, then answer citing the evidence ids they return.',
        });
        rounds++;
        continue;
      }
      // Un modelo que cierra con prosa tras leer del motor no deja afirmaciones
      // que el motor pueda verificar (ni un foco para el mapa). Se le pide UNA
      // vez que entregue con submit_answer; si insiste en prosa, se acepta.
      if (
        opts.nudgeSubmit &&
        !opts.pr &&
        !submitNudged &&
        resp.content &&
        dispatcher.budgetUse().toolCallsUsed > 0
      ) {
        submitNudged = true;
        // Cortada (o con la llamada a medio escribir): se pide algo más corto.
        const cutOff = resp.finishReason === 'length' || hasTextToolCall(resp.content);
        messages.push({
          role: 'assistant',
          content: cutOff ? stripToolMarkup(resp.content ?? '').slice(0, 400) : resp.content,
        });
        messages.push({
          role: 'user',
          content: cutOff
            ? 'Your previous reply was cut off before it finished. Call submit_answer again with a SHORT "answer" (at most about 150 words, no endpoint lists) and the relation claims.'
            : 'Now finish by calling submit_answer. Put the explanation in "answer" and every statement about which service consumes which other service in "claims" as relation claims, so the engine can verify them.',
        });
        rounds++;
        continue;
      }
      answer = hasTextToolCall(resp.content)
        ? stripToolMarkup(resp.content ?? '')
        : (resp.content ?? '');
      break;
    }

    messages.push({
      role: 'assistant',
      content: resp.content,
      tool_calls: resp.toolCalls,
    });

    // submit_answer cierra la investigación: no es una lectura del motor.
    const submit = resp.toolCalls.find((c) => c.function?.name === SUBMIT_TOOL);
    if (submit) {
      const reject = (code: string, message: string): void => {
        for (const call of resp.toolCalls) {
          const own = call.id === submit.id;
          toolCallLog.push({
            toolCallId: call.id,
            tool: call.function?.name ?? '',
            args: call.function?.arguments ?? '',
            ok: false,
            code: own ? code : 'ignored',
            latencyMs: 0,
            resultChars: message.length,
            truncated: false,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: {
                code: own ? code : 'ignored',
                message: own
                  ? message
                  : 'submit_answer ends the investigation; other calls in the same turn are not executed',
              },
            }),
          });
        }
        rounds++;
      };
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(submit.function?.arguments || '{}');
      } catch {
        parsedArgs = null;
      }
      const checked = opts.pr
        ? PrSubmitArgs.safeParse(parsedArgs)
        : SubmitAnswerArgs.safeParse(parsedArgs);
      if (!checked.success) {
        reject(
          'invalid_schema',
          `invalid arguments for ${SUBMIT_TOOL}: ${checked.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ')}`,
        );
        continue;
      }
      if (!opts.pr && !pushedBack && dispatcher.budgetUse().toolCallsUsed === 0) {
        pushedBack = true;
        reject(
          'no_evidence',
          'You submitted without using any tool. The workspace map is orientation, not evidence. Gather facts with the tools, then call submit_answer again.',
        );
        continue;
      }
      // Una respuesta que afirma archivo:línea sin afirmaciones de lugar deja lo más
      // concreto que dice sin comprobar: se devuelve UNA vez para que el motor lo lea.
      if (!opts.pr && !locationPushedBack) {
        const qa = checked.data as SubmitAnswerArgs;
        const stated = extractFileLines(qa.answer);
        // Una cita de un documento también es un lugar comprobable: la cuenta.
        const hasLocation = (qa.claims ?? []).some(
          (c) => c.kind === 'location' || c.kind === 'doc_quote',
        );
        if (stated.length > 0 && !hasLocation) {
          locationPushedBack = true;
          opts.onProgress?.({ type: 'wrapup', reason: 'locations' });
          reject(
            'location_claims_missing',
            `Your answer states code locations (${stated.slice(0, 6).join(', ')}) but submits no location claim. Call submit_answer again with the same answer plus one location claim per file:line you state: repo, path, line, and "contains" = the exact symbol or text that must be on or near that line. The engine reads the code back to verify them.`,
          );
          continue;
        }
      }
      // "No hay documentación" sin haber buscado: se devuelve UNA vez. La ausencia
      // de documentación es una afirmación: para sostenerla hay que haber buscado.
      if (
        !opts.pr &&
        !absencePushedBack &&
        docHintEmpty &&
        !dispatcher.toolUsed('find_docs') &&
        claimsNoDocs((checked.data as SubmitAnswerArgs).answer)
      ) {
        absencePushedBack = true;
        reject(
          'absence_unsupported',
          'Your answer says there is no documentation, but this question received no documentation hint and find_docs was never called. Call find_docs with the topic and read what it returns before saying that a document does not exist; if it returns nothing, then say so.',
        );
        continue;
      }
      // "Según la documentación oficial" sin haber buscado en la web: la fuente se inventó.
      if (
        opts.web &&
        !webPushedBack &&
        !dispatcher.toolUsed('web_search') &&
        /\b(per|according to) (the )?(official )?(docs|documentation)\b|\bofficial (docs|documentation) (say|says|state|states|recommend)/i.test(
          (checked.data as SubmitAnswerArgs).answer,
        )
      ) {
        webPushedBack = true;
        reject(
          'web_source_unsupported',
          'Your answer attributes a statement to official documentation, but web_search was never called, so you have no such source. Call web_search for the public library or standard and cite what it returns; or drop the attribution and say the answer comes from the repositories only.',
        );
        continue;
      }
      // Buscó en la web y no cita nada de ella: lo que dice de la librería queda sin fuente
      // (medido en vivo: dos de dos respuestas usaron web_search y no atribuyeron nada).
      if (
        opts.web &&
        // En el relevo el trabajador sólo entrega un borrador: atribuir es cosa del escritor.
        !opts.handoff &&
        !webUncitedPushedBack &&
        dispatcher.toolUsed('web_search') &&
        !citesWeb((checked.data as SubmitAnswerArgs).claims)
      ) {
        webUncitedPushedBack = true;
        reject('web_uncited', WEB_UNCITED_MESSAGE);
        continue;
      }
      const acceptSubmit = (): void => {
        toolCallLog.push({
          toolCallId: submit.id,
          tool: SUBMIT_TOOL,
          args: submit.function?.arguments ?? '',
          ok: true,
          latencyMs: 0,
          resultChars: 0,
          truncated: false,
        });
      };
      if (opts.pr) {
        acceptSubmit();
        prSubmission = checked.data as PrSubmitArgs;
        answer = prSubmission.summary;
      } else {
        const qa = checked.data as SubmitAnswerArgs;
        // En el relevo, lo que entrega el trabajador es un BORRADOR: lo
        // reescribe el planificador y sus afirmaciones son las que se comprueban.
        if (opts.handoff) {
          draft = { answer: qa.answer };
          answer = qa.answer;
          break;
        }
        // El motor adjudica las afirmaciones ANTES de que la respuesta sea final:
        // lo que se contradice vuelve al modelo con lo que el motor leyó de
        // verdad, UNA vez, para que lo corrija en vez de repetirlo.
        const results = qa.claims?.length ? await verifyClaims(qa.claims, claimDeps) : [];
        opts.onProgress?.({ type: 'verify', claims: qa.claims?.length ?? 0 });
        const contradiction = describeContradictions(results);
        if (contradiction && !claimsPushedBack) {
          claimsPushedBack = true;
          reject(
            'claims_contradicted',
            `${contradiction}\n\nFix the claim to match what the engine read, or drop it and state the fact without a checkable claim. Then call submit_answer again.`,
          );
          continue;
        }
        acceptSubmit();
        answer = qa.answer;
        verifiedClaims = results;
      }
      break;
    }

    for (const call of resp.toolCalls) {
      const result = await dispatcher.execute(call);
      const content = result.ok
        ? JSON.stringify({
            ok: true,
            tool: result.tool,
            receipt: result.receipt,
            data: result.data,
            ...(result.truncated ? { cut_declared: result.truncated } : {}),
          })
        : JSON.stringify({ ok: false, error: { code: result.code, message: result.message } });
      toolCallLog.push({
        toolCallId: call.id,
        tool: result.tool,
        args: call.function?.arguments ?? '',
        ok: result.ok,
        ...(result.ok ? {} : { code: result.code }),
        latencyMs: result.latencyMs,
        resultChars: content.length,
        truncated: result.ok && result.truncated != null,
      });
      // El escritor del relevo ve exactamente lo que vio el trabajador.
      toolResults.push(content);
      messages.push({ role: 'tool', tool_call_id: call.id, content });
      opts.onProgress?.({
        type: 'tool',
        tool: result.tool,
        summary: summarizeCall(call.function?.arguments ?? ''),
        ok: result.ok,
        ms: result.latencyMs,
        ...(result.ok ? {} : { note: result.code }),
      });
      if (!result.ok && result.code === 'budget_exhausted') {
        // No se corta la ronda: cada tool_call restante recibe también su
        // budget_exhausted tipado (el historial role=tool debe estar completo
        // para el siguiente turno del modelo) y el despachante ya no ejecuta
        // lecturas porque su contador está agotado.
        errors.push('tool budget exhausted during round');
      }
    }
    // A partir del 60% del presupuesto se le dice, una vez, que cierre.
    const usedNow = dispatcher.budgetUse().toolCallsUsed;
    if (
      !softNudged &&
      Math.max(usedNow, rounds + 1) >= Math.ceil(budget.maxToolCalls * SOFT_NUDGE_AT)
    ) {
      softNudged = true;
      opts.onProgress?.({ type: 'wrapup', reason: 'budget' });
      messages.push({
        role: 'user',
        content: `You have used ${usedNow} of ${budget.maxToolCalls} tool calls. Unless one specific fact is still missing, stop researching and call submit_answer now with what you have, saying plainly what you could not verify.`,
      });
    }
    rounds++;
  }

  if (preflightFailure) status = preflightFailure.status;

  // ── El relevo, fase 3: el planificador escribe la respuesta final ───────
  // El trabajador entregó un borrador; el planificador ve los resultados y el
  // borrador, y escribe la respuesta con sus afirmaciones. Si la escritura
  // falla, se queda el borrador: la investigación no pierde lo que ya tenía.
  if (opts.handoff && !opts.pr && answer !== null) {
    if (nowMs() >= deadline) {
      // El presupuesto de tiempo manda: sin escritor, se queda el borrador.
      errors.push('model time budget exhausted before the writer ran; the draft stands');
    } else {
      const writeMessages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: writeBlock({
            question: opts.question,
            ...(mapBlock ? { map: mapBlock } : {}),
            plan,
            toolResults,
            draft,
            citableIds: dispatcher.deliveredEvidence(),
            receipts: dispatcher.receipts().map((r) => r.id),
            webSearched: opts.web !== undefined && dispatcher.toolUsed('web_search'),
          }),
        },
      ];
      // El escritor escribe la respuesta Y sus afirmaciones: necesita más sitio
      // que una ronda de lectura. Si se corta, se le da más y se le pide otra vez.
      const writerTokens = (attempt: number): number =>
        Math.min(16384, Math.max(maxTokens, 4096) * 2 ** attempt);
      let bounceUsed = false;
      let writerWebBounced = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let resp: NemotronResponse;
        try {
          resp = await opts.model.complete(writeMessages, {
            model: 'planner',
            tools: [SUBMIT_TOOL_SPEC],
            toolChoice: { type: 'function', function: { name: SUBMIT_TOOL } },
            maxTokens: writerTokens(attempt),
            ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
            parallelToolCalls: false,
          });
        } catch (e) {
          errors.push(
            `the writer failed (${e instanceof Error ? e.message : String(e)}); the draft of the worker stands`,
          );
          break;
        }
        modelMsUsed += resp.latencyMs;
        modelLog.push({
          model: resp.model,
          latencyMs: resp.latencyMs,
          finishReason: resp.finishReason,
          promptTokens: resp.usage.promptTokens,
          completionTokens: resp.usage.completionTokens,
          toolCalls: resp.toolCalls.length,
          retry: false,
        });
        const call = resp.toolCalls.find((c) => c.function?.name === SUBMIT_TOOL);
        if (!call) {
          // Se cortó antes de empezar la llamada: más sitio y otra vez.
          if (resp.finishReason === 'length' && attempt < 2) {
            errors.push(
              `the writer's reply was cut off at ${writerTokens(attempt)} tokens; retrying with more room`,
            );
            writeMessages.push({
              role: 'user',
              content:
                'Your previous reply was cut off before the tool call was complete. Call submit_answer again with a SHORTER answer (at most about 150 words, no lists of operations) and the claims behind it.',
            });
            continue;
          }
          errors.push('the writer delivered no answer; the draft of the worker stands');
          break;
        }
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(call.function?.arguments || '{}');
        } catch {
          parsed = null;
        }
        const checked = SubmitAnswerArgs.safeParse(parsed);
        if (!checked.success) {
          // Una respuesta cortada por el límite de tokens deja el JSON a medias:
          // se le da más sitio y se le pide otra vez, más corta.
          if (resp.finishReason === 'length' && attempt < 2) {
            errors.push(
              `the writer's reply was cut off at ${writerTokens(attempt)} tokens; retrying with more room`,
            );
            writeMessages.push({
              role: 'user',
              content:
                'Your previous reply was cut off before the tool call was complete. Call submit_answer again with a SHORTER answer (at most about 150 words, no lists of operations) and the claims behind it.',
            });
            continue;
          }
          errors.push('the writer delivered an invalid answer; the draft of the worker stands');
          break;
        }
        // El escritor es quien redacta la respuesta final: lo que busque en la web se atribuye aquí.
        if (
          opts.web &&
          !writerWebBounced &&
          dispatcher.toolUsed('web_search') &&
          !citesWeb(checked.data.claims)
        ) {
          writerWebBounced = true;
          writeMessages.push({ role: 'assistant', content: resp.content, tool_calls: [call] });
          writeMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: { code: 'web_uncited', message: WEB_UNCITED_MESSAGE },
            }),
          });
          continue;
        }
        const results = checked.data.claims?.length
          ? await verifyClaims(checked.data.claims, claimDeps)
          : [];
        opts.onProgress?.({ type: 'verify', claims: checked.data.claims?.length ?? 0 });
        const contradiction = describeContradictions(results);
        // Al escritor se le devuelve UNA vez lo que el motor contradice, con lo
        // que leyó de verdad: es el que escribió la afirmación.
        if (contradiction && !bounceUsed) {
          bounceUsed = true;
          writeMessages.push({
            role: 'assistant',
            content: resp.content,
            tool_calls: [call],
          });
          writeMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: {
                code: 'claims_contradicted',
                message: `${contradiction}\n\nFix the claim to match what the engine read, or drop it and state the fact without a checkable claim. Then call submit_answer again.`,
              },
            }),
          });
          continue;
        }
        answer = checked.data.answer;
        verifiedClaims = results;
        break;
      }
    }
  }

  // Modo PR: el backend contrasta la entrega con los hallazgos del motor y compone
  // la narrativa (hechos deterministas + explicación del modelo por id).
  const prResult: PrVerification | null =
    prFindings && opts.pr && prSubmission && answer != null
      ? await verifyPrSubmission(prFindings, prSubmission, opts.pr.coverage, async (refs) => {
          const r = await cleanedValidate(refs);
          return { accepted: r.accepted, rejected: r.rejected };
        })
      : null;
  if (prResult) answer = prResult.narrative;
  // Lo que escribió el modelo (no la narrativa compuesta) es lo que se contrasta
  // con las clases del motor y de donde se extraen las citas.
  const modelText = prResult ? prResult.modelText : answer;

  const checkedCitations =
    modelText != null
      ? await validateCitations(opts.lain, view, modelText, dispatcher, opts.pr?.baseView)
      : { accepted: [], receipts: [], rejected: [] };
  const citations = prResult
    ? {
        accepted: [
          ...new Set([
            ...checkedCitations.accepted,
            ...prResult.findings.flatMap((f) => f.evidence.accepted),
          ]),
        ],
        rejected: [
          ...new Map(
            [
              ...checkedCitations.rejected,
              ...prResult.findings.flatMap((f) => f.evidence.rejected),
            ].map((r) => [r.ref, r as CitationRejection]),
          ).values(),
        ],
      }
    : { accepted: checkedCitations.accepted, rejected: checkedCitations.rejected };
  const conflictingClaims =
    modelText != null
      ? detectClassificationConflicts(modelText, opts.engineFindings ?? opts.pr?.changes ?? [])
      : [];

  // El motor adjudicó las afirmaciones dentro del bucle: lo que se contradice
  // se señaló en el veredicto y en el resumen, sin tocar la prosa ni el estado.
  const claims = verifiedClaims;
  const claimsSummary = summarizeClaims(claims);

  if (prResult) {
    // Los hallazgos son hechos del motor: no hace falta una cita nueva para que
    // la explicación valga, pero cada hallazgo debe estar explicado.
    status = prResult.unaddressed.length > 0 ? 'failed:findings_unaddressed' : 'available';
  } else if (answer != null) {
    // El validador ya sabe si hubo citas: accepted + rejected son las que
    // reconoció. Volver a extraerlas aquí sería otra interpretación del texto.
    const cited = citations.accepted.length + citations.rejected.length;
    // Una relación verificada por el motor sostiene la respuesta sin ancla de
    // código (una ausencia correcta no tiene ninguna que citar), y una nota cuya
    // evidencia se resolvió también.
    if (citations.accepted.length > 0 || claimsSummary.verified + claimsSummary.supported > 0) {
      status = 'available';
    } else if (cited === 0 && checkedCitations.receipts.length === 0 && claims.length === 0) {
      status = 'failed:citations_missing';
    } else {
      status = 'failed:citations_unresolved';
    }
  }

  const use = dispatcher.budgetUse();
  return {
    explanationStatus: status,
    answer,
    citations,
    conflictingClaims,
    budget: {
      maxToolCalls: budget.maxToolCalls,
      maxModelMs: budget.maxModelMs,
      toolCallsUsed: use.toolCallsUsed,
      exhausted: use.exhausted || status.startsWith('failed:model_time'),
      cutShort: use.cutShort,
      modelMsUsed,
      rounds,
      promptTokens: modelLog.reduce((n, m) => n + m.promptTokens, 0),
      completionTokens: modelLog.reduce((n, m) => n + m.completionTokens, 0),
    },
    toolCallLog,
    modelLog,
    effectiveModel,
    promptVersion: PROMPT_VERSION,
    questionType: prFindings ? null : classifyQuestion(opts.question),
    consumedEdges: dispatcher.consumedEdges(),
    claims,
    claimsSummary,
    receipts: dispatcher.receipts(),
    citedReceipts: checkedCitations.receipts,
    pr: prResult
      ? {
          findings: prResult.findings,
          unaddressed: prResult.unaddressed,
          unknownIds: prResult.unknownIds,
        }
      : null,
    errors,
  };
}

// INV 1: sólo una ref entregada por el backend y resoluble en la vista pasa.
const RECEIPT_REF = /^q:\d+$/;

// Valida refs contra lo que el backend entregó y el motor resuelve (INV 1). Un
// recibo de consulta (q:N) es válido si existe en ESTA investigación.
async function validateRefs(
  lain: LainAdapter,
  view: LainView,
  refs: readonly string[],
  dispatcher: LainDispatcher,
  fallbackView?: LainView,
): Promise<ClaimEvidence & { rejected: CitationRejection[] }> {
  const delivered = new Set(dispatcher.deliveredEvidence());
  const rejected: CitationRejection[] = [];
  const receipts: string[] = [];
  const candidates: string[] = [];
  for (const ref of refs) {
    if (RECEIPT_REF.test(ref)) {
      if (dispatcher.hasReceipt(ref)) receipts.push(ref);
      else rejected.push({ ref, reason: 'not_delivered_by_backend' });
    } else if (!delivered.has(ref)) {
      // Referencia inventada o fuera de la vista: se rechaza, no se oculta.
      rejected.push({ ref, reason: 'not_delivered_by_backend' });
    } else {
      candidates.push(ref);
    }
  }
  if (candidates.length === 0) return { accepted: [], receipts, rejected };

  try {
    const resolved = await lain.resolveEvidence({ snapshot: view, refs: candidates });
    const accepted: string[] = [];
    const byRef = new Map(resolved.items.map((item) => [item.ref, item]));
    const unresolved = candidates.filter((ref) => byRef.get(ref)?.exists !== true);
    for (const ref of candidates) {
      if (byRef.get(ref)?.exists === true) accepted.push(ref);
    }
    // Lo que no existe en la vista de la explicación puede existir en la base del
    // mismo análisis (código eliminado por el PR); sólo entonces se rechaza.
    let stillUnresolved = unresolved;
    if (unresolved.length > 0 && fallbackView && fallbackView !== view) {
      try {
        const alt = await lain.resolveEvidence({ snapshot: fallbackView, refs: unresolved });
        const altByRef = new Map(alt.items.map((item) => [item.ref, item]));
        stillUnresolved = [];
        for (const ref of unresolved) {
          if (altByRef.get(ref)?.exists === true) accepted.push(ref);
          else stillUnresolved.push(ref);
        }
      } catch {
        // Sin base consultable, el rechazo original se mantiene.
      }
    }
    for (const ref of stillUnresolved) rejected.push({ ref, reason: 'unresolvable_in_view' });
    return { accepted, receipts, rejected };
  } catch {
    // Sin resolución no hay cita publicable: queda el rechazo visible.
    for (const ref of candidates) {
      rejected.push({ ref, reason: 'unresolvable_in_view' });
    }
    return { accepted: [], receipts, rejected };
  }
}

// Citas de la prosa: el marcador puede venir reescrito por el modelo; por eso se
// le pasan los ids entregados para reconocerlos aunque cambie la puntuación.
async function validateCitations(
  lain: LainAdapter,
  view: LainView,
  answer: string,
  dispatcher: LainDispatcher,
  fallbackView?: LainView,
): Promise<ClaimEvidence & { rejected: CitationRejection[] }> {
  const refs = extractCitationRefs(answer, dispatcher.deliveredEvidence());
  return validateRefs(lain, view, refs, dispatcher, fallbackView);
}

export interface ExplanationPayload {
  prompt_version: string;
  model: string | null;
  endpoint: string | null;
  question: string;
  /** Prosa del modelo, con marcadores [ev:] tal como la produjo. */
  narrative: string | null;
  citations: { accepted: string[]; rejected: CitationRejection[] };
  /** Conflictos INV 2: la prosa no coincide con la clase del motor. */
  conflicting_claims: ClassificationConflict[];
  /** Clases del motor, copiadas VERBATIM: la autoridad es engine_json. */
  engine_finding_classes: Array<{ endpoint: string; service: string | null; class: string }>;
  budget: InvestigationResult['budget'];
  /** Afirmaciones tipadas con el veredicto del motor; una contradicha se señala aquí. */
  claims: ClaimResult[];
  claims_summary: ClaimsSummary;
  receipts: Receipt[];
  /** Modo PR: explicación por hallazgo (clase del motor verbatim + explicación del modelo). */
  pr: InvestigationResult['pr'];
  tool_calls: ToolCallRecord[];
  model_calls: ModelCallRecord[];
  errors: string[];
}

// Serializador INV 2: los campos del motor (clases) se copian verbatim desde
// los hallazgos del motor; la explicación vive en campos propios del modelo.
// Ningún campo del motor se deriva de la prosa.
export function serializeExplanation(
  result: InvestigationResult,
  opts: { question: string; endpointLabel?: string; engineFindings?: unknown[] },
): ExplanationPayload {
  const engineClasses = (opts.engineFindings ?? []).flatMap((raw) => {
    const finding = (raw ?? {}) as {
      endpoint?: { key?: string; service?: string };
      impact?: { class?: string };
    };
    const key = finding.endpoint?.key;
    const cls = finding.impact?.class;
    if (!key || !cls) return [];
    return [
      {
        endpoint: key,
        service: finding.endpoint?.service ?? null,
        class: cls,
      },
    ];
  });
  return {
    prompt_version: result.promptVersion,
    model: result.effectiveModel,
    endpoint: opts.endpointLabel ?? null,
    question: opts.question,
    narrative: result.answer,
    citations: result.citations,
    conflicting_claims: result.conflictingClaims,
    engine_finding_classes: engineClasses,
    budget: result.budget,
    claims: result.claims,
    claims_summary: result.claimsSummary,
    receipts: result.receipts,
    pr: result.pr,
    tool_calls: result.toolCallLog,
    model_calls: result.modelLog,
    errors: result.errors,
  };
}
