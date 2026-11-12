// Recall@k de la búsqueda de documentación: ¿el archivo que SE ESPERA para una pregunta está
// entre los k primeros? Mide la recuperación sola (sin modelo), así un cambio en el índice o en
// la consulta se juzga con números y no a ojo.

import type { DocHit } from './index.js';

export interface RecallCase {
  question: string;
  /** Cualquiera de estas rutas cuenta como acierto. */
  expect: readonly string[];
  repo?: string;
}

export interface RecallReport {
  k: number;
  total: number;
  hits: number;
  recall: number;
  misses: Array<{ question: string; got: string[] }>;
}

export function recallAtK(
  search: (question: string, opts: { repo?: string; limit: number }) => DocHit[],
  cases: readonly RecallCase[],
  k: number,
): RecallReport {
  const misses: RecallReport['misses'] = [];
  let hits = 0;
  for (const c of cases) {
    const got = search(c.question, { ...(c.repo ? { repo: c.repo } : {}), limit: k }).map(
      (h) => h.path,
    );
    if (got.some((p) => c.expect.includes(p))) hits++;
    else misses.push({ question: c.question, got });
  }
  return { k, total: cases.length, hits, recall: cases.length ? hits / cases.length : 0, misses };
}
