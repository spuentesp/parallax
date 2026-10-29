import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import type { Case } from '../src/loose-ends/classify.js';
import { classifyByPath, parseVerdicts } from '../src/loose-ends/classify.js';
import { collectLooseEnds } from '../src/loose-ends/collect.js';

describe('classifyByPath — what a path alone proves', () => {
  it('tests, e2e, scripts, mocks and stories are not product behaviour', () => {
    for (const path of [
      'saleor/core/tests/test_x.py',
      'e2e/lib/docker.ts',
      'scripts/fetch-local-schema.cjs',
      'src/__mocks__/fs.ts',
      'src/a/Button.test.tsx',
      'src/a/Card.stories.tsx',
      'tests/conftest.py',
    ]) {
      expect(classifyByPath({ path }), path).toMatchObject({
        category: 'test_or_tooling',
        source: 'rule',
      });
    }
  });

  it('product code is left to the model', () => {
    for (const path of [
      'src/graphql/authFetch.ts',
      'saleor/checkout/tasks.py',
      'src/hooks/useThing.ts',
    ]) {
      expect(classifyByPath({ path }), path).toBeNull();
    }
  });

  it('says why', () => {
    expect(classifyByPath({ path: 'e2e/x.ts' })?.reason).toBe('the file is under "e2e/"');
  });
});

const caseOf = (id: string, over: Partial<Case> = {}): Case => ({
  id,
  repo: 'r',
  path: `src/${id}.ts`,
  line: 10,
  kind: 'unresolved',
  reason: 'no_match',
  members: 1,
  detail: {},
  candidates: [],
  snippet: '',
  ...over,
});

describe('parseVerdicts — the model cannot assign anything it was not asked about', () => {
  const cases = [caseOf('a'), caseOf('b'), caseOf('c')];
  const ok = (id: string, over: object = {}) => ({
    id,
    category: 'external_call',
    reason: 'calls a CDN',
    evidence: `src/${id}.ts:10`,
    ...over,
  });

  it("accepts a valid verdict that cites the case's own site, even with prose around the JSON", () => {
    const out = parseVerdicts(
      `Here you go:\n${JSON.stringify([ok('a'), ok('b', { category: 'not_a_call' })])}\nDone.`,
      cases,
      'm',
    );
    expect(out.get('a')).toEqual({
      category: 'external_call',
      reason: 'calls a CDN',
      evidence: 'src/a.ts:10',
      source: 'model',
      model: 'm',
    });
    expect(out.get('b')?.category).toBe('not_a_call');
  });

  it('a verdict that cites another location is downgraded to unclear', () => {
    const out = parseVerdicts(
      JSON.stringify([ok('a', { evidence: 'src/other.ts:99' })]),
      cases,
      'm',
    );
    expect(out.get('a')).toMatchObject({ category: 'unclear', source: 'model' });
    expect(out.get('a')?.reason).toMatch(/own code location/);
  });

  it('an unknown category, an empty reason or a made-up id is not accepted', () => {
    const out = parseVerdicts(
      JSON.stringify([
        ok('a', { category: 'definitely_fine' }),
        ok('b', { reason: '  ' }),
        ok('zzz'),
      ]),
      cases,
      'm',
    );
    expect(out.get('a')?.category).toBe('unclear');
    expect(out.get('b')?.category).toBe('unclear');
    expect(out.has('zzz')).toBe(false);
  });

  it('every case gets an answer: missing ones are unclear, never silently absent', () => {
    const out = parseVerdicts(JSON.stringify([ok('a')]), cases, 'm');
    expect([...out.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(out.get('c')).toMatchObject({
      category: 'unclear',
      reason: 'the model did not answer this case',
    });
  });

  it('garbage in, all unclear', () => {
    for (const text of ['', 'I cannot do that', '[not json', '{"a":1}']) {
      const out = parseVerdicts(text, cases, null);
      expect([...out.values()].every((v) => v.category === 'unclear')).toBe(true);
    }
  });

  it('accepts the site written the way the prompt shows it (repo:path:line), stored as path:line', () => {
    const out = parseVerdicts(JSON.stringify([ok('a', { evidence: 'r:src/a.ts:10' })]), cases, 'm');
    expect(out.get('a')).toMatchObject({ category: 'external_call', evidence: 'src/a.ts:10' });
  });

  it('recovers whole objects from a reply that was cut off before the closing bracket', () => {
    const cut = `thinking...\n[${JSON.stringify(ok('a'))}, ${JSON.stringify(ok('b'))}, {"id": "c", "categ`;
    const out = parseVerdicts(cut, cases, 'm', { fillMissing: false });
    expect([...out.keys()].sort()).toEqual(['a', 'b']);
  });

  it('with fillMissing off, unanswered cases are left out so they can be retried', () => {
    expect(parseVerdicts('[]', cases, 'm', { fillMissing: false }).size).toBe(0);
  });

  it('the first verdict for a case wins', () => {
    const out = parseVerdicts(
      JSON.stringify([ok('a'), ok('a', { category: 'not_a_call' })]),
      cases,
      'm',
    );
    expect(out.get('a')?.category).toBe('external_call');
  });
});

describe('collectLooseEnds — what the engine could not bind, with the code location', () => {
  const unresolved = (path: string, line: number, reason = 'no_match') => ({
    reason,
    method: 'GET',
    template: '/x',
    url_expr: 'GET /x',
    consumer: { repo: 'web', path, line },
    candidates: [
      { endpoint: { key: 'http:GET /a' } },
      { endpoint: { key: 'http:GET /b' } },
      { endpoint: { key: 'http:GET /c' } },
      { endpoint: { key: 'http:GET /d' } },
    ],
  });
  const fake = (pages: Array<{ items: object[]; cursor?: string | null }>) => {
    let i = 0;
    return {
      analyzerVersion: 't',
      apiVersion: '1' as const,
      listUnresolved: async () => pages[i++] ?? { items: [] },
      listServices: async () => ({
        items: [
          {
            service: 'api',
            repo: 'api',
            endpoints: 1,
            consumer_services: 1,
            unresolved_inbound: 0,
            paths: [],
          },
        ],
      }),
      getService: async () => ({
        consumers: [
          {
            service: 'web',
            repo: 'web',
            uses: [
              {
                binding: { kind: 'static', confidence: 1 },
                endpoint: { key: 'http:GET /ok', service: 'api' },
                caller: { repo: 'web', path: 'src/ok.ts', line: 1 },
              },
              {
                binding: { kind: 'heuristic', confidence: 0.6, detector: 'unbound_host' },
                endpoint: { key: 'http:ANY /', service: 'api' },
                caller: { repo: 'web', path: 'src/authFetch.ts', line: 138 },
              },
            ],
          },
        ],
      }),
    } as unknown as LainAdapter;
  };

  it('reads every page of unresolved calls and every heuristic use, nothing static', async () => {
    const items = await collectLooseEnds(
      fake([
        { items: [unresolved('src/a.ts', 1)], cursor: 'next' },
        { items: [unresolved('src/b.ts', 2, 'dynamic_topic')], cursor: null },
      ]),
    );
    expect(items.map((e) => `${e.kind}:${e.path}:${e.line}:${e.reason}`).sort()).toEqual([
      'inferred:src/authFetch.ts:138:unbound_host',
      'unresolved:src/a.ts:1:no_match',
      'unresolved:src/b.ts:2:dynamic_topic',
    ]);
  });

  it("keeps the engine's facts: candidates (3 shown, all counted), target, confidence", async () => {
    const items = await collectLooseEnds(fake([{ items: [unresolved('src/a.ts', 1)] }]));
    const un = items.find((e) => e.kind === 'unresolved');
    expect(un?.candidates).toEqual(['http:GET /a', 'http:GET /b', 'http:GET /c']);
    expect(un?.candidateCount).toBe(4);
    const inf = items.find((e) => e.kind === 'inferred');
    expect(inf?.detail).toMatchObject({
      targetService: 'api',
      endpoint: 'http:ANY /',
      confidence: 0.6,
    });
  });

  it('keys are stable between runs and distinct between sites', async () => {
    const a = await collectLooseEnds(
      fake([{ items: [unresolved('src/a.ts', 1), unresolved('src/a.ts', 2)] }]),
    );
    const b = await collectLooseEnds(
      fake([{ items: [unresolved('src/a.ts', 1), unresolved('src/a.ts', 2)] }]),
    );
    expect(a.map((e) => e.key).sort()).toEqual(b.map((e) => e.key).sort());
    expect(new Set(a.map((e) => e.key)).size).toBe(a.length);
  });

  it('skips an item with no code location instead of inventing one', async () => {
    const items = await collectLooseEnds(
      fake([{ items: [{ reason: 'x', consumer: {} }, unresolved('src/a.ts', 1)] }]),
    );
    expect(items.filter((e) => e.kind === 'unresolved')).toHaveLength(1);
  });
});
