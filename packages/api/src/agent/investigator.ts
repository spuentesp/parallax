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
  type LainDispatcher,
  type Receipt,
} from './dispatcher.js';
import { memoizeReads } from './memo-lain.js';
import {
  type ChatMessage,
  hasTextToolCall,
  type NemotronResponse,
  stripToolMarkup,
  type ToolSpec,
} from './nemotron.js';
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

export const PROMPT_VERSION = 'parallax-investigator-v8';

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
  maxResultChars?: number;
}

const SYSTEM_PROMPT = `You are Parallax's architecture investigator. You answer questions about a fixed code workspace using ONLY the read-only research tools provided. The workspace view was fixed by the analysis: you cannot choose snapshots, repos outside the workspace, or any write/publish tool.

Method:
1. Gather facts with the tools before answering. The workspace map in the question already lists the services, so do not call list_services just to learn them. consumers_of summarizes who consumes a service and through which endpoints, each with a citable evidence id; get_service gives the raw detail; trace_impact shows who depends on an endpoint; resolve_evidence/read_source verify code locations; list_unresolved and get_coverage tell you what remains unknown.
1b. Code questions ("where is X implemented", "what does changing X break", "how does A reach B") use the code tools, not the contract tools: search_code or search_org to LOCATE a feature by words, find_symbol for an exact name, get_context / get_call_sites / get_call_chain to follow it, get_blast_radius or get_cross_repo_blast_radius for what a change affects, find_anchors / understand_repository to orient in a repo. They return file:line; you may state those locations, but a code location is not evidence of a service relation: relation claims still rest on consumers_of / trace_impact. Do not guess paths for read_source: find them with search_code first. For "why", "how do we", conventions, decisions or how to run/test/contribute, use find_docs FIRST: the repositories document themselves (ADRs, AGENTS.md / CLAUDE.md, CONTRIBUTING, README, docs/). Read the one best file with get_code_snippet, quote it, and add a location claim whose contains field is a phrase from the line you read; say "documented" for what comes from a doc and "observed" for what comes from code, and when they disagree say so. If nothing is documented, say that. Stop researching once you can answer: about 6 calls is usually enough.
2. Every factual conclusion MUST cite at least one evidence id you actually received in tool results. Write the id exactly as it appears in the tool result inside the marker, with no angle brackets, quotes or placeholders, for example [ev:billing:Function:src/main.py:fetch_me:35]. Evidence ids are the long anchor strings found in tool results (fields like site.id or caller.id); service names and tool names are not evidence ids. Never invent ids, paths or refs. If you did not receive an id, do not cite it.
3. You cannot change engine classifications. If a finding is NeedsInvestigation or NoKnownImpact, keep it; explain what is unknown and what evidence would resolve it.
4. For design proposals (e.g. a BFF): identify existing contracts/capabilities to reuse, separate DECISIONS from HYPOTHESES explicitly, and list open operational questions. A proposal must not modify the observed map — mark every hypothetical relation as such.
5. If a tool result declares a cut (truncation), ask for a narrower detail call instead of guessing the omitted part.
6. If you cannot verify something, say it is unknown. Never hide uncertainty. Answer in the language of the question.
7. Finish by calling submit_answer. Put the explanation for the human in "answer". Put every statement about whether one service consumes another in "claims" as a relation claim (polarity "present" or "absent"): the engine verifies those itself, so an absence needs no code anchor. If you state any file:line in your answer you MUST add a location claim for it (an answer with file:line and no location claim is sent back). Every file:line you state goes in a location claim (repo, path, line, and "contains": the exact symbol or text that must be on or within a few lines of that line): the engine reads the code back and verifies it (if the location comes from an engine evidence id, also put that id in the claim's "evidence", and make "contains" a name that is literally in the source). Every other statement you want checked goes in a note claim with the evidence ids that support it. Each tool result carries a "receipt" id (q:N) you may cite for what a query returned.
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
    ...(opts.maxResultChars !== undefined ? { maxResultChars: opts.maxResultChars } : {}),
  });
  const prFindings = opts.pr ? buildFindings(opts.pr.changes) : null;
  if (prFindings) dispatcher.deliverEvidence(prFindings.flatMap((f) => f.evidenceIds));
  const tools = [...dispatcher.toolSpecs(), opts.pr ? PR_SUBMIT_SPEC : SUBMIT_TOOL_SPEC];
  const modelRole = opts.modelRole ?? 'worker';
  // Una respuesta con muchas afirmaciones y citas supera con facilidad 2048:
  // el valor por defecto sale de la config (INVESTIGATOR_MAX_TOKENS, 4096).
  const maxTokens = opts.maxTokens ?? 4096;

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
  const docsBlock = docLines
    ? `Documentation files in the repositories that may cover this (read the best one with get_code_snippet before answering a why / convention / decision question, and cite it):\n${docLines}`
    : '';
  const contextBlocks = [mapBlock, docsBlock, opts.history?.context ?? ''].filter(Boolean);
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
  const toolCallLog: ToolCallRecord[] = [];
  const modelLog: ModelCallRecord[] = [];
  const errors: string[] = [];
  let answer: string | null = null;
  let effectiveModel: string | null = null;
  let status = 'failed:no_answer';
  let rounds = 0;
  let modelMsUsed = 0;
  let retried = false;
  let pushedBack = false;
  let submitNudged = false;
  let softNudged = false;
  let locationPushedBack = false;
  let submittedClaims: Claim[] = [];
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
        const hasLocation = (qa.claims ?? []).some((c) => c.kind === 'location');
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
      toolCallLog.push({
        toolCallId: submit.id,
        tool: SUBMIT_TOOL,
        args: submit.function?.arguments ?? '',
        ok: true,
        latencyMs: 0,
        resultChars: 0,
        truncated: false,
      });
      if (opts.pr) {
        prSubmission = checked.data as PrSubmitArgs;
        answer = prSubmission.summary;
      } else {
        const qa = checked.data as SubmitAnswerArgs;
        answer = qa.answer;
        submittedClaims = qa.claims ?? [];
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

  // Modo PR: el backend contrasta la entrega con los hallazgos del motor y compone
  // la narrativa (hechos deterministas + explicación del modelo por id).
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

  // El motor adjudica las afirmaciones de relación; una contradicha se señala en
  // el veredicto y en el resumen, sin tocar la prosa ni el estado.
  if (answer != null && submittedClaims.length > 0) {
    opts.onProgress?.({ type: 'verify', claims: submittedClaims.length });
  }
  const claims =
    answer != null && submittedClaims.length > 0
      ? await verifyClaims(submittedClaims, {
          lain: opts.lain,
          view,
          resolveService: (name) => dispatcher.resolveService(name),
          validateRefs: cleanedValidate,
          hasRepo: (name) => dispatcher.hasRepo(name),
        })
      : [];
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
