// Explicación de un PR: el motor ya produjo los hallazgos (diff_contracts), así
// que esta tarea NO es exploración abierta. El backend compone de forma
// determinista todo lo que es hecho (qué cambió, clase del motor, consumidores
// afectados, cobertura) y el modelo sólo explica cada hallazgo (P INV 2). Cada
// hallazgo lleva un id (F1…) y la entrega se verifica por id, no buscando
// menciones en la prosa.

import { z } from 'zod';
import type { ToolSpec } from './nemotron.js';

/** Un PR se explica con pocas lecturas: sólo para profundizar en un hallazgo. */
export const PR_TOOL_BUDGET = 6;

export interface PrCoverage {
  complete?: boolean | undefined;
  missing?: string[] | undefined;
  /** Resumen de cobertura que presentó el análisis (la razón cuando no hay huecos concretos). */
  summary?: string | undefined;
}

export interface PrFinding {
  id: string;
  kind: string;
  service: string | null;
  key: string | null;
  compat: string | null;
  /** Clase del motor, copiada VERBATIM (autoridad: engine_json). */
  engineClass: string | null;
  reasons: string[];
  affected: Array<{ service: string; class: string | null; reasons: string | null }>;
  /** Ids de evidencia que el motor entregó para este hallazgo. */
  evidenceIds: string[];
}

interface RawChange {
  /** Forma simplificada de motores antiguos y del mock: servicio y campo sueltos. */
  service?: unknown;
  field?: unknown;
  kind?: unknown;
  compat?: unknown;
  endpoint?: { key?: unknown; service?: unknown };
  impact?: { class?: unknown; reasons?: unknown };
  affected?: Array<{ service?: unknown; class?: unknown; reasons?: unknown }>;
  paths?: Array<{ start?: unknown; hops?: Array<{ node?: unknown }> }>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function buildFindings(changes: readonly unknown[]): PrFinding[] {
  return changes.map((raw, i) => {
    const c = (raw ?? {}) as RawChange;
    const ids = new Set<string>();
    for (const p of c.paths ?? []) {
      const start = str(p.start);
      if (start) ids.add(start);
      for (const h of p.hops ?? []) {
        const node = str(h.node);
        if (node) ids.add(node);
      }
    }
    return {
      id: `F${i + 1}`,
      kind: str(c.kind) ?? 'Change',
      service: str(c.endpoint?.service) ?? str(c.service),
      key: str(c.endpoint?.key) ?? (str(c.field) ? `field ${str(c.field)}` : null),
      compat: str(c.compat),
      engineClass: str(c.impact?.class),
      reasons: Array.isArray(c.impact?.reasons)
        ? (c.impact.reasons as unknown[]).filter((r): r is string => typeof r === 'string')
        : [],
      affected: (c.affected ?? []).flatMap((a) => {
        const service = str(a.service);
        return service ? [{ service, class: str(a.class), reasons: str(a.reasons) }] : [];
      }),
      evidenceIds: [...ids],
    };
  });
}

function describeFinding(f: PrFinding): string {
  const affected = f.affected.length
    ? f.affected
        .map(
          (a) =>
            `${a.service}${a.class ? ` (${a.class}${a.reasons ? `: ${a.reasons}` : ''})` : ''}`,
        )
        .join(', ')
    : 'none recorded';
  return [
    `${f.id}  ${f.kind}  ${f.service ?? '?'} ${f.key ?? '?'}`,
    `    compat: ${f.compat ?? 'unknown'} | engine class: ${f.engineClass ?? 'unclassified'}${f.reasons.length ? ` (${f.reasons.join(', ')})` : ''}`,
    `    affected consumers: ${affected}`,
    ...(f.evidenceIds.length ? [`    evidence ids: ${f.evidenceIds.join(' | ')}`] : []),
  ].join('\n');
}

export function coverageLine(coverage: PrCoverage): string {
  const missing = coverage.missing ?? [];
  if (coverage.complete !== false && missing.length === 0) return 'Coverage: complete.';
  const reason = missing.length > 0 ? missing.join('; ') : coverage.summary;
  return `Coverage: INCOMPLETE${reason ? ` — ${reason}` : ''}. Absence of an impact is not evidence of no impact.`;
}

export function renderFindingsBlock(findings: readonly PrFinding[], coverage: PrCoverage): string {
  return [
    `The engine compared two snapshots of this workspace and reported ${findings.length} contract change(s). They are facts; their classes are authoritative.`,
    '',
    ...findings.map(describeFinding),
    '',
    coverageLine(coverage),
  ].join('\n');
}

export const PR_SYSTEM_PROMPT = `You are Parallax's pull-request explainer. A deterministic engine has already analyzed a pull request and listed its contract changes as findings F1, F2, … in the user message. Your job is to explain each finding to an architect. You do not decide facts or classes.

Rules:
1. Explain EVERY finding, by its id. For each: what changed, who is affected according to the finding, and why the engine's class is what it is (its reasons). Do not skip a finding because it looks minor.
2. Never change or reinterpret an engine class. A NeedsInvestigation finding stays NeedsInvestigation: say what is unknown and what would resolve it. Do not call it verified, confirmed, safe or harmless.
3. Use only the consumers and endpoints in the findings. If you want more detail on a finding, use the read tools sparingly; never invent services, endpoints or consumers.
4. Evidence ids you may cite are the ones listed in the findings and the ones tool results return, written exactly as shown, for example [ev:billing:HttpClientCall:client.py:GET /orders/{}:7].
5. If the coverage line says the analysis is incomplete, say so in the summary and do not present missing impact as no impact.
6. Finish by calling submit_answer: "summary" is a short overview for the architect, "findings" has one entry per finding id with your explanation (and optional evidence ids), and "coverage_note" is optional.`;

const PrFindingExplanation = z
  .object({
    id: z.string().min(1),
    explanation: z.string().min(1),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

export const PrSubmitArgs = z
  .object({
    summary: z.string().min(1),
    findings: z.array(PrFindingExplanation).max(100),
    coverage_note: z.string().optional(),
  })
  .strict();
export type PrSubmitArgs = z.infer<typeof PrSubmitArgs>;

export const PR_SUBMIT_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'submit_answer',
    description:
      'Finish the explanation. `summary` is a short overview for the architect. `findings` has one entry per finding id (F1, F2, …) with your explanation of it and optional evidence ids. Every finding must be explained.',
    parameters: z.toJSONSchema(PrSubmitArgs) as Record<string, unknown>,
  },
};

export interface PrFindingResult {
  id: string;
  kind: string;
  service: string | null;
  key: string | null;
  /** Clase del motor, verbatim. */
  engine_class: string | null;
  affected: PrFinding['affected'];
  /** null = el modelo no explicó este hallazgo. */
  explanation: string | null;
  evidence: { accepted: string[]; rejected: Array<{ ref: string; reason: string }> };
}

export interface PrVerification {
  findings: PrFindingResult[];
  unaddressed: string[];
  /** Ids que el modelo explicó y que no existen en el análisis. */
  unknownIds: string[];
  /** Todo lo que escribió el modelo (para el detector de conflictos de clase). */
  modelText: string;
  narrative: string;
}

/**
 * Contrasta la entrega del modelo con los hallazgos del motor y compone la
 * narrativa. `validateRefs` es el validador de evidencia (INV 1).
 */
export async function verifyPrSubmission(
  findings: readonly PrFinding[],
  submission: PrSubmitArgs,
  coverage: PrCoverage,
  validateRefs: (refs: string[]) => Promise<PrFindingResult['evidence']>,
): Promise<PrVerification> {
  const byId = new Map<string, PrSubmitArgs['findings'][number]>();
  const unknownIds: string[] = [];
  for (const entry of submission.findings) {
    if (findings.some((f) => f.id === entry.id)) {
      // Dos entradas para el mismo id: se conserva la primera, no se mezclan.
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    } else {
      unknownIds.push(entry.id);
    }
  }

  const results: PrFindingResult[] = [];
  for (const f of findings) {
    const entry = byId.get(f.id);
    results.push({
      id: f.id,
      kind: f.kind,
      service: f.service,
      key: f.key,
      engine_class: f.engineClass,
      affected: f.affected,
      explanation: entry?.explanation ?? null,
      evidence: entry?.evidence?.length
        ? await validateRefs(entry.evidence)
        : { accepted: [], rejected: [] },
    });
  }

  const unaddressed = results.filter((r) => r.explanation === null).map((r) => r.id);
  const lines = results.map((r) => {
    const affected = r.affected.length
      ? r.affected.map((a) => a.service).join(', ')
      : 'none recorded';
    return [
      `- ${r.id} ${r.kind} ${r.service ?? '?'} ${r.key ?? '?'} [engine: ${r.engine_class ?? 'unclassified'}] affects: ${affected}`,
      `  ${r.explanation ?? 'NOT EXPLAINED by the model.'}`,
    ].join('\n');
  });
  const narrative = [
    submission.summary.trim(),
    '',
    'Findings (engine classifications are authoritative):',
    ...lines,
    '',
    coverageLine(coverage),
    ...(submission.coverage_note ? [submission.coverage_note.trim()] : []),
  ].join('\n');

  const modelText = [
    submission.summary,
    ...submission.findings.map((e) => e.explanation),
    submission.coverage_note ?? '',
  ].join('\n');

  return { findings: results, unaddressed, unknownIds, modelText, narrative };
}
