import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS,
  mergeAnswers,
  PipelineBody,
  PipelineError,
  preparePipeline,
  readAnswer,
} from '../src/graph-query/pipeline.js';

// Respuestas literales de `query_graph` de LAIN 0.16.0 sobre Saleor, una por repo
// (recortadas sólo en listas largas de aristas y nodos de ejemplo).
const LIVE = JSON.parse(
  readFileSync(new URL('./fixtures/lain-query-graph-0.16-saleor.json', import.meta.url), 'utf8'),
) as Record<string, { group: unknown; nodes: unknown }>;

const ops = (...o: Array<Record<string, unknown>>) =>
  PipelineBody.parse({ ops: o }).ops as Parameters<typeof preparePipeline>[0];

describe('preparePipeline', () => {
  it('requires a find first', () => {
    expect(() => preparePipeline(ops({ op: 'limit', count: 3 }))).toThrow(PipelineError);
  });

  it('takes a final sort and limit out of the engine query: they are applied after merging repos', () => {
    const p = preparePipeline(
      ops(
        { op: 'find', type: 'Function' },
        { op: 'group', by: 'service' },
        { op: 'sort', by: 'count', direction: 'desc' },
        { op: 'limit', count: 10, offset: 2 },
      ),
    );
    expect(p.engineOps.map((o) => o.op)).toEqual(['find', 'group', 'limit']);
    expect(p.engineOps[2]).toMatchObject({ op: 'limit', count: MAX_ROWS });
    expect(p.sort).toEqual({ by: 'count', direction: 'desc' });
    expect(p.limit).toEqual({ count: 10, offset: 2 });
    expect(p.hasGroup).toBe(true);
    expect(p.appendedLimit).toBe(true);
  });

  it('always sends the engine a limit: without one it silently cuts at 100 per repo', () => {
    const grouped = preparePipeline(ops({ op: 'find', type: 'X' }, { op: 'group', by: 'repo' }));
    expect(grouped.engineOps.at(-1)).toMatchObject({ op: 'limit', count: MAX_ROWS });
    const plain = preparePipeline(ops({ op: 'find', type: 'X' }));
    expect(plain.engineOps.at(-1)).toMatchObject({ op: 'limit', count: 500 });
    const wide = preparePipeline(ops({ op: 'find', type: 'X' }, { op: 'limit', count: 800 }));
    expect(wide.engineOps.at(-1)).toMatchObject({ op: 'limit', count: 800 });
  });

  it('keeps a limit the user put before another step', () => {
    const p = preparePipeline(
      ops({ op: 'find', type: 'X' }, { op: 'limit', count: 50 }, { op: 'group', by: 'repo' }),
    );
    expect(p.engineOps.map((o) => o.op)).toEqual(['find', 'limit', 'group']);
    expect(p.appendedLimit).toBe(false);
  });

  it('caps how deep a connect may walk', () => {
    const q = (depth: unknown) => ops({ op: 'find' }, { op: 'connect', edge: 'Binds', depth });
    expect(() => preparePipeline(q(7))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q({ min: 1, max: 50 }))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q('50'))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q({ max: '1000' }))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q(2.5))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q(0))).toThrow(/from 1 to 6/);
    expect(() => preparePipeline(q(6))).not.toThrow();
    expect(() => preparePipeline(q({ min: 1, max: 3 }))).not.toThrow();
    // Sin depth explícito el motor usa su valor por defecto: se acepta.
    expect(() =>
      preparePipeline(ops({ op: 'find' }, { op: 'connect', edge: 'Binds' })),
    ).not.toThrow();
  });

  it('rejects limits outside 1..1000', () => {
    expect(() => preparePipeline(ops({ op: 'find' }, { op: 'limit', count: 0 }))).toThrow(
      /between 1 and 1000/,
    );
    expect(() => preparePipeline(ops({ op: 'find' }, { op: 'limit', count: 5000 }))).toThrow(
      /between 1 and 1000/,
    );
  });
});

describe('PipelineBody', () => {
  it('accepts only the read-only ops and caps the length', () => {
    expect(PipelineBody.safeParse({ ops: [{ op: 'find' }, { op: 'delete' }] }).success).toBe(false);
    expect(PipelineBody.safeParse({ ops: [{ op: 'semantic_filter', like: 'x' }] }).success).toBe(
      false,
    );
    expect(PipelineBody.safeParse({ ops: [] }).success).toBe(false);
    const many = Array.from({ length: 13 }, () => ({ op: 'find' }));
    expect(PipelineBody.safeParse({ ops: many }).success).toBe(false);
    const huge = { op: 'find', name: 'x'.repeat(3000) };
    expect(PipelineBody.safeParse({ ops: [huge] }).success).toBe(false);
  });
});

describe('mergeAnswers over real 0.16.0 answers', () => {
  const answers = (key: 'group' | 'nodes') =>
    Object.entries(LIVE).map(([repo, r]) => readAnswer(repo, r[key]));

  it('adds up groups from every repo and says what each repo contributed', () => {
    const p = preparePipeline(
      ops(
        { op: 'find', type: 'Function' },
        { op: 'group', by: 'service' },
        { op: 'sort', by: 'count', direction: 'desc' },
        { op: 'limit', count: 10 },
      ),
    );
    const r = mergeAnswers(p, answers('group'));
    expect(r.nodes).toBeNull();
    expect(r.groups).toEqual([
      {
        key: 'saleor-api',
        count: 636 + 573 + 63,
        byRepo: { saleor: 636, 'saleor-dashboard': 573, storefront: 63 },
      },
    ]);
    expect(r.engineTruncated).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it('sums the per-step counts across repos and hides the limit it added itself', () => {
    const p = preparePipeline(ops({ op: 'find', type: 'F' }, { op: 'group', by: 'service' }));
    expect(p.appendedLimit).toBe(true);
    const r = mergeAnswers(p, answers('group'));
    expect(r.steps.map((s) => s.op)).toEqual(['find', 'connect', 'group']);
    const find = r.steps[0];
    const per = answers('group').map((a) => a.explain[0]?.nodes ?? 0);
    expect(find?.nodes).toBe(per.reduce((a, b) => a + b, 0));
  });

  it('merges node results from all repos, orders them and applies the final limit', () => {
    const p = preparePipeline(
      ops({ op: 'find', type: 'Table' }, { op: 'sort', by: 'name' }, { op: 'limit', count: 3 }),
    );
    const r = mergeAnswers(p, answers('nodes'));
    expect(r.groups).toBeNull();
    expect(r.nodes?.map((n) => n.name)).toEqual([
      'order_fulfillment',
      'order_fulfillmentline',
      'order_order',
    ]);
    expect(r.nodes?.every((n) => n.repo === 'saleor')).toBe(true);
    expect(r.nodes?.[0]).toMatchObject({ path: 'saleor/order/models.py', line: 776 });
    expect(r.total).toBe(8);
    expect(r.truncated).toBe(true);
  });

  it('sorts groups ascending by count when asked, and pages with offset', () => {
    const p = preparePipeline(
      ops(
        { op: 'find' },
        { op: 'group', by: 'repo' },
        { op: 'sort', by: 'count', direction: 'asc' },
        { op: 'limit', count: 1, offset: 1 },
      ),
    );
    const mk = (repo: string, key: string, count: number) =>
      readAnswer(repo, { count, groups: [{ key, count }], explain: [] });
    const r = mergeAnswers(p, [mk('a', 'x', 5), mk('a', 'y', 1), mk('b', 'z', 3)]);
    expect(r.groups?.map((g) => g.key)).toEqual(['z']);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it('reports when the engine itself cut a repo short, so counts are known to be partial', () => {
    const p = preparePipeline(ops({ op: 'find' }, { op: 'group', by: 'repo' }));
    const cut = readAnswer('a', {
      count: 100,
      groups: [{ key: 'a', count: 100 }],
      meta: { truncated: true, matched_before_limit: 235 },
    });
    expect(mergeAnswers(p, [cut]).engineTruncated).toBe(true);
  });
});

describe('readAnswer', () => {
  it('ignores malformed parts instead of inventing them', () => {
    const a = readAnswer('r', {
      nodes: [{ id: 1 }, { id: 'a', type: 'T', name: 'n' }],
      groups: [{ key: 'k' }, { key: 'g', count: 2 }],
      explain: [{ op: 'find' }, { op: 'find', nodes: 3 }],
    });
    expect(a.nodes).toHaveLength(1);
    expect(a.groups).toEqual([{ key: 'g', count: 2 }]);
    expect(a.explain).toEqual([{ op: 'find', nodes: 3, edges: 0 }]);
    expect(readAnswer('r', null).count).toBe(0);
  });
});
