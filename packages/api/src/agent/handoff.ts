// El relevo: el modelo fuerte PLANEA y REDACTA; el rápido LEE.
//
// Hoy el bucle entero lo lleva el modelo rápido, y los fallos que midió el
// tour fueron de REDACCIÓN (una línea equivocada, un id de evidencia que el
// backend nunca entregó), no de búsqueda. Por eso el relevo pone al modelo
// fuerte donde se decide y deja el rápido donde es barato.
//
//   plan  → el planificador lee la pregunta y dice qué leer y en qué orden
//   work  → el trabajador ejecuta el bucle de siempre y entrega un BORRADOR
//   write → el planificador ve los resultados y el borrador, y escribe la
//           respuesta final con sus afirmaciones
//
// Las tres fases son funciones sueltas: conectarlas con un grafo o a mano es
// lo mismo, y aquí se hace a mano para no tocar el bucle que ya está medido.

import { z } from 'zod';
import type { ToolSpec } from './nemotron.js';

export const SUBMIT_PLAN = 'submit_plan';

const Step = z
  .object({
    /** La herramienta a llamar, tal como se llama en la lista. */
    tool: z.string().min(1).max(40),
    args: z.record(z.string(), z.unknown()).optional(),
    /** Por qué: una línea. */
    why: z.string().max(160).optional(),
  })
  .strict();

export const SubmitPlanArgs = z
  .object({
    /** Qué está preguntando de verdad la pregunta. */
    goal: z.string().min(1).max(300),
    /** Las lecturas, en orden. */
    steps: z.array(Step).min(1).max(8),
    /** Los sitios que merece la pena mirar primero. */
    look_at: z.array(z.string().min(1).max(120)).max(10).optional(),
  })
  .strict();
export type SubmitPlan = z.infer<typeof SubmitPlanArgs>;

export const SUBMIT_PLAN_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: SUBMIT_PLAN,
    description:
      'Finish the research plan. `goal` is what the question is really asking; `steps` are the reads to do, in order (the tool and its arguments); `look_at` are the places worth reading first. You only plan: do not answer and do not state facts you have not read.',
    parameters: z.toJSONSchema(SubmitPlanArgs) as Record<string, unknown>,
  },
};

export const PLANNER_SYSTEM_PROMPT = `You plan a code research task for another model that will do the reading. You are given the question, the workspace map and the list of read-only tools.

Decide what to read, in what order, and where to look. Prefer locating first (search_code, find_symbol, find_docs) and then reading (get_code_snippet, get_context, get_call_sites). Name real repos and real symbols only; if you do not know the path, plan a search for it instead of inventing one. For a "why" or "how do we" question, plan find_docs first: the repositories document themselves. For a general question about a public library or standard, plan to locate its use in the workspace first and then web_search (if offered), official docs first.

You do NOT answer the question and you do NOT state facts. You plan, once, with submit_plan.`;

/** El plan, legible para el contexto del trabajador. */
export function planBlock(plan: SubmitPlan): string {
  const lines = [
    'Research plan from the planner model (advisory: the tools are the truth — deviate if a read contradicts it).',
    `Goal: ${plan.goal}`,
  ];
  if (plan.steps.length > 0) {
    lines.push('Steps:');
    plan.steps.forEach((s, i) => {
      const args = s.args && Object.keys(s.args).length > 0 ? ` ${JSON.stringify(s.args)}` : '';
      lines.push(`${i + 1}. ${s.tool}${args}${s.why ? ` — ${s.why}` : ''}`);
    });
  }
  if (plan.look_at?.length) lines.push(`Look at: ${plan.look_at.join('; ')}`);
  return lines.join('\n');
}

/** Lo que el escritor necesita para escribir la respuesta final. */
export interface WriteContext {
  question: string;
  /** El mapa del workspace: qué servicios hay (lo que el trabajador vio). */
  map?: string;
  plan: SubmitPlan | null;
  /** Los resultados de las herramientas, tal como los vio el trabajador. */
  toolResults: readonly string[];
  /** El borrador del trabajador: puede estar mal, se contrasta con los resultados. */
  draft: { answer: string } | null;
  /** Los ids que el backend entregó: lo único que se puede citar (INV 1). */
  citableIds: readonly string[];
  /** Los recibos de consulta (q:N) que se pueden citar. */
  receipts: readonly string[];
  /** Se buscó en la web: lo que diga de la librería hay que atribuirlo y citarlo. */
  webSearched?: boolean;
}

/** El contexto del escritor: la pregunta, el plan, los resultados y el borrador. */
export function writeBlock(ctx: WriteContext): string {
  const parts: string[] = [`Question: ${ctx.question}`];
  if (ctx.map) parts.push(ctx.map);
  if (ctx.plan) parts.push(planBlock(ctx.plan));
  if (ctx.toolResults.length > 0) {
    parts.push(
      'The worker gathered these tool results. They are what you may rely on:',
      ...ctx.toolResults.map((r, i) => `[tool result ${i + 1}]\n${r}`),
    );
  }
  if (ctx.citableIds.length > 0) {
    parts.push(
      `Evidence ids delivered by the backend (cite these and only these): ${ctx.citableIds.join(', ')}`,
    );
  } else {
    parts.push(
      'The backend delivered NO evidence ids: there is nothing to cite but the receipts below. Never invent an id.',
    );
  }
  if (ctx.receipts.length > 0) {
    parts.push(`Query receipts you may cite (q:N): ${ctx.receipts.join(', ')}`);
  }
  if (ctx.draft) {
    parts.push(
      `The worker's draft (it may be wrong: check every location and every citation against the results above):\n${ctx.draft.answer}`,
    );
  }
  if (ctx.webSearched) {
    parts.push(
      'The worker searched the web. Whatever you state about the public library or standard comes from those web results: attribute it ("per <source>") and back it with a doc_quote claim (repo "web", path = the result URL, section = its title as shown, quote copied literally from its text). Keep it apart from what the engine observed in the code.',
    );
  }
  parts.push(
    'Now write the final answer for the human and the claims behind it, with submit_answer. Every file:line you state needs a location claim; every phrase you quote from a document needs a doc_quote claim; every relation between services needs a relation claim.',
  );
  return parts.join('\n\n');
}
