import { createHash } from 'node:crypto';
import type { ChatMessage, NemotronResponse } from '../agent/nemotron.js';
import type { LainAdapter } from '../lain-adapter/types.js';
import {
  buildUserPrompt,
  type Case,
  classifyByRule,
  groupKey,
  parseVerdicts,
  SYSTEM_PROMPT,
} from './classify.js';
import { collectLooseEnds } from './collect.js';
import type { createLooseEndStore } from './store.js';
import { type Assessment, CATEGORIES, type Category, type LooseEnd } from './types.js';

/** Lo único que el servicio necesita del modelo: una finalización de chat. */
export interface LooseEndsModel {
  name: string;
  complete(
    messages: ChatMessage[],
    opts: { model?: 'planner' | 'worker'; maxTokens?: number; thinking?: boolean },
  ): Promise<Pick<NemotronResponse, 'content'> & Partial<Pick<NemotronResponse, 'usage'>>>;
}

export interface LooseEndsDeps {
  store: ReturnType<typeof createLooseEndStore>;
  getAdapter(workspaceId: string): Promise<LainAdapter | null>;
  model(): LooseEndsModel | null;
  batchSize?: number;
  /** Techo de llamadas al modelo por ejecución (lotes + reintentos). */
  maxModelCalls?: number;
  /** Techo de tiempo por ejecución, en ms. */
  maxRunMs?: number;
  ttlMs?: number;
  now?: () => number;
}

export interface LooseEndView extends LooseEnd {
  group: string;
  assessment: Assessment | null;
}

export interface LooseEndsReport {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  generatedAt: number | null;
  items: LooseEndView[];
  summary: {
    total: number;
    byCategory: Record<Category, number>;
    /** Casos (no sitios) que esperan al modelo. */
    pendingCases: number;
  };
  run: {
    state: 'idle' | 'running' | 'done' | 'failed';
    done: number;
    total: number;
    error?: string | null;
    /** Lo que costó la ejecución: llamadas al modelo, tokens generados y tiempo. */
    usage?: { modelCalls: number; completionTokens: number; ms: number };
  };
}

const SNIPPET_CHARS = 1500;
/** Sin razonamiento interno la respuesta de un lote ronda los 300 tokens: esto es un techo, no un objetivo. */
const MAX_TOKENS = 1536;
const gid = (e: LooseEnd): string =>
  createHash('sha1').update(groupKey(e)).digest('hex').slice(0, 12);
const hashText = (t: string): string => createHash('sha1').update(t).digest('hex').slice(0, 16);

export function createLooseEndsService(deps: LooseEndsDeps) {
  // Lotes chicos: el modelo razona antes de responder y un lote grande agota su presupuesto.
  const batchSize = deps.batchSize ?? 5;
  const maxModelCalls = deps.maxModelCalls ?? 20;
  const maxRunMs = deps.maxRunMs ?? 120_000;
  const ttlMs = deps.ttlMs ?? 5 * 60_000;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; items: LooseEnd[] }>();
  const runs = new Map<string, LooseEndsReport['run']>();
  const inflight = new Map<string, Promise<void>>();

  async function collect(workspaceId: string, force = false): Promise<LooseEnd[] | null> {
    const hit = cache.get(workspaceId);
    if (hit && !force && now() - hit.at < ttlMs) return hit.items;
    const adapter = await deps.getAdapter(workspaceId);
    if (!adapter) return null;
    const items = await collectLooseEnds(adapter);
    cache.set(workspaceId, { at: now(), items });
    return items;
  }

  const emptyCounts = (): Record<Category, number> =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

  async function list(
    workspaceId: string,
    opts: { refresh?: boolean } = {},
  ): Promise<LooseEndsReport> {
    const run = runs.get(workspaceId) ?? { state: 'idle' as const, done: 0, total: 0 };
    let items: LooseEnd[] | null;
    try {
      items = await collect(workspaceId, opts.refresh);
    } catch (e) {
      return report(
        'error',
        [],
        new Map(),
        run,
        e instanceof Error ? e.message : 'lain unreachable',
      );
    }
    if (items === null) return report('unconfigured', [], new Map(), run);
    const stored = await deps.store.list(workspaceId);
    return report('lain', items, stored, run);
  }

  function report(
    source: LooseEndsReport['source'],
    items: LooseEnd[],
    stored: Map<string, Assessment & { snippetHash?: string }>,
    run: LooseEndsReport['run'],
    error?: string,
  ): LooseEndsReport {
    const byCategory = emptyCounts();
    const pending = new Set<string>();
    const views = items.map((e): LooseEndView => {
      const group = gid(e);
      const assessment = classifyByRule(e) ?? stored.get(group) ?? null;
      if (assessment) byCategory[assessment.category]++;
      else pending.add(group);
      return { ...e, group, assessment };
    });
    return {
      source,
      ...(error ? { error } : {}),
      generatedAt:
        cache.size > 0 ? [...cache.values()].reduce((m, c) => Math.max(m, c.at), 0) : null,
      items: views.sort(
        (a, b) =>
          (a.assessment?.category ?? 'zz').localeCompare(b.assessment?.category ?? 'zz') ||
          a.path.localeCompare(b.path) ||
          (a.line ?? 0) - (b.line ?? 0),
      ),
      summary: { total: items.length, byCategory, pendingCases: pending.size },
      run,
    };
  }

  /** Un caso por grupo: el primer sitio (el de menor línea) con su fragmento de código. */
  async function buildCases(
    adapter: LainAdapter,
    groups: Map<string, LooseEnd[]>,
  ): Promise<Array<Case & { hash: string }>> {
    const out: Array<Case & { hash: string }> = [];
    for (const [id, members] of groups) {
      const rep = [...members].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))[0] as LooseEnd;
      let snippet = '';
      try {
        const r = await adapter.getCodeSnippet({
          path: rep.path,
          repo_id: rep.repo,
          ...(rep.line ? { line: rep.line } : {}),
          context_lines: 4,
        });
        snippet = r.text.slice(0, SNIPPET_CHARS);
      } catch {
        snippet = '';
      }
      out.push({
        id,
        repo: rep.repo,
        path: rep.path,
        line: rep.line,
        kind: rep.kind,
        reason: rep.reason,
        members: members.length,
        detail: rep.detail,
        candidates: rep.candidates,
        snippet,
        hash: hashText(`${rep.reason}|${rep.line}|${snippet}`),
      });
    }
    return out;
  }

  /** Un lote al modelo; lo que no respondió se reintenta UNA vez, y lo que siga sin respuesta queda "unclear". */
  async function judge(
    model: LooseEndsModel,
    batch: Array<Case & { hash: string }>,
    usage: { modelCalls: number; completionTokens: number; ms: number },
    overBudget: () => string | null,
  ): Promise<Map<string, Assessment>> {
    const ask = async (cases: readonly Case[]) => {
      const stop = overBudget();
      if (stop) throw new Error(stop);
      usage.modelCalls++;
      const res = await model.complete(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(cases) },
        ],
        { model: 'planner', maxTokens: MAX_TOKENS, thinking: false },
      );
      usage.completionTokens += res.usage?.completionTokens ?? 0;
      return parseVerdicts(res.content ?? '', cases, model.name, { fillMissing: false });
    };
    const got = await ask(batch);
    const unusable = (m: Map<string, Assessment>, c: Case) =>
      !m.has(c.id) || m.get(c.id)?.invalid === true;
    const missing = batch.filter((c) => unusable(got, c));
    if (missing.length > 0) {
      const again = await ask(missing).catch((e: unknown) => {
        if (e instanceof Error && e.message.startsWith('budget:')) throw e;
        return new Map<string, Assessment>();
      });
      for (const c of missing) {
        const v = again.get(c.id);
        if (v && !v.invalid) got.set(c.id, v);
      }
    }
    // Lo que siga sin un veredicto utilizable NO se guarda: queda pendiente y se reintenta.
    for (const c of batch) if (unusable(got, c)) got.delete(c.id);
    return got;
  }

  async function runAssess(workspaceId: string, model: LooseEndsModel): Promise<void> {
    const startedAt = now();
    const usage = { modelCalls: 0, completionTokens: 0, ms: 0 };
    const run: LooseEndsReport['run'] = { state: 'running', done: 0, total: 0, usage };
    runs.set(workspaceId, run);
    // Una ejecución no puede gastar sin límite: llamadas y tiempo están acotados.
    const overBudget = (): string | null =>
      usage.modelCalls >= maxModelCalls
        ? `budget: ${maxModelCalls} model calls per run reached`
        : now() - startedAt >= maxRunMs
          ? `budget: ${Math.round(maxRunMs / 1000)} s per run reached`
          : null;
    try {
      const items = (await collect(workspaceId, true)) ?? [];
      const adapter = await deps.getAdapter(workspaceId);
      if (!adapter) throw new Error('workspace has no LAIN server');
      const stored = await deps.store.list(workspaceId);
      const groups = new Map<string, LooseEnd[]>();
      for (const e of items) {
        if (classifyByRule(e)) continue; // la ruta ya lo dice: sin modelo
        const g = gid(e);
        groups.set(g, [...(groups.get(g) ?? []), e]);
      }
      const cases = (await buildCases(adapter, groups)).filter(
        (c) => stored.get(c.id)?.snippetHash !== c.hash,
      );
      run.total = cases.length;
      for (let i = 0; i < cases.length; i += batchSize) {
        const batch = cases.slice(i, i + batchSize);
        try {
          const verdicts = await judge(model, batch, usage, overBudget);
          for (const c of batch) {
            const v = verdicts.get(c.id);
            if (v) await deps.store.put(workspaceId, c.id, c.hash, v);
          }
        } catch (e) {
          run.error = e instanceof Error ? e.message : 'model call failed';
          // Agotar el presupuesto detiene la ejecución; un fallo de un lote no.
          if (run.error.startsWith('budget:')) break;
        }
        run.done = Math.min(cases.length, i + batch.length);
      }
      run.state = run.error ? 'failed' : 'done';
      usage.ms = now() - startedAt;
    } catch (e) {
      run.state = 'failed';
      run.error = e instanceof Error ? e.message : 'assessment failed';
      usage.ms = now() - startedAt;
    }
  }

  return {
    list,
    /** Lanza la clasificación con el modelo en segundo plano. */
    async assess(workspaceId: string): Promise<'started' | 'running' | 'no_model'> {
      if (inflight.has(workspaceId)) return 'running';
      const model = deps.model();
      if (!model) return 'no_model';
      const p = runAssess(workspaceId, model).finally(() => inflight.delete(workspaceId));
      inflight.set(workspaceId, p);
      return 'started';
    },
    /** Espera a que termine la ejecución en curso (para tests y scripts). */
    async idle(workspaceId: string): Promise<void> {
      await inflight.get(workspaceId);
    },
  };
}
