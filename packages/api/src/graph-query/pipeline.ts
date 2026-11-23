import { z } from 'zod';

// Consulta estructurada sobre el grafo del motor (`query_graph`), la pantalla "Query" de
// la referencia: find → connect → filter → group → sort → limit, con el conteo tras cada
// paso. Lain 0.16 lo hace posible (aristas Binds, group por repo/servicio, count, explain);
// el motor exige `repo_id` en una federación, así que se pregunta repo por repo y aquí se
// juntan las respuestas. Todo es de sólo lectura: las ops son una lista cerrada.

export const QUERY_OPS = ['find', 'connect', 'filter', 'group', 'sort', 'limit'] as const;
export type QueryOpName = (typeof QUERY_OPS)[number];

export const MAX_OPS = 12;
export const MAX_ROWS = 1000;
/** Saltos máximos de un connect: una consulta de sólo lectura no debe poder pedir un recorrido ilimitado. */
export const MAX_DEPTH = 6;
/** Tope por repo cuando la consulta no lo pone (el motor corta en 100 por defecto). */
export const DEFAULT_ROWS = 500;

const MAX_OP_JSON = 2000;

const Op = z
  .looseObject({ op: z.enum(QUERY_OPS) })
  .refine((o) => JSON.stringify(o).length <= MAX_OP_JSON, { message: 'op too large' });

export const PipelineBody = z.object({
  ops: z.array(Op).min(1).max(MAX_OPS),
  /** Subconjunto de repos del motor; por defecto, todos. */
  repos: z.array(z.string().min(1)).max(100).optional(),
});
export type PipelineBody = z.infer<typeof PipelineBody>;

type Op = z.infer<typeof Op>;

export interface PreparedPipeline {
  /** Lo que se manda al motor en cada repo: sin sort/limit finales (se aplican tras juntar). */
  engineOps: Op[];
  hasGroup: boolean;
  sort: { by: string; direction: 'asc' | 'desc' } | null;
  limit: { count: number; offset: number } | null;
  /** Se añadió un limit por el motor que el usuario no pidió: su paso no se muestra. */
  appendedLimit: boolean;
}

/** Error de la consulta del usuario (no del motor): se responde 400. */
export class PipelineError extends Error {}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;

export function preparePipeline(ops: readonly Op[]): PreparedPipeline {
  if (ops[0]?.op !== 'find') throw new PipelineError('a query starts with a find step');
  const engineOps = [...ops];
  let sort: PreparedPipeline['sort'] = null;
  let limit: PreparedPipeline['limit'] = null;
  // sort y limit finales no se pueden aplicar por repo: cada repo daría su propio "top N".
  const tail = engineOps[engineOps.length - 1];
  if (tail?.op === 'limit') {
    engineOps.pop();
    const count = num(tail.count, DEFAULT_ROWS);
    if (count < 1 || count > MAX_ROWS) {
      throw new PipelineError(`limit count must be between 1 and ${MAX_ROWS}`);
    }
    limit = { count, offset: num(tail.offset, 0) };
  }
  const maybeSort = engineOps[engineOps.length - 1];
  if (maybeSort?.op === 'sort') {
    engineOps.pop();
    sort = {
      by: typeof maybeSort.by === 'string' ? maybeSort.by : 'name',
      direction: maybeSort.direction === 'desc' ? 'desc' : 'asc',
    };
  }
  if (engineOps.some((o) => o.op === 'limit' && num(o.count, 0) > MAX_ROWS)) {
    throw new PipelineError(`limit count must be at most ${MAX_ROWS}`);
  }
  for (const o of engineOps) {
    if (o.op !== 'connect') continue;
    const d = o.depth;
    const max = typeof d === 'object' && d !== null ? (d as { max?: unknown }).max : d;
    // Only a plain integer in range reaches the engine: a string or fraction could be coerced
    // there past the cap, and an omitted depth is the engine's own default.
    if (
      max !== undefined &&
      (!Number.isInteger(max) || (max as number) < 1 || (max as number) > MAX_DEPTH)
    ) {
      throw new PipelineError(`connect depth must be an integer from 1 to ${MAX_DEPTH}`);
    }
  }
  const hasGroup = engineOps.some((o) => o.op === 'group');
  // Sin un limit explícito el motor corta en 100 por repo (incluso antes de agrupar, y los
  // conteos saldrían bajos). Se pide un tope claro; lo que aún se corte lo dice `truncated`.
  const appendedLimit = !engineOps.some((o) => o.op === 'limit');
  if (appendedLimit) {
    const wanted = limit ? limit.count + limit.offset : DEFAULT_ROWS;
    engineOps.push({
      op: 'limit',
      count: hasGroup ? MAX_ROWS : Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, wanted)),
    });
  }
  return { engineOps, hasGroup, sort, limit, appendedLimit };
}

// ── Lo que devuelve el motor por repo (forma de 0.16.0) ──

export interface RepoAnswer {
  repo: string;
  count: number;
  nodes: Array<{ id: string; type: string; name: string; path?: string; line?: number }>;
  groups: Array<{ key: string; count: number }>;
  explain: Array<{ op: string; nodes: number; edges: number }>;
  /** El motor dice cuántos casaron antes de cortar. */
  matchedBeforeLimit: number | null;
  /** El motor avisa que cortó el resultado (meta.truncated). */
  truncated: boolean;
}

export interface GroupRow {
  key: string;
  count: number;
  /** Cuánto aporta cada repo. */
  byRepo: Record<string, number>;
}

export interface NodeRow {
  id: string;
  type: string;
  name: string;
  repo: string;
  path?: string;
  line?: number;
}

export interface StepCount {
  op: string;
  nodes: number;
  edges: number;
}

export interface MergedResult {
  groups: GroupRow[] | null;
  nodes: NodeRow[] | null;
  /** Conteo tras cada paso, sumado entre los repos que respondieron. */
  steps: StepCount[];
  /** Filas antes del corte final, y si algo se cortó. */
  total: number;
  truncated: boolean;
  /** El motor cortó el resultado de algún repo: los conteos son parciales. */
  engineTruncated: boolean;
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function readAnswer(repo: string, raw: unknown): RepoAnswer {
  const r = obj(raw);
  const nodes = (Array.isArray(r.nodes) ? r.nodes : []).flatMap((x) => {
    const o = obj(x);
    return typeof o.id === 'string' && typeof o.type === 'string' && typeof o.name === 'string'
      ? [
          {
            id: o.id,
            type: o.type,
            name: o.name,
            ...(typeof o.path === 'string' ? { path: o.path } : {}),
            ...(typeof o.line_start === 'number' ? { line: o.line_start } : {}),
          },
        ]
      : [];
  });
  const groups = (Array.isArray(r.groups) ? r.groups : []).flatMap((x) => {
    const o = obj(x);
    return typeof o.key === 'string' && typeof o.count === 'number'
      ? [{ key: o.key, count: o.count }]
      : [];
  });
  const explain = (Array.isArray(r.explain) ? r.explain : []).flatMap((x) => {
    const o = obj(x);
    return typeof o.op === 'string' && typeof o.nodes === 'number'
      ? [{ op: o.op, nodes: o.nodes, edges: typeof o.edges === 'number' ? o.edges : 0 }]
      : [];
  });
  const m = obj(r.meta).matched_before_limit;
  return {
    repo,
    count: typeof r.count === 'number' ? r.count : nodes.length,
    nodes,
    groups,
    explain,
    matchedBeforeLimit: typeof m === 'number' ? m : null,
    truncated: obj(r.meta).truncated === true,
  };
}

const byCount = (dir: 'asc' | 'desc') => (a: GroupRow, b: GroupRow) =>
  (dir === 'desc' ? b.count - a.count : a.count - b.count) || a.key.localeCompare(b.key);

export function mergeAnswers(p: PreparedPipeline, answers: readonly RepoAnswer[]): MergedResult {
  const steps: StepCount[] = [];
  const engineTruncated = answers.some((a) => a.truncated);
  for (const a of answers) {
    a.explain.forEach((e, i) => {
      const cur = steps[i] ?? { op: e.op, nodes: 0, edges: 0 };
      steps[i] = { op: cur.op, nodes: cur.nodes + e.nodes, edges: cur.edges + e.edges };
    });
  }

  if (p.appendedLimit) steps.pop();

  if (p.hasGroup) {
    const byKey = new Map<string, GroupRow>();
    for (const a of answers) {
      for (const g of a.groups) {
        const row = byKey.get(g.key) ?? { key: g.key, count: 0, byRepo: {} };
        row.count += g.count;
        row.byRepo[a.repo] = (row.byRepo[a.repo] ?? 0) + g.count;
        byKey.set(g.key, row);
      }
    }
    const all = [...byKey.values()];
    const by = p.sort?.by ?? 'count';
    const dir = p.sort?.direction ?? 'desc';
    all.sort(
      by === 'name' || by === 'type' || by === 'label'
        ? (a, b) => (dir === 'desc' ? -1 : 1) * a.key.localeCompare(b.key)
        : byCount(dir),
    );
    const off = p.limit?.offset ?? 0;
    const page = p.limit ? all.slice(off, off + p.limit.count) : all;
    return {
      groups: page,
      nodes: null,
      steps,
      total: all.length,
      truncated: page.length < all.length,
      engineTruncated,
    };
  }

  const all: NodeRow[] = answers.flatMap((a) => a.nodes.map((n) => ({ ...n, repo: a.repo })));
  const by = p.sort?.by ?? 'name';
  const dir = p.sort?.direction ?? 'asc';
  const key = (n: NodeRow) => (by === 'type' ? n.type : n.name);
  all.sort(
    (a, b) => (dir === 'desc' ? -1 : 1) * key(a).localeCompare(key(b)) || a.id.localeCompare(b.id),
  );
  const off = p.limit?.offset ?? 0;
  const page = p.limit ? all.slice(off, off + p.limit.count) : all;
  const matched = answers.reduce(
    (n, a) => n + Math.max(a.matchedBeforeLimit ?? 0, a.nodes.length),
    0,
  );
  return {
    groups: null,
    nodes: page,
    steps,
    total: Math.max(matched, all.length),
    truncated: page.length < Math.max(matched, all.length),
    engineTruncated,
  };
}
