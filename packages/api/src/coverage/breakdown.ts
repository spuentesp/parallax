import type { LainAdapter } from '../lain-adapter/types.js';
import type { LooseEndInput } from '../recommendations/collect.js';

// Qué ES cada cabo suelto. El titular "299 consumidores sin resolver" mezcla cosas que
// no son lo mismo: en LAIN 0.15.0, sobre un cluster real, el 70 % eran archivos de
// pruebas y más de la mitad del resto eran llamadas DENTRO de un mismo servicio (el
// motor las rechaza porque "same_service", no porque falten datos). Aquí se separan,
// y cada clase sale de un hecho: la categoría asignada al sitio (regla o modelo), la
// razón del motor, o el veredicto de `check_binding` sobre sus candidatos.

export type CoverageClass =
  | 'test_or_tooling'
  | 'outside'
  | 'internal'
  | 'fixable'
  | 'dynamic'
  | 'no_candidate'
  | 'rejected'
  | 'heuristic'
  | 'unexamined';

export interface ClassInfo {
  id: CoverageClass;
  label: string;
  /** Qué significa y si hay algo que hacer. */
  hint: string;
  /** Cuenta como hueco real de cobertura en código de producto. */
  gap: boolean;
}

export const CLASSES: readonly ClassInfo[] = [
  {
    id: 'fixable',
    label: 'The engine would accept a link',
    hint: 'A candidate passes check_binding: declare it (see Contract remediation).',
    gap: true,
  },
  {
    id: 'rejected',
    label: 'Candidates rejected',
    hint: 'The engine offered candidates and rejected them for a reason other than "same service" (template or fields do not match).',
    gap: true,
  },
  {
    id: 'no_candidate',
    label: 'No candidate offered',
    hint: 'Nothing in the workspace matches this call. It may call something outside it, or a route the analyzer cannot see.',
    gap: true,
  },
  {
    id: 'dynamic',
    label: 'Target built at runtime',
    hint: 'The topic or URL is computed, so no static analysis can resolve it. Declare it by hand if it matters.',
    gap: true,
  },
  {
    id: 'internal',
    label: 'Call inside one service',
    hint: 'The only candidates are in the same service, which the engine rejects as a cross-service link. Not a gap in who depends on whom.',
    gap: false,
  },
  {
    id: 'outside',
    label: 'Not a call, or outside the workspace',
    hint: 'Judged a false positive or a call to an external service.',
    gap: false,
  },
  {
    id: 'test_or_tooling',
    label: 'Test or tooling code',
    hint: 'Under a tests, scripts or tooling path. Does not affect production impact.',
    gap: false,
  },
  {
    id: 'heuristic',
    label: 'Bound only by a heuristic',
    hint: 'Linked with a confidence score, never proven.',
    gap: false,
  },
  {
    id: 'unexamined',
    label: 'Not examined',
    hint: 'Beyond the per-run limit for asking the engine.',
    gap: false,
  },
];

export interface CoverageBreakdown {
  classes: Array<ClassInfo & { count: number }>;
  /** Clase de cada cabo suelto, por su clave. */
  byKey: Record<string, CoverageClass>;
  /** Total de cabos y cuántos son huecos reales en código de producto. */
  total: number;
  gaps: number;
}

const MAX_CHECKED = 200;
const MAX_CANDIDATES = 8;
const CONCURRENCY = 6;
const DYNAMIC = new Set(['dynamic_topic', 'dynamic_target']);

async function mapPool<T, R>(items: readonly T[], size: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/** Veredicto del motor sobre los candidatos de un sitio: ¿alguno pasa, o por qué los rechaza? */
async function verdict(
  adapter: Pick<LainAdapter, 'checkBinding'>,
  item: LooseEndInput,
): Promise<'passes' | 'only_same_service' | 'other' | 'unknown'> {
  const refs = (item.candidateRefs ?? []).slice(0, MAX_CANDIDATES);
  if (!item.consumerId || refs.length === 0) return 'unknown';
  const reasons = new Set<string>();
  let answered = 0;
  for (const ref of refs) {
    try {
      const r = await adapter.checkBinding({
        snapshot: 'live',
        consumer: item.consumerId,
        endpoint: { key: ref.key, service: ref.service },
      });
      answered++;
      if (r.valid) return 'passes';
      for (const reason of r.reasons) reasons.add(String(reason));
    } catch {
      // un fallo puntual no decide nada; si ninguna llamada respondió, queda "unknown"
    }
  }
  if (answered === 0) return 'unknown';
  return reasons.size === 1 && reasons.has('same_service') ? 'only_same_service' : 'other';
}

export async function classifyLooseEnds(
  adapter: Pick<LainAdapter, 'checkBinding'>,
  items: readonly LooseEndInput[],
): Promise<CoverageBreakdown> {
  const byKey: Record<string, CoverageClass> = {};
  const toAsk: LooseEndInput[] = [];

  for (const i of items) {
    const category = i.assessment?.category;
    if (i.kind === 'inferred') byKey[i.key] = category === 'test_or_tooling' ? 'test_or_tooling' : 'heuristic';
    else if (category === 'test_or_tooling') byKey[i.key] = 'test_or_tooling';
    else if (category === 'not_a_call' || category === 'external_call' || i.reason === 'not_a_call')
      byKey[i.key] = 'outside';
    else if (DYNAMIC.has(i.reason) || category === 'dynamic_target') byKey[i.key] = 'dynamic';
    else if (!i.consumerId || !i.candidateRefs?.length) byKey[i.key] = 'no_candidate';
    else toAsk.push(i);
  }

  // Sólo estos cuestan una pregunta al motor: producto, con candidatos, sin explicar aún.
  const asked = toAsk.slice(0, MAX_CHECKED);
  for (const i of toAsk.slice(MAX_CHECKED)) byKey[i.key] = 'unexamined';
  const verdicts = await mapPool(asked, CONCURRENCY, (i) => verdict(adapter, i));
  asked.forEach((i, n) => {
    const v = verdicts[n];
    byKey[i.key] =
      v === 'passes' ? 'fixable' : v === 'only_same_service' ? 'internal' : v === 'other' ? 'rejected' : 'unexamined';
  });

  const counts = new Map<CoverageClass, number>();
  for (const c of Object.values(byKey)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const classes = CLASSES.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })).filter((c) => c.count > 0);
  return {
    classes,
    byKey,
    total: items.length,
    gaps: classes.filter((c) => c.gap).reduce((n, c) => n + c.count, 0),
  };
}
