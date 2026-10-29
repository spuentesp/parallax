// Traza compacta de una investigación, guardada con el turno. No guarda el texto de los
// resultados de las herramientas (pesan y pueden traer código): guarda QUÉ se hizo y cómo
// terminó cada afirmación. Un turno con todas sus afirmaciones verificadas es candidato a
// ejemplo de trabajo (agent/playbooks.ts) cuando haya suficientes.

import type { InvestigationResult } from './investigator.js';

export interface InvestigationTrace {
  v: 1;
  promptVersion: string;
  questionType: string | null;
  model: string | null;
  status: string;
  rounds: number;
  promptTokens: number;
  completionTokens: number;
  modelMs: number;
  tools: Array<{
    tool: string;
    ok: boolean;
    code?: string;
    ms: number;
    resultChars: number;
    truncated: boolean;
    /** Los argumentos recortados: sirven para ver qué se buscó, no para reproducir. */
    args: string;
  }>;
  claims: Array<{ kind: string; verdict: string }>;
  /** Todas las afirmaciones se verificaron y hubo al menos una. */
  allVerified: boolean;
  webUsed: boolean;
  docsUsed: boolean;
}

const ARGS_MAX = 160;

export function traceOf(result: InvestigationResult): InvestigationTrace {
  const claims = result.claims.map((c) => ({ kind: c.claim.kind, verdict: c.verdict }));
  const used = (name: string): boolean => result.toolCallLog.some((t) => t.tool === name && t.ok);
  return {
    v: 1,
    promptVersion: result.promptVersion,
    questionType: result.questionType,
    model: result.effectiveModel,
    status: result.explanationStatus,
    rounds: result.budget.rounds,
    promptTokens: result.budget.promptTokens,
    completionTokens: result.budget.completionTokens,
    modelMs: result.budget.modelMsUsed,
    tools: result.toolCallLog.map((t) => ({
      tool: t.tool,
      ok: t.ok,
      ...(t.code ? { code: t.code } : {}),
      ms: t.latencyMs,
      resultChars: t.resultChars,
      truncated: t.truncated,
      args: t.args.length > ARGS_MAX ? `${t.args.slice(0, ARGS_MAX)}…` : t.args,
    })),
    claims,
    allVerified: claims.length > 0 && claims.every((c) => c.verdict === 'verified'),
    webUsed: used('web_search'),
    docsUsed: used('find_docs'),
  };
}
