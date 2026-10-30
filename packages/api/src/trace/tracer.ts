// El trazador: un bucle de herramientas acotado que produce un trazado estructurado,
// y la comprobación posterior (lugares leídos por el motor, enlaces confirmados SÓLO
// con hechos del motor). Reutiliza las protecciones del investigador: tope de
// llamadas por respuesta, entrega forzada, lecturas pesadas memorizadas.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyClaims } from '../agent/claims.js';
import { createDispatcher, type DispatcherTool } from '../agent/dispatcher.js';
import { type ChatCompleter, type ProgressEvent, summarizeCall } from '../agent/investigator.js';
import { memoizeReads } from '../agent/memo-lain.js';
import type { ChatMessage, ToolCall, ToolSpec } from '../agent/nemotron.js';
import type { LainAdapter } from '../lain-adapter/types.js';
import {
  type Basis,
  LANE_LABEL,
  LANES,
  SubmitTraceArgs,
  sanitizeTraceArgs,
  type TraceResult,
  type TraceSeed,
  type VerifiedHop,
  type VerifiedLink,
} from './schema.js';

export const SUBMIT_TRACE = 'submit_trace';

export const SUBMIT_TRACE_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: SUBMIT_TRACE,
    description:
      'Finish the trace. `hops` are the places in the code the value passes through, in order, each with repo, path, line and `contains` (an identifier literally on or near that line); `links` say how the value passes between hops; `gaps` say where the trail is lost and why; `sink` says where the value ends. The server verifies every hop by reading the code and decides which links are confirmed: do not claim verification.',
    parameters: z.toJSONSchema(SubmitTraceArgs) as Record<string, unknown>,
  },
};

// New trace_flow tool specification for cross-boundary tracing
export const TRACE_FLOW_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'trace_flow',
    description:
      'Trace a value\'s flow through the codebase across boundaries (UI to DB, RPC to service, etc.). ' +
      'Replaces manual get_call_chain + trace_impact with a single cross-boundary trace. ' +
      'Supports BFS (impact analysis) and DFS (root cause analysis) strategies. ' +
      'Reports explicit gaps where the trace cannot continue.',
    parameters: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        from: {
          type: "object",
          properties: {
            contract: { type: "string" },
            symbol: { type: "string" },
            globalId: { type: "string" }
          },
          required: []
        },
        strategy: { type: "string", enum: ["BFS", "DFS"] },
        maxHops: { type: "integer", minimum: 1 },
        maxPaths: { type: "integer", minimum: 1 },
        snapshot: { type: "string" },
        repo: { type: "string" },
        detectGaps: { type: "boolean" }
      },
      required: ["from"],
      additionalProperties: false
    } as Record<string, unknown>,
  },
};

const SYSTEM_PROMPT = `You trace how a value travels through a codebase, end to end and across repositories, using only read-only code tools. For one API contract you show the chain from the DATA it comes from, through the code that fetches and transforms it, to the function that exposes the endpoint, to the client code that calls it, and on through the client code to where the value ends up.

Lanes, left to right: ${LANES.map((l) => `${l} (${LANE_LABEL[l]})`).join(' · ')}.
- The server adds the contract itself and the client call sites the engine recorded, as hops with fixed ids ("contract", "call1", "call2"...). Do NOT submit them; link your hops to them by id (for example your handler -> "contract", and "call1" -> the first function that uses the returned value).
- data: the stored data. If you cannot see a table, name the ORM model class and say so in the label ("model Product, table inferred").
- data_access: the function that reads or writes that data. domain: functions between it and the handler. api_handler: the function that exposes the endpoint (a resolver, a route handler). contract: the endpoint itself.
- client_call: the client code that calls the endpoint. client_logic: functions that move or use the returned value. sink: where it ends (rendered in the UI, stored, sent on, discarded, returned).

Method: you are given the contract, where the engine says it is defined, and the engine's recorded client call sites. START from those locations and work outward in both directions with the tools (search_code, find_symbol, get_context, get_call_sites, get_call_chain, get_code_snippet, ...). Follow the value, not every call; prefer the shortest faithful path (at most 12 hops).

Rules:
- Every hop is a place you actually saw in a tool result: repo, the path exactly as the tool printed it, a line you saw, and "contains" = ONE identifier (a function, class or variable name, no spaces, quotes or call syntax) that is literally on or near that line. Never invent a hop and never guess a line.
- Data end: if the data access goes through an ORM (for example Django models or \`.objects\`), add a data hop for the MODEL CLASS (path and line of the class) and say "table inferred" in its label; only name a table as a table if you saw it (a SQL string or a Meta/db_table).
- Client end for GraphQL: the .graphql document is only the call site. Find the code that EXECUTES it (search the operation name in .ts/.tsx files and generated files, for example a generated hook such as useXxxMutation or a function that sends the document), then the components or functions that call that hook and use the returned data, up to where the value is rendered, stored or discarded. If the code that executes the document is not in the index (generated code is often not committed), say exactly that in a gap instead of guessing.
- Never create a placeholder hop ("N/A", "not found", "unknown"). If something does not exist or you could not find it, that is a GAP, not a hop. A contract nobody calls is a valid answer: trace the server side and record the gap.
- api_handler is the function or class that implements the endpoint (not the schema file).
- If you cannot find the next hop (dynamic dispatch, generated code, the ORM, a framework convention), record a GAP with the reason instead of guessing.
- "relation" says how the value passes from one hop to the next. Do not claim anything is verified: the server reads the code back and checks the links against the engine.
- Put the end of the value in "sink". If you could not reach it, say so in a gap and use kind "unknown".
- Be brief. Finish by calling submit_trace.`;

const MAX_CALLS_PER_REPLY = 8;
/** Un trazado cruza repos y capas: necesita más búsquedas que una pregunta suelta. */
export const TRACE_CAPS: Partial<Record<DispatcherTool, number>> = {
  search_code: 8,
  find_symbol: 8,
  get_context: 6,
  get_call_sites: 6,
  get_call_chain: 8,
  get_code_snippet: 8,
  search_org: 4,
};

const loc = (s: { repo?: string; path?: string; line?: number }) =>
  `${s.repo ? `${s.repo}:` : ''}${s.path ?? '?'}${s.line ? `:${s.line}` : ''}`;

/** Los saltos que el servidor pone por sí mismo: el contrato y los sitios de llamada que el motor registró. */
export function engineHops(seed: TraceSeed): VerifiedHop[] {
  const hops: VerifiedHop[] = [];
  const name = seed.key.split(':').pop() ?? seed.key;
  const p = seed.providers.find((x) => x.path);
  hops.push({
    id: 'contract',
    lane: 'contract',
    label: seed.key,
    repo: p?.repo ?? seed.repo ?? '',
    path: p?.path ?? '',
    line: p?.line ?? 1,
    contains: /^[A-Za-z_$][\w$]*$/.test(name) ? name : 'contract',
    status: p?.path ? 'verified' : 'unverifiable',
    reason: p?.path
      ? 'location recorded by the engine as where this contract is defined'
      : 'the engine gives no definition location for this contract',
    origin: 'engine',
  });
  let n = 0;
  for (const c of seed.consumers) {
    for (const site of c.sites.slice(0, 2)) {
      if (n >= 3 || !site.path) continue;
      n++;
      hops.push({
        id: `call${n}`,
        lane: 'client_call',
        label: `${c.service} calls ${name}`,
        repo: site.repo ?? '',
        path: site.path,
        line: site.line ?? 1,
        contains: 'call',
        status: 'verified',
        reason: `call site the engine recorded for ${seed.key} (${c.service}, ${c.provenance})`,
        origin: 'engine',
      });
    }
  }
  return hops;
}

export function seedBlock(seed: TraceSeed): string {
  const lines = [
    `Trace this contract end to end.`,
    `Contract: ${seed.key} (service ${seed.service}${seed.repo ? `, repo ${seed.repo}` : ''})`,
    seed.providers.length > 0
      ? `The engine says it is defined at: ${seed.providers.map(loc).join('; ')}`
      : 'The engine gives no definition location for it.',
  ];
  if (seed.consumers.length === 0) {
    lines.push('The engine records NO client call sites for it: say so if you cannot find any.');
  } else {
    lines.push('Client call sites the engine recorded:');
    for (const c of seed.consumers.slice(0, 4)) {
      lines.push(
        `- ${c.service}: ${c.uses} use${c.uses === 1 ? '' : 's'} (${c.provenance})${c.fields.length ? `, fields ${c.fields.slice(0, 5).join(', ')}` : ''}; sites: ${c.sites.slice(0, 3).map(loc).join('; ') || 'none recorded'}`,
      );
    }
  }
  const given = engineHops(seed).map((h) => `${h.id} = ${h.repo}:${h.path}:${h.line}`);
  lines.push(
    `Hops the server adds for you (link to them by id, do not submit them): ${given.join('; ')}`,
  );
  lines.push('Start at those locations.');
  return lines.join('\n');
}

/**
 * Pistas deterministas para empezar con ventaja: dónde menciona cada repo (el del contrato
 * y los de sus clientes) el nombre de la operación, según la búsqueda de código del motor.
 * Un GraphQL sólo tiene el documento como "llamada"; lo que lo ejecuta (un hook generado,
 * una función) y lo que lo implementa aparecen en estas búsquedas.
 */
export async function gatherHints(lain: LainAdapter, seed: TraceSeed): Promise<string> {
  const name = seed.key.split(':').pop() ?? '';
  if (!/^[A-Za-z_]\w*$/.test(name)) return '';
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  const repos = [
    ...new Set([
      ...(seed.repo ? [seed.repo] : []),
      ...seed.consumers.flatMap((c) => c.sites.map((x) => x.repo ?? '')).filter(Boolean),
    ]),
  ].slice(0, 3);
  const blocks: string[] = [];
  for (const repo of repos) {
    for (const q of [...new Set([pascal, name])]) {
      try {
        const r = await lain.codeTool('search_code', { query: q, repo_id: repo, limit: 6 });
        const lines = r.text
          .split('\n')
          .filter((l) => /^\d+\./.test(l))
          .slice(0, 6);
        if (lines.length > 0)
          blocks.push(`In ${repo}, code search for "${q}":\n${lines.join('\n')}`);
      } catch {
        // una pista que falla no impide el trazado
      }
    }
  }
  return blocks.length > 0
    ? `\nEngine code search for the operation name (use these as starting points; they are NOT verified links):\n${blocks.join('\n')}`
    : '';
}

export interface TraceOptions {
  seed: TraceSeed;
  lain: LainAdapter;
  model: ChatCompleter;
  /** 'planner' = el modelo grande; 'worker' = el rápido (por defecto, como el investigador). */
  modelRole?: 'planner' | 'worker';
  budget?: { maxToolCalls?: number; maxModelMs?: number };
  maxTokens?: number;
  thinking?: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

const TRACE_BUDGET = { maxToolCalls: 16, maxModelMs: 180_000 };

export async function traceEndToEnd(opts: TraceOptions): Promise<TraceResult> {
  const t0 = Date.now();
  const lain = memoizeReads(opts.lain);
  const maxToolCalls = opts.budget?.maxToolCalls ?? TRACE_BUDGET.maxToolCalls;
  const maxModelMs = opts.budget?.maxModelMs ?? TRACE_BUDGET.maxModelMs;
  const dispatcher = createDispatcher({
    lain,
    view: 'live',
    maxToolCalls,
    caps: TRACE_CAPS,
    maxResultChars: 8000,
  });
  const tools = [...dispatcher.toolSpecs(), SUBMIT_TRACE_SPEC];
  const hints = await gatherHints(lain, opts.seed);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: seedBlock(opts.seed) + hints },
  ];
  const usage = { modelCalls: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, ms: 0 };
  const errors: string[] = [];
  const deadline = t0 + maxModelMs;
  const maxRounds = maxToolCalls * 2 + 2;
  let finalResult: Awaited<ReturnType<typeof finalize>> | null = null;
  let pushedBack = false;
  let repairs = 0;
  let invalid = 0;
  let softNudged = false;
  let status: TraceResult['status'] = 'failed:no_trace';

  for (let round = 0; round < maxRounds && !finalResult; round++) {
    const used = dispatcher.budgetUse().toolCallsUsed;
    if (round > 0 && Date.now() >= deadline) {
      status = 'failed:model_time_budget';
      errors.push(`model time budget exhausted (${maxModelMs} ms)`);
      break;
    }
    // Como en el investigador: al agotarse lecturas, rondas o tiempo, la siguiente llamada ES la entrega.
    const mustSubmit =
      used > 0 &&
      (used >= maxToolCalls - 1 ||
        round >= maxToolCalls ||
        deadline - Date.now() < maxModelMs * 0.3);
    opts.onProgress?.({
      type: 'round',
      round: round + 1,
      toolCallsUsed: used,
      maxToolCalls,
      forced: mustSubmit,
    });
    let resp: Awaited<ReturnType<ChatCompleter['complete']>>;
    try {
      resp = await opts.model.complete(messages, {
        model: opts.modelRole ?? 'worker',
        tools,
        toolChoice: mustSubmit ? { type: 'function', function: { name: SUBMIT_TRACE } } : 'auto',
        maxTokens: opts.maxTokens ?? 4096,
        ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
        ...(mustSubmit ? { parallelToolCalls: false } : {}),
      });
    } catch (e) {
      status = 'failed:model_error';
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
    usage.modelCalls++;
    usage.promptTokens += resp.usage.promptTokens;
    usage.completionTokens += resp.usage.completionTokens;
    const cap = mustSubmit ? 1 : MAX_CALLS_PER_REPLY;
    let calls: ToolCall[] = resp.toolCalls;
    if (calls.length > cap) {
      errors.push(
        `model sent ${calls.length} tool calls in one reply; only the first ${cap} were kept`,
      );
      calls = calls.slice(0, cap);
    }
    if (calls.length === 0) {
      // Prosa sin entregar: se le pide UNA vez que entregue.
      if (!softNudged) {
        softNudged = true;
        messages.push({ role: 'assistant', content: resp.content });
        messages.push({
          role: 'user',
          content: 'Finish by calling submit_trace with the hops, links, gaps and sink you found.',
        });
        continue;
      }
      status = 'failed:no_trace';
      break;
    }
    messages.push({ role: 'assistant', content: resp.content, tool_calls: calls });

    const submit = calls.find((c) => c.function?.name === SUBMIT_TRACE);
    if (submit) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(submit.function.arguments || '{}');
      } catch {
        parsed = null;
      }
      const checked = SubmitTraceArgs.safeParse(sanitizeTraceArgs(parsed));
      if (checked.success) {
        // Entregar sin haber leído nada es contar de memoria: se devuelve UNA vez.
        if (dispatcher.budgetUse().toolCallsUsed === 0 && !pushedBack) {
          pushedBack = true;
          const msg =
            'You submitted without reading any code. Hops from memory are not evidence. Use the tools to find the real locations (start at the engine hops and the code search hints), then call submit_trace again.';
          for (const c of calls) {
            messages.push({
              role: 'tool',
              tool_call_id: c.id,
              content: JSON.stringify({ ok: false, error: { code: 'no_evidence', message: msg } }),
            });
          }
          continue;
        }
        opts.onProgress?.({ type: 'verify', claims: checked.data.hops.length });
        const fin = await finalize(checked.data, opts.seed, lain, dispatcher);
        const wrong = fin.rejected;
        // El motor comprueba los saltos ANTES de entregar: lo que no existe se devuelve al modelo,
        // con la razón del motor, para que lo corrija o lo quite (una vez).
        if (wrong.length > 0 && repairs < 1) {
          repairs++;
          const msg = `The engine could not find ${wrong.length} of your hops in the code: ${wrong
            .slice(0, 6)
            .map(
              (h) =>
                `${h.id} (${h.repo}:${h.path}:${h.line}, "${h.contains}"): ${h.reason.slice(0, 110)}`,
            )
            .join(
              ' | ',
            )}. Look up the real locations with the tools (search_code, find_symbol, get_code_snippet) and resubmit with correct ones, or drop those hops and record a gap.`;
          errors.push(`repair requested for ${wrong.length} hop(s)`);
          opts.onProgress?.({ type: 'wrapup', reason: 'locations' });
          for (const c of calls) {
            messages.push({
              role: 'tool',
              tool_call_id: c.id,
              content: JSON.stringify({
                ok: false,
                error: { code: 'hops_not_found', message: msg },
              }),
            });
          }
          continue;
        }
        finalResult = fin;
        break;
      }
      invalid++;
      const msg = `invalid submit_trace: ${checked.error?.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`;
      errors.push(msg);
      for (const c of calls) {
        messages.push({
          role: 'tool',
          tool_call_id: c.id,
          content: JSON.stringify({ ok: false, error: { code: 'invalid_schema', message: msg } }),
        });
      }
      if (invalid >= 3) {
        status = 'failed:invalid_trace';
        break;
      }
      continue;
    }

    for (const call of calls) {
      const r = await dispatcher.execute(call);
      usage.toolCalls += r.ok ? 1 : 0;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: r.ok
          ? JSON.stringify({
              ok: true,
              tool: r.tool,
              data: r.data,
              ...(r.truncated ? { cut_declared: r.truncated } : {}),
            })
          : JSON.stringify({ ok: false, error: { code: r.code, message: r.message } }),
      });
      opts.onProgress?.({
        type: 'tool',
        tool: r.tool,
        summary: summarizeCall(call.function?.arguments ?? ''),
        ok: r.ok,
        ms: r.latencyMs,
        ...(r.ok ? {} : { note: r.code }),
      });
    }
    if (!softNudged && dispatcher.budgetUse().toolCallsUsed >= Math.ceil(maxToolCalls * 0.6)) {
      softNudged = true;
      opts.onProgress?.({ type: 'wrapup', reason: 'budget' });
      messages.push({
        role: 'user',
        content: `You have used ${dispatcher.budgetUse().toolCallsUsed} of ${maxToolCalls} tool calls. Unless a key hop is still missing, stop and call submit_trace now with what you have, recording gaps for what you could not follow.`,
      });
    }
  }

  const empty = (): TraceResult => ({
    seed: { key: opts.seed.key, service: opts.seed.service },
    summary: '',
    hops: [],
    rejected: [],
    links: [],
    gaps: [],
    sink: null,
    complete: false,
    status,
    usage: { ...usage, ms: Date.now() - t0 },
    errors,
  });
  if (!finalResult) return empty();
  return {
    seed: { key: opts.seed.key, service: opts.seed.service },
    ...finalResult,
    status: 'available',
    usage: { ...usage, ms: Date.now() - t0 },
    errors,
  };
}

/** Un símbolo se puede preguntar al grafo de llamadas sólo si parece un identificador. */
const isSymbol = (s: string): boolean => /^[A-Za-z_][\w]*$/.test(s);

const nearLine = (a?: number, b?: number): boolean =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= 2;
const samePath = (a: string, b: string): boolean =>
  a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/**
 * 1) cada salto se lee en el motor (afirmación de lugar); 2) cada enlace se
 * confirma SÓLO con un hecho del motor: una cadena de llamadas, o el sitio de
 * llamada que el motor ya tenía registrado para este contrato. Lo demás queda
 * como "afirmado por el modelo".
 */
export async function finalize(
  s: SubmitTraceArgs,
  seed: TraceSeed,
  lain: LainAdapter,
  dispatcher: ReturnType<typeof createDispatcher>,
): Promise<
  Pick<TraceResult, 'summary' | 'hops' | 'rejected' | 'links' | 'gaps' | 'sink' | 'complete'>
> {
  const engine = engineHops(seed);
  const ids = new Set<string>(engine.map((h) => h.id));
  const PLACEHOLDER = /^(n\/a|none|null|unknown|not[ _-]?found|-+)$/i;
  const hops: SubmitTraceArgs['hops'] = s.hops.filter((h) => {
    if (ids.has(h.id)) return false; // ids del servidor, o repetidos
    // Un hueco no es un salto: "N/A" o "not found" se descartan (el modelo debe usar `gaps`).
    if (
      PLACEHOLDER.test(h.path.trim()) ||
      PLACEHOLDER.test(h.repo.trim()) ||
      /\b(not found|n\/a)\b/i.test(h.label)
    ) {
      return false;
    }
    ids.add(h.id);
    return true;
  });
  // El servidor ya puso el contrato y los sitios de llamada del motor: un salto del modelo
  // en el mismo lugar es el MISMO salto. Se funde en el del motor y se reescriben sus enlaces.
  const remap = new Map<string, string>();
  const keepModel: SubmitTraceArgs['hops'] = [];
  for (const h of hops) {
    if (h.lane === 'contract') {
      remap.set(h.id, 'contract');
      continue;
    }
    const twin =
      h.lane === 'client_call'
        ? engine.find(
            (e) =>
              e.lane === 'client_call' &&
              samePath(e.path, h.path) &&
              Math.abs(e.line - h.line) <= 2,
          )
        : undefined;
    if (twin) {
      remap.set(h.id, twin.id);
      continue;
    }
    keepModel.push(h);
  }
  hops.splice(0, hops.length, ...keepModel);
  const delivered = new Set(dispatcher.deliveredEvidence());

  const results = await verifyClaims(
    hops.map((h) => ({
      kind: 'location' as const,
      repo: h.repo,
      path: h.path,
      line: h.line,
      contains: h.contains,
      text: h.label,
      ...(h.evidence?.length ? { evidence: h.evidence } : {}),
    })),
    {
      lain,
      view: 'live',
      resolveService: async () => null,
      validateRefs: async (refs) => ({
        accepted: refs.filter((r) => delivered.has(r)),
        receipts: [],
        rejected: refs
          .filter((r) => !delivered.has(r))
          .map((ref) => ({ ref, reason: 'not delivered by the backend' })),
      }),
      hasRepo: (n) => dispatcher.hasRepo(n),
    },
  );
  const modelHops: VerifiedHop[] = hops.map((h, i) => ({
    ...h,
    origin: 'model' as const,
    status: (results[i]?.verdict === 'verified'
      ? 'verified'
      : results[i]?.verdict === 'contradicted'
        ? 'contradicted'
        : 'unverifiable') as VerifiedHop['status'],
    reason: results[i]?.reason ?? '',
  }));
  // Un salto que el motor no encontró NO es parte del recorrido: se aparta (y se lista aparte),
  // con sus enlaces, y se anota dónde se pierde el rastro.
  const rejected = modelHops.filter((h) => h.status === 'contradicted');
  const keptModel = modelHops.filter((h) => h.status !== 'contradicted');
  // Orden de lectura: lo que el motor registró queda donde corresponde por carril.
  const verifiedHops = [...keptModel, ...engine].sort(
    (a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane),
  );
  const byId = new Map(verifiedHops.map((h) => [h.id, h]));

  let chainChecks = 0;
  const links: VerifiedLink[] = [];
  const seenLink = new Set<string>();
  for (const raw of s.links) {
    const l = { ...raw, from: remap.get(raw.from) ?? raw.from, to: remap.get(raw.to) ?? raw.to };
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b || a === b) continue; // un enlace a un salto que no existe (o se apartó) no se muestra
    const dupKey = `${l.from}>${l.to}>${l.relation}`;
    if (seenLink.has(dupKey)) continue;
    seenLink.add(dupKey);
    let basis: Basis = 'asserted';
    let because = 'asserted by the model after reading the code; no engine fact checked it';

    // Contrato → sitio de llamada: ese enlace lo añade el servidor con el hecho del motor
    // (más abajo). Uno equivalente del modelo se descarta; ningún OTRO enlace que toque un
    // sitio de llamada hereda ese respaldo: el motor registró el sitio, no el enlace.
    if (l.from === 'contract' && engine.some((h) => h.id === l.to)) continue;

    // Función → función: ¿el grafo de llamadas del motor tiene la cadena?
    if (
      basis === 'asserted' &&
      l.relation === 'calls' &&
      a.origin === 'model' &&
      b.origin === 'model' &&
      a.repo === b.repo &&
      isSymbol(a.contains) &&
      isSymbol(b.contains) &&
      chainChecks < 10
    ) {
      chainChecks++;
      try {
        const r = await lain.codeTool('get_call_chain', {
          from: a.contains,
          to: b.contains,
          repo_id: a.repo,
        });
        if (/^## Call Chain:/m.test(r.text)) {
          basis = 'engine';
          because = "the engine's call graph has a call path between them (get_call_chain)";
        } else if (/^No call path found/m.test(r.text)) {
          basis = 'not_found';
          because =
            "the engine's call graph has no path between them; it cannot see dynamic dispatch, so this is not a contradiction";
        }
      } catch {
        // sin respuesta del motor: queda afirmado
      }
    }
    links.push({ ...l, basis, because });
  }

  // El motor ya sabe que el contrato lo llaman esos sitios: ese enlace es un hecho.
  for (const h of engine.filter((x) => x.lane === 'client_call')) {
    links.push({
      from: 'contract',
      to: h.id,
      relation: 'consumes',
      note: 'recorded by the engine',
      basis: 'engine',
      because: h.reason,
    });
  }

  const sinkHop = s.sink ? byId.get(remap.get(s.sink.hop) ?? s.sink.hop) : undefined;

  // Dónde se perdió el rastro por saltos que no existían: en cada lado del contrato.
  const gaps = (s.gaps ?? [])
    .map((g) => ({ ...g, after: remap.get(g.after) ?? g.after }))
    .filter((g) => byId.has(g.after));
  const serverSide = (h: VerifiedHop) => LANES.indexOf(h.lane) < LANES.indexOf('contract');
  const lost = (sideRejected: VerifiedHop[], anchor: VerifiedHop | undefined, where: string) => {
    if (sideRejected.length === 0 || !anchor) return;
    gaps.push({
      after: anchor.id,
      reason: `${where}: the model proposed ${sideRejected.length} hop${sideRejected.length === 1 ? '' : 's'} (${sideRejected
        .map((h) => h.label)
        .slice(0, 3)
        .join('; ')}) that the engine could not find in the code, so the trail is lost here`,
    });
  };
  const verifiedModel = verifiedHops.filter((h) => h.origin === 'model');
  lost(
    rejected.filter(serverSide),
    verifiedModel.find(serverSide) ?? verifiedHops.find((h) => h.id === 'contract'),
    'Towards the data',
  );
  lost(
    rejected.filter((h) => !serverSide(h)),
    [...verifiedHops].reverse().find((h) => !serverSide(h) && h.lane !== 'contract'),
    'Towards where the value ends',
  );
  return {
    summary: s.summary,
    hops: verifiedHops,
    rejected,
    links,
    gaps,
    sink: s.sink && sinkHop ? { ...s.sink, hop: sinkHop.id } : null,
    complete: Boolean(s.sink && sinkHop && s.sink.kind !== 'unknown'),
  };
}

export const newTraceId = (): string => `tr_${randomUUID().slice(0, 8)}`;
