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
import type { LainAdapter } from '../lain-adapter/types.js';
import {
  type Claim,
  type ClaimEvidence,
  type ClaimResult,
  type ClaimsSummary,
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
import type { ChatMessage, NemotronResponse, ToolSpec } from './nemotron.js';
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

export const PROMPT_VERSION = 'parallax-investigator-v4';

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
  budget: InvestigatorBudget & DispatcherBudgetUse & { modelMsUsed: number; rounds: number };
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
  pr?: { changes: unknown[]; coverage: PrCoverage };
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
1. Gather facts with the tools before answering. The workspace map in the question already lists the services, so do not call list_services just to learn them. consumers_of summarizes who consumes a service and through which endpoints, each with a citable evidence id; get_service gives the raw detail; trace_impact shows who depends on an endpoint; resolve_evidence/read_source verify code locations; list_unresolved and get_coverage tell you what remains unknown.
2. Every factual conclusion MUST cite at least one evidence id you actually received in tool results. Write the id exactly as it appears in the tool result inside the marker, with no angle brackets, quotes or placeholders, for example [ev:billing:Function:src/main.py:fetch_me:35]. Evidence ids are the long anchor strings found in tool results (fields like site.id or caller.id); service names and tool names are not evidence ids. Never invent ids, paths or refs. If you did not receive an id, do not cite it.
3. You cannot change engine classifications. If a finding is NeedsInvestigation or NoKnownImpact, keep it; explain what is unknown and what evidence would resolve it.
4. For design proposals (e.g. a BFF): identify existing contracts/capabilities to reuse, separate DECISIONS from HYPOTHESES explicitly, and list open operational questions. A proposal must not modify the observed map — mark every hypothetical relation as such.
5. If a tool result declares a cut (truncation), ask for a narrower detail call instead of guessing the omitted part.
6. If you cannot verify something, say it is unknown. Never hide uncertainty. Answer in the language of the question.
7. Finish by calling submit_answer. Put the explanation for the human in "answer". Put every statement about whether one service consumes another in "claims" as a relation claim (polarity "present" or "absent"): the engine verifies those itself, so an absence needs no code anchor. Every other statement you want checked goes in a note claim with the evidence ids that support it. Each tool result carries a "receipt" id (q:N) you may cite for what a query returned.`;

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
export async function investigate(opts: InvestigateOptions): Promise<InvestigationResult> {
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
  const maxTokens = opts.maxTokens ?? 2048;

  // Orientación sin gastar presupuesto: el mapa sale del mismo catálogo que fija
  // el alcance, así el modelo no gasta sus primeras llamadas descubriéndolo.
  const workspaceMap = await dispatcher.workspaceMap();
  const mapBlock = workspaceMap
    ? `Workspace map (from the engine, fixed view):\n${workspaceMap}`
    : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: prFindings ? PR_SYSTEM_PROMPT : SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        prFindings && opts.pr
          ? [renderFindingsBlock(prFindings, opts.pr.coverage), mapBlock]
              .filter(Boolean)
              .join('\n\n')
          : workspaceMap
            ? `${mapBlock}\n\nQuestion: ${opts.question}`
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
      answer = resp.content ?? '';
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

  if (preflightFailure) status = preflightFailure.status;

  // Modo PR: el backend contrasta la entrega con los hallazgos del motor y compone
  // la narrativa (hechos deterministas + explicación del modelo por id).
  const cleanedValidate = async (refs: readonly string[]) => {
    const r = await validateRefs(
      opts.lain,
      view,
      [...new Set(refs.map(cleanRef).filter(Boolean))],
      dispatcher,
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
      ? await validateCitations(opts.lain, view, modelText, dispatcher)
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
  const claims =
    answer != null && submittedClaims.length > 0
      ? await verifyClaims(submittedClaims, {
          lain: opts.lain,
          view,
          resolveService: (name) => dispatcher.resolveService(name),
          validateRefs: cleanedValidate,
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
    for (const ref of candidates) {
      const item = byRef.get(ref);
      if (item?.exists === true) {
        accepted.push(ref);
      } else {
        rejected.push({ ref, reason: 'unresolvable_in_view' });
      }
    }
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
): Promise<ClaimEvidence & { rejected: CitationRejection[] }> {
  const refs = extractCitationRefs(answer, dispatcher.deliveredEvidence());
  return validateRefs(lain, view, refs, dispatcher);
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
