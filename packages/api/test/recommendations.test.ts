import { describe, expect, it } from 'vitest';
import { parseBindingEntry } from '../src/recommendations/binding-entry.js';
import type { LooseEndInput } from '../src/recommendations/collect.js';
import {
  parseJsonArray,
  parsePicks,
  parseRationales,
  type RecommendModel,
} from '../src/recommendations/explain.js';
import { buildRecommendations } from '../src/recommendations/service.js';

// La entrada literal que emitió `check_binding` de LAIN 0.15.0 (cluster A).
const ENTRY = `- consumer:
    repo: nemoclaw
    path: agents/hermes/host/tool-gateway-broker.ts
    symbol: POST /
    key: http:POST /
    site: nemoclaw:HttpClientCall:agents/hermes/host/tool-gateway-broker.ts:POST /:88
  provider:
    service: openshell
    key: http:ANY /
`;

describe('parseBindingEntry', () => {
  it('reads the real entry into the declaration the remediation accepts', () => {
    expect(parseBindingEntry(ENTRY)).toEqual({
      consumer: {
        repo: 'nemoclaw',
        path: 'agents/hermes/host/tool-gateway-broker.ts',
        symbol: 'POST /',
        key: 'http:POST /',
        site: 'nemoclaw:HttpClientCall:agents/hermes/host/tool-gateway-broker.ts:POST /:88',
      },
      provider: { service: 'openshell', key: 'http:ANY /' },
    });
  });
  it('does not guess: an unknown key, a missing field or a broken quote yields nothing', () => {
    expect(parseBindingEntry(ENTRY.replace('symbol: POST /', 'weird: 1'))).toBeNull();
    expect(parseBindingEntry(ENTRY.replace(/ {4}repo: nemoclaw\n/, ''))).toBeNull();
    expect(
      parseBindingEntry(ENTRY.replace('service: openshell', "service: 'openshell")),
    ).toBeNull();
    expect(parseBindingEntry('not yaml at all')).toBeNull();
    expect(parseBindingEntry('')).toBeNull();
  });
  it('unquotes YAML-quoted values', () => {
    const q = ENTRY.replace('symbol: POST /', `symbol: 'POST /it''s'`);
    expect(parseBindingEntry(q)?.consumer.symbol).toBe("POST /it's");
  });
});

describe('model output is read strictly', () => {
  const ids = new Set(['a', 'b']);
  it('extracts a JSON array from prose or code fences', () => {
    expect(parseJsonArray('Sure!\n```json\n[{"id":"a"}]\n```')).toEqual([{ id: 'a' }]);
    expect(parseJsonArray('no array here')).toBeNull();
    expect(parseJsonArray('[broken')).toBeNull();
  });
  it('keeps only rationales for known ids, collapses whitespace and caps the length', () => {
    const long = 'x'.repeat(400);
    const r = parseRationales(
      JSON.stringify([
        { id: 'a', rationale: '  Calls   the\ngateway.  ' },
        { id: 'zzz', rationale: 'unknown id' },
        { id: 'b', rationale: long },
        { id: 'a2', rationale: '' },
      ]),
      ids,
    );
    expect(r.get('a')).toBe('Calls the gateway.');
    expect(r.has('zzz')).toBe(false);
    expect((r.get('b') ?? '').length).toBeLessThanOrEqual(240);
  });
  it('a pick must be an integer index within the candidates, otherwise it is dropped', () => {
    const sizes = new Map([['a', 3]]);
    const text = (choice: unknown) => JSON.stringify([{ id: 'a', choice }]);
    expect(parsePicks(text(2), sizes).get('a')).toBe(2);
    for (const bad of [3, -1, 1.5, '1', null])
      expect(parsePicks(text(bad), sizes).has('a')).toBe(false);
  });
});

// ── el flujo completo con un motor y un modelo de mentira (los bordes del proceso) ──
const loose = (over: Partial<LooseEndInput> & { key: string }): LooseEndInput => ({
  kind: 'unresolved',
  repo: 'web',
  path: `src/${over.key}.ts`,
  line: 10,
  reason: 'no_match',
  detail: {},
  candidates: [],
  candidateCount: 2,
  consumerId: `web:Function:src/${over.key}.ts:call:10`,
  candidateRefs: [
    { key: 'http:POST /a', service: 'api', reason: 'pattern' },
    { key: 'http:POST /b', service: 'api', reason: 'pattern' },
  ],
  assessment: null,
  ...over,
});

const entryFor = (consumer: string, key: string, service: string) => `- consumer:
    repo: web
    path: ${consumer}
    symbol: ${key}
    key: ${key}
  provider:
    service: ${service}
    key: ${key}
`;

function engine(accept: (consumer: string, key: string) => boolean) {
  const checks: Array<{ consumer: string; key: string }> = [];
  return {
    checks,
    adapter: {
      checkBinding: async (req: {
        consumer: string;
        endpoint: { key: string; service: string };
      }) => {
        checks.push({ consumer: req.consumer, key: req.endpoint.key });
        const valid = accept(req.consumer, req.endpoint.key);
        return {
          valid,
          reasons: valid ? [] : ['template_mismatch'],
          method_match: true,
          template_match: valid ? 'exact' : 'none',
          ...(valid
            ? { bindings_entry: entryFor('src/x.ts', req.endpoint.key, req.endpoint.service) }
            : {}),
        };
      },
      getCodeSnippet: async () => ({ text: 'await fetch(gatewayUrl)' }),
    } as unknown as Parameters<typeof buildRecommendations>[0]['adapter'],
  };
}

const fakeModel = (reply: (user: string) => string): RecommendModel & { calls: string[] } => {
  const calls: string[] = [];
  return {
    name: 'fake',
    calls,
    complete: async (messages) => {
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      calls.push(user);
      return { content: reply(user) };
    },
  };
};

describe('buildRecommendations', () => {
  it('recommends only what the engine accepts, and only when exactly one candidate passes', async () => {
    const e = engine((_c, key) => key === 'http:POST /a');
    const r = await buildRecommendations({
      adapter: e.adapter,
      items: [loose({ key: 'one' })],
      model: null,
      modelAllowed: true,
    });
    expect(r.recommendations).toHaveLength(1);
    const rec = r.recommendations[0];
    expect(rec).toMatchObject({
      kind: 'binding',
      basis: 'engine_verified',
      modelPicked: false,
      rationale: null,
    });
    expect(rec?.basisDetail).toMatch(/only candidate that passes/);
    // Sin modelo lo dice, en vez de ocultarlo.
    expect(r.model).toEqual({
      used: false,
      name: null,
      note: expect.stringMatching(/No model is configured/),
    });
  });

  it('skips tests, tooling and sites the engine rejects, and counts why', async () => {
    const e = engine(() => false);
    const r = await buildRecommendations({
      adapter: e.adapter,
      items: [
        loose({ key: 'a', assessment: { category: 'test_or_tooling' } }),
        { ...loose({ key: 'b' }), consumerId: undefined as never },
        loose({ key: 'c' }),
      ],
      model: null,
      modelAllowed: true,
    });
    expect(r.recommendations).toEqual([]);
    const why = Object.fromEntries(r.skipped.map((s) => [s.reason, s.count]));
    expect(why['test, tooling or not a real call']).toBe(1);
    expect(why['the engine offered no candidate endpoint']).toBe(1);
    expect(why['the engine rejects every candidate']).toBe(1);
    // Un test no cuesta ni una pregunta al motor.
    expect(e.checks.every((c) => c.consumer.includes('/c.ts'))).toBe(true);
  });

  it('several candidates pass: without a model nothing is invented; with one it chooses ONLY among them', async () => {
    const accept = () => true;
    const noModel = await buildRecommendations({
      adapter: engine(accept).adapter,
      items: [loose({ key: 'multi' })],
      model: null,
      modelAllowed: true,
    });
    expect(noModel.recommendations).toEqual([]);
    expect(noModel.skipped.find((s) => s.reason.startsWith('several candidates pass'))?.count).toBe(
      1,
    );

    const model = fakeModel((user) =>
      user.includes('choice')
        ? JSON.stringify([{ id: 'multi', choice: 1 }])
        : JSON.stringify([{ id: 'x', rationale: 'ignored' }]),
    );
    const withModel = await buildRecommendations({
      adapter: engine(accept).adapter,
      items: [loose({ key: 'multi' })],
      model,
      modelAllowed: true,
    });
    expect(withModel.recommendations).toHaveLength(1);
    const rec = withModel.recommendations[0];
    expect(rec).toMatchObject({ modelPicked: true, basis: 'engine_verified' });
    expect(rec?.declaration).toMatchObject({ provider: { key: 'http:POST /b' } });
    expect(rec?.alternatives).toEqual([{ key: 'http:POST /a', service: 'api' }]);
    expect(rec?.basisDetail).toMatch(/the assistant picked this one/);
  });

  it('a model pick outside the engine-valid candidates is discarded, never applied', async () => {
    const model = fakeModel(() => JSON.stringify([{ id: 'multi', choice: 9 }]));
    const r = await buildRecommendations({
      adapter: engine(() => true).adapter,
      items: [loose({ key: 'multi' })],
      model,
      modelAllowed: true,
    });
    expect(r.recommendations).toEqual([]);
  });

  it('the model explains a recommendation, labelled as its reading; garbage output leaves it empty', async () => {
    // el id es el de la recomendación: se toma de la primera respuesta
    const first = await buildRecommendations({
      adapter: engine((_c, k) => k === 'http:POST /a').adapter,
      items: [loose({ key: 'one' })],
      model: null,
      modelAllowed: true,
    });
    const id = first.recommendations[0]?.id as string;
    const model = fakeModel(() => JSON.stringify([{ id, rationale: 'It posts to the gateway.' }]));
    const r = await buildRecommendations({
      adapter: engine((_c, k) => k === 'http:POST /a').adapter,
      items: [loose({ key: 'one' })],
      model,
      modelAllowed: true,
    });
    expect(r.recommendations[0]?.rationale).toBe('It posts to the gateway.');
    expect(r.model).toMatchObject({ used: true, name: 'fake', note: null });

    const junk = fakeModel(() => 'I cannot help with that');
    const r2 = await buildRecommendations({
      adapter: engine((_c, k) => k === 'http:POST /a').adapter,
      items: [loose({ key: 'one' })],
      model: junk,
      modelAllowed: true,
    });
    expect(r2.recommendations).toHaveLength(1);
    expect(r2.recommendations[0]?.rationale).toBeNull();
  });

  it('when the model fails, the engine-checked recommendations are still returned, with the reason', async () => {
    const broken: RecommendModel = {
      name: 'fake',
      complete: async () => {
        throw new Error('timeout');
      },
    };
    const r = await buildRecommendations({
      adapter: engine((_c, k) => k === 'http:POST /a').adapter,
      items: [loose({ key: 'one' })],
      model: broken,
      modelAllowed: true,
    });
    expect(r.recommendations).toHaveLength(1);
    expect(r.model.used).toBe(false);
    expect(r.model.note).toMatch(/could not be reached \(timeout\)/);
  });

  it('out of model budget: no model call at all, and it says so', async () => {
    const model = fakeModel(() => '[]');
    const r = await buildRecommendations({
      adapter: engine((_c, k) => k === 'http:POST /a').adapter,
      items: [loose({ key: 'one' })],
      model,
      modelAllowed: false,
    });
    expect(model.calls).toHaveLength(0);
    expect(r.recommendations).toHaveLength(1);
    expect(r.model.note).toMatch(/limit for this hour/);
  });
});
