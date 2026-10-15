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
import type { LainAdapter } from '../lain-adapter/types.js';
import { createDispatcher, type DispatcherBudgetUse, type LainDispatcher } from './dispatcher.js';
import type { ChatMessage, NemotronResponse, ToolSpec } from './nemotron.js';

export const PROMPT_VERSION = 'parallax-investigator-v1';

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
    },
  ): Promise<NemotronResponse>;
}

export interface InvestigatorBudget {
  maxToolCalls: number;
  maxModelMs: number;
}

// §6: "ocho llamadas de investigación y 120 segundos de modelo por consulta".
export const DEFAULT_INVESTIGATOR_BUDGET: InvestigatorBudget = {
  maxToolCalls: 8,
  maxModelMs: 120_000,
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
  budget: InvestigatorBudget & DispatcherBudgetUse & { modelMsUsed: number; rounds: number };
  toolCallLog: ToolCallRecord[];
  modelLog: ModelCallRecord[];
  effectiveModel: string | null;
  promptVersion: string;
  /** Aristas consumidor→servicio observadas en get_service (estructural). */
  consumedEdges: Array<{ source: string; target: string }>;
  errors: string[];
}

export interface InvestigateOptions {
  question: string;
  lain: LainAdapter;
  model: ChatCompleter;
  view?: LainView;
  budget?: Partial<InvestigatorBudget>;
  /** Hallazgos del motor (INV 2): contexto y detección de promociones. */
  engineFindings?: unknown[];
  modelRole?: 'planner' | 'worker';
  maxTokens?: number;
  /**
   * Por defecto 'auto'. Forzar una herramienta concreta sirve para verificar
   * el mecanismo de tool calling sin depender de que el modelo decida
   * consultar: §14 exige que "la respuesta produzca una llamada válida", y
   * eso no puede ser no-determinista.
   */
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Etiqueta del endpoint configurado (sin credenciales) para el traza. */
  endpointLabel?: string;
  maxResultChars?: number;
}

const SYSTEM_PROMPT = `You are Parallax's architecture investigator. You answer questions about a fixed code workspace using ONLY the read-only research tools provided. The workspace view was fixed by the analysis: you cannot choose snapshots, repos outside the workspace, or any write/publish tool.

Method:
1. Gather facts with the tools before answering. list_services gives the catalog; get_service shows consumers with evidence ids; trace_impact shows who depends on an endpoint; resolve_evidence/read_source verify code locations; list_unresolved and get_coverage tell you what remains unknown.
2. Every factual conclusion MUST cite at least one evidence id you actually received in tool results, using the marker [ev:<id>]. Never invent ids, paths or refs. If you did not receive an id, do not cite it.
3. You cannot change engine classifications. If a finding is NeedsInvestigation or NoKnownImpact, keep it; explain what is unknown and what evidence would resolve it.
4. For design proposals (e.g. a BFF): identify existing contracts/capabilities to reuse, separate DECISIONS from HYPOTHESES explicitly, and list open operational questions. A proposal must not modify the observed map — mark every hypothetical relation as such.
5. If a tool result declares a cut (truncation), ask for a narrower detail call instead of guessing the omitted part.
6. If you cannot verify something, say it is unknown. Never hide uncertainty. Answer in the language of the question.`;

function nowMs(): number {
  return Date.now();
}

function isRetryableError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  return name === 'AbortError' || /429|rate.?limit|timeout|aborted/i.test(message);
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
export function extractCitationRefs(
  answer: string,
  deliveredRefs: readonly string[] = [],
): string[] {
  const refs: string[] = [];
  const push = (raw: string | undefined): void => {
    const ref = (raw ?? '')
      .trim()
      .replace(/^[`"'“”]+/, '')
      .replace(/[`"'“”)\].,;:]+$/, '')
      .trim();
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
    const finding = raw as {
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
export async function investigate(opts: InvestigateOptions): Promise<InvestigationResult> {
  const budget: InvestigatorBudget = {
    maxToolCalls: opts.budget?.maxToolCalls ?? DEFAULT_INVESTIGATOR_BUDGET.maxToolCalls,
    maxModelMs: opts.budget?.maxModelMs ?? DEFAULT_INVESTIGATOR_BUDGET.maxModelMs,
  };
  const view: LainView = opts.view ?? 'live';
  const dispatcher: LainDispatcher = createDispatcher({
    lain: opts.lain,
    view,
    maxToolCalls: budget.maxToolCalls,
    ...(opts.maxResultChars !== undefined ? { maxResultChars: opts.maxResultChars } : {}),
  });
  const tools = dispatcher.toolSpecs();
  const modelRole = opts.modelRole ?? 'worker';
  const maxTokens = opts.maxTokens ?? 2048;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.question },
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

  // El tope de rondas evita bucles infinitos con un modelo que sólo pide
  // herramientas inválidas; el tiempo límite es el presupuesto real.
  const maxRounds = budget.maxToolCalls + 2;
  const deadline = nowMs() + budget.maxModelMs;

  while (rounds < maxRounds) {
    // La primera llamada siempre se intenta; el límite se aplica a partir de
    // la segunda para que un presupuesto ya consumido por arranque no impida
    // ni siquiera la primera consulta.
    if (rounds > 0 && nowMs() >= deadline) {
      status = 'failed:model_time_budget';
      errors.push(`model time budget exhausted (${budget.maxModelMs} ms)`);
      break;
    }

    let resp: NemotronResponse;
    try {
      resp = await opts.model.complete(messages, {
        model: modelRole,
        tools,
        toolChoice: opts.toolChoice ?? 'auto',
        maxTokens,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isRetryableError(e) && !retried && nowMs() < deadline) {
        // Timeout o 429: se reintenta UNA vez dentro del presupuesto (§14).
        retried = true;
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
      answer = resp.content ?? '';
      break;
    }

    messages.push({
      role: 'assistant',
      content: resp.content,
      tool_calls: resp.toolCalls,
    });

    for (const call of resp.toolCalls) {
      const result = await dispatcher.execute(call);
      const content = result.ok
        ? JSON.stringify({
            ok: true,
            tool: result.tool,
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
      if (!result.ok && result.code === 'budget_exhausted') {
        // No se corta la ronda: cada tool_call restante recibe también su
        // budget_exhausted tipado (el historial role=tool debe estar completo
        // para el siguiente turno del modelo) y el despachante ya no ejecuta
        // lecturas porque su contador está agotado.
        errors.push('tool budget exhausted during round');
      }
    }
    rounds++;
  }

  const citations =
    answer != null
      ? await validateCitations(opts.lain, view, answer, dispatcher)
      : { accepted: [], rejected: [] };
  const conflictingClaims =
    answer != null ? detectClassificationConflicts(answer, opts.engineFindings ?? []) : [];

  if (answer != null) {
    // El validador ya sabe si hubo citas: accepted + rejected son las que
    // reconoció. Volver a extraerlas aquí sería otra interpretación del texto.
    const cited = citations.accepted.length + citations.rejected.length;
    if (citations.accepted.length > 0) {
      status = 'available';
    } else if (cited === 0) {
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
      modelMsUsed,
      rounds,
    },
    toolCallLog,
    modelLog,
    effectiveModel,
    promptVersion: PROMPT_VERSION,
    consumedEdges: dispatcher.consumedEdges(),
    errors,
  };
}

// INV 1: sólo una ref entregada por el backend y resoluble en la vista pasa.
async function validateCitations(
  lain: LainAdapter,
  view: LainView,
  answer: string,
  dispatcher: LainDispatcher,
): Promise<{ accepted: string[]; rejected: CitationRejection[] }> {
  const delivered = new Set(dispatcher.deliveredEvidence());
  // El marcador puede venir reescrito por el modelo; por eso se le pasan los ids
  // entregados para reconocerlos aunque cambie la puntuación.
  const refs = extractCitationRefs(answer, [...delivered]);
  const rejected: CitationRejection[] = [];
  const candidates: string[] = [];
  for (const ref of refs) {
    if (!delivered.has(ref)) {
      // Referencia inventada o fuera de la vista: se rechaza, no se oculta.
      rejected.push({ ref, reason: 'not_delivered_by_backend' });
    } else {
      candidates.push(ref);
    }
  }
  if (candidates.length === 0) return { accepted: [], rejected };

  try {
    const resolved = await lain.resolveEvidence({ snapshot: view, refs: candidates });
    const accepted: string[] = [];
    const byRef = new Map(resolved.items.map((item) => [item.ref, item]));
    for (const ref of candidates) {
      const item = byRef.get(ref);
      if (item?.exists === true) {
        accepted.push(ref);
      } else {
        rejected.push({ ref, reason: 'unresolvable_in_view' });
      }
    }
    return { accepted, rejected };
  } catch {
    // Sin resolución no hay cita publicable: queda el rechazo visible.
    for (const ref of candidates) {
      rejected.push({ ref, reason: 'unresolvable_in_view' });
    }
    return { accepted: [], rejected };
  }
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
    const finding = raw as {
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
    tool_calls: result.toolCallLog,
    model_calls: result.modelLog,
    errors: result.errors,
  };
}
