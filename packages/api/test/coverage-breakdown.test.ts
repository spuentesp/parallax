import { describe, expect, it } from 'vitest';
import { classifyLooseEnds } from '../src/coverage/breakdown.js';
import type { LooseEndInput } from '../src/recommendations/collect.js';

const loose = (key: string, over: Partial<LooseEndInput> = {}): LooseEndInput => ({
  key,
  kind: 'unresolved',
  repo: 'web',
  path: `src/${key}.ts`,
  line: 1,
  reason: 'no_match',
  detail: {},
  candidates: [],
  candidateCount: 1,
  consumerId: `web:Function:src/${key}.ts:call:1`,
  candidateRefs: [{ key: 'http:POST /a', service: 'api', reason: 'pattern' }],
  assessment: null,
  ...over,
});

function engine(reasonsFor: (consumer: string) => string[] | 'valid' | 'throw') {
  const checked: string[] = [];
  return {
    checked,
    adapter: {
      checkBinding: async (req: { consumer: string }) => {
        checked.push(req.consumer);
        const r = reasonsFor(req.consumer);
        if (r === 'throw') throw new Error('down');
        return r === 'valid'
          ? { valid: true, reasons: [], method_match: true, template_match: 'exact' }
          : { valid: false, reasons: r, method_match: true, template_match: 'none' };
      },
    } as unknown as Parameters<typeof classifyLooseEnds>[0],
  };
}

describe('classifyLooseEnds', () => {
  it('puts every loose end in exactly one class, from a fact: category, engine reason or check_binding', async () => {
    const e = engine((c) =>
      c.includes('/ok.')
        ? 'valid'
        : c.includes('/same.')
          ? ['same_service']
          : ['same_service', 'template_mismatch'],
    );
    const items = [
      loose('t', { assessment: { category: 'test_or_tooling' } }),
      loose('n', { assessment: { category: 'not_a_call' } }),
      loose('x', { assessment: { category: 'external_call' } }),
      loose('d', { reason: 'dynamic_topic' }),
      loose('none', { consumerId: undefined as never, candidateRefs: [] }),
      loose('ok'),
      loose('same'),
      loose('mixed'),
      loose('h', { kind: 'inferred' }),
      loose('ht', { kind: 'inferred', assessment: { category: 'test_or_tooling' } }),
    ];
    const r = await classifyLooseEnds(e.adapter, items);
    expect(r.byKey).toEqual({
      t: 'test_or_tooling',
      n: 'outside',
      x: 'outside',
      d: 'dynamic',
      none: 'no_candidate',
      ok: 'fixable',
      same: 'internal',
      mixed: 'rejected',
      h: 'heuristic',
      ht: 'test_or_tooling',
    });
    expect(r.total).toBe(10);
    // Huecos reales en producto: lo arreglable, lo rechazado, sin candidato y dinámico.
    expect(r.gaps).toBe(4);
    expect(Object.fromEntries(r.classes.map((c) => [c.id, c.count]))).toMatchObject({
      fixable: 1,
      rejected: 1,
      no_candidate: 1,
      dynamic: 1,
      internal: 1,
      outside: 2,
      test_or_tooling: 2,
      heuristic: 1,
    });
  });

  it('only product-code sites with candidates cost a question to the engine', async () => {
    const e = engine(() => ['same_service']);
    await classifyLooseEnds(e.adapter, [
      loose('t', { assessment: { category: 'test_or_tooling' } }),
      loose('d', { reason: 'dynamic_target' }),
      loose('inf', { kind: 'inferred' }),
      loose('real'),
    ]);
    expect(e.checked).toEqual(['web:Function:src/real.ts:call:1']);
  });

  it('"internal" needs the engine to reject for same_service ONLY; any other reason makes it a rejection', async () => {
    const e = engine((c) =>
      c.includes('/a.') ? ['same_service'] : ['not_a_consumer', 'same_service'],
    );
    const r = await classifyLooseEnds(e.adapter, [loose('a'), loose('b')]);
    expect(r.byKey).toEqual({ a: 'internal', b: 'rejected' });
  });

  it('when the engine cannot be asked it says "not examined", not a guess', async () => {
    const r = await classifyLooseEnds(engine(() => 'throw').adapter, [loose('a')]);
    expect(r.byKey.a).toBe('unexamined');
    expect(r.gaps).toBe(0);
  });

  it('beyond the per-run limit the rest are "not examined" and cost nothing', async () => {
    const e = engine(() => ['same_service']);
    const items = Array.from({ length: 205 }, (_, i) => loose(`k${i}`));
    const r = await classifyLooseEnds(e.adapter, items);
    expect(e.checked).toHaveLength(200);
    expect(r.classes.find((c) => c.id === 'unexamined')?.count).toBe(5);
  });

  it('classes with nothing in them are not listed', async () => {
    const r = await classifyLooseEnds(engine(() => 'valid').adapter, [loose('ok')]);
    expect(r.classes.map((c) => c.id)).toEqual(['fixable']);
  });
});
