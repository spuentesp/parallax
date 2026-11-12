// El trazado de punta a punta. El motor y el modelo son falsos en el borde; el sembrado, el
// bucle, la verificación de saltos y la confirmación de enlaces son los reales.

import { describe, expect, it } from 'vitest';
import { createDispatcher } from '../src/agent/dispatcher.js';
import type { ChatCompleter } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { annotateRepos, toOrgGraph } from '../src/org-graph.js';
import { buildEndpointTopology } from '../src/topology.js';
import { SubmitTraceArgs, sanitizeTraceArgs, type TraceSeed } from '../src/trace/schema.js';
import { buildSeed } from '../src/trace/seed.js';
import {
  engineHops,
  finalize,
  SUBMIT_TRACE,
  seedBlock,
  traceEndToEnd,
} from '../src/trace/tracer.js';

const KEY = 'graphql:query:products';
const use = (path: string, line: number, kind: 'static' | 'heuristic' = 'static') => ({
  binding: { confidence: kind === 'static' ? 1 : 0.6, kind },
  endpoint: { key: KEY, service: 'api' },
  fields: ['id', 'name'],
  caller: { repo: 'web', path, line },
});
const topoEngine = {
  analyzerVersion: 't',
  apiVersion: '1' as const,
  listServices: async () => ({
    items: ['api', 'web'].map((s) => ({
      service: s,
      repo: s,
      endpoints: 1,
      consumer_services: 1,
      unresolved_inbound: 0,
      paths: [],
    })),
    scope: { configured_only: true, reviewed: [], unreviewed: [] },
  }),
  listContracts: async () => ({
    items: [
      {
        endpoint: { key: KEY, service: 'api' },
        has_schema: false,
        bound_consumers: 2,
        providers: [{ repo: 'api', path: 'schema.graphql', line: 447 }],
      },
    ],
    cursor: null,
  }),
  getService: async ({ service }: { service: string }) => ({
    consumers:
      service === 'api'
        ? [
            {
              service: 'web',
              repo: 'web',
              uses: [
                use('src/q.ts', 135),
                use('src/q.ts', 164),
                use('src/other.ts', 9, 'heuristic'),
              ],
            },
          ]
        : [],
  }),
} as unknown as LainAdapter;

describe('buildSeed — what the engine already knows about a contract', async () => {
  const graph = annotateRepos(
    toOrgGraph(await buildEndpointTopology(topoEngine)),
    new Set(['api', 'web']),
  );

  it('carries where it is defined and the client call sites with their uses, fields and provenance', () => {
    const seed = buildSeed(graph, KEY);
    expect(seed).toMatchObject({
      key: KEY,
      service: 'api',
      repo: 'api',
      providers: [{ repo: 'api', path: 'schema.graphql', line: 447 }],
    });
    expect(seed?.consumers).toHaveLength(1);
    expect(seed?.consumers[0]).toMatchObject({
      service: 'web',
      uses: 3,
      provenance: 'deterministic',
      fields: ['id', 'name'],
    });
    expect(seed?.consumers[0]?.sites.map((s) => `${s.path}:${s.line}`).sort()).toEqual([
      'src/other.ts:9',
      'src/q.ts:135',
      'src/q.ts:164',
    ]);
  });

  it('an unknown contract, or one that belongs to another service, is null — never a guess', () => {
    expect(buildSeed(graph, 'graphql:query:ghost')).toBeNull();
    expect(buildSeed(graph, KEY, 'web')).toBeNull();
  });
});

describe('sanitizeTraceArgs — liberal in what it accepts, strict in what it shows', () => {
  const hop = {
    id: 'h1',
    lane: 'domain',
    label: 'x',
    repo: 'r',
    path: 'a.py',
    line: 3,
    contains: 'checkout.save(update_fields=["note"])',
  };
  it('trims long text, takes the first identifier of `contains`, drops unknown keys, coerces numeric strings', () => {
    const out = sanitizeTraceArgs({
      summary: 's'.repeat(900),
      hops: [{ ...hop, line: '42', extra: 1 }],
      links: [],
      bogus: true,
    }) as { summary: string; hops: Array<Record<string, unknown>> };
    expect(out.summary).toHaveLength(600);
    expect(out.hops[0]).toMatchObject({ contains: 'checkout.save', line: 42 });
    expect(out.hops[0]).not.toHaveProperty('extra');
    expect(out).not.toHaveProperty('bogus');
    expect(SubmitTraceArgs.safeParse(out).success).toBe(true);
  });
  it('what still breaks the schema is still refused (a hop without a location, an unknown lane)', () => {
    expect(
      SubmitTraceArgs.safeParse(
        sanitizeTraceArgs({ summary: 's', hops: [{ ...hop, lane: 'nowhere' }], links: [] }),
      ).success,
    ).toBe(false);
    expect(
      SubmitTraceArgs.safeParse(
        sanitizeTraceArgs({
          summary: 's',
          hops: [{ id: 'h1', lane: 'domain', label: 'x' }],
          links: [],
        }),
      ).success,
    ).toBe(false);
  });
});

const seed: TraceSeed = {
  key: KEY,
  service: 'api',
  repo: 'api',
  providers: [{ repo: 'api', path: 'schema.graphql', line: 447 }],
  consumers: [
    {
      service: 'web',
      uses: 3,
      provenance: 'deterministic',
      fields: ['id'],
      sites: [
        { repo: 'web', path: 'src/q.ts', line: 135 },
        { repo: 'web', path: 'src/q.ts', line: 164 },
      ],
    },
  ],
};

describe("engineHops — the middle of the chain is the engine's", () => {
  it('the contract and up to three recorded call sites, with the reason they are trusted', () => {
    const h = engineHops(seed);
    expect(h.map((x) => [x.id, x.lane, x.origin, x.status])).toEqual([
      ['contract', 'contract', 'engine', 'verified'],
      ['call1', 'client_call', 'engine', 'verified'],
      ['call2', 'client_call', 'engine', 'verified'],
    ]);
    expect(h[1]?.reason).toMatch(/call site the engine recorded for graphql:query:products/);
  });
  it('a contract with no recorded definition is shown as unverifiable, not invented', () => {
    expect(engineHops({ ...seed, providers: [] })[0]?.status).toBe('unverifiable');
  });
  it('tells the model which ids the server adds, so it links to them instead of re-submitting', () => {
    expect(seedBlock(seed)).toMatch(
      /contract = api:schema\.graphql:447; call1 = web:src\/q\.ts:135; call2 = web:src\/q\.ts:164/,
    );
    expect(seedBlock({ ...seed, consumers: [] })).toMatch(/records NO client call sites/);
  });
});

function engine(
  opts: {
    code?: (a: { path: string }) => string;
    chain?: (a: { from: string; to: string }) => string;
  } = {},
) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const lain = {
    ...createLainMock(),
    getCodeSnippet: async (a: { path: string }) => ({
      text: opts.code
        ? opts.code(a)
        : `10: def ${a.path.split('/').pop()?.replace('.py', '')}() contains_here`,
    }),
    codeTool: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === 'get_call_chain')
        return { text: opts.chain ? opts.chain(args as never) : 'No call path found' };
      return { text: 'ok' };
    },
  } as unknown as LainAdapter;
  return { lain, calls };
}
const dispatcherFor = (lain: LainAdapter) => createDispatcher({ lain, view: 'live' });
const H = (over: Record<string, unknown>) => ({
  lane: 'domain',
  label: 'l',
  repo: 'orders',
  path: 'a/b.py',
  line: 10,
  contains: 'contains_here',
  ...over,
});
const submit = (hops: object[], links: object[] = [], extra: object = {}) =>
  SubmitTraceArgs.parse({ summary: 's', hops, links, ...extra });

describe('finalize — hops are read by the engine, links are confirmed only by engine facts', () => {
  it('every hop is read by the engine: a verified hop is in the chain; one the engine cannot find is set apart, with its reason, and the loss is recorded', async () => {
    const { lain } = engine({
      code: (a) =>
        a.path.includes('good') ? '10: contains_here' : 'Error: Not found: Path not found: /x',
    });
    const r = await finalize(
      submit(
        [
          H({ id: 'a', path: 'good.py' }),
          H({ id: 'b', path: 'ghost.py', label: 'the ghost handler' }),
        ],
        [{ from: 'a', to: 'b', relation: 'calls' }],
      ),
      seed,
      lain,
      dispatcherFor(lain),
    );
    expect(r.hops.find((h) => h.id === 'a')).toMatchObject({ status: 'verified', origin: 'model' });
    expect(r.hops.find((h) => h.id === 'b')).toBeUndefined();
    expect(r.rejected.map((h) => h.id)).toEqual(['b']);
    expect(r.rejected[0]?.reason).toMatch(/does not exist in the index/);
    // Sus enlaces no se muestran, y se anota dónde se pierde el rastro.
    expect(r.links.filter((l) => l.to === 'b' || l.from === 'b')).toHaveLength(0);
    expect(
      r.gaps.some((g) => /Towards the data.*the ghost handler.*trail is lost/.test(g.reason)),
    ).toBe(true);
  });

  it('a rejected hop on the client side is a gap on that side, and a sink that pointed at it is dropped (never a fake ending)', async () => {
    const { lain } = engine({
      code: (a) =>
        a.path.includes('ghost') ? 'Error: Not found: Path not found: /x' : '10: contains_here',
    });
    const r = await finalize(
      submit(
        [H({ id: 'x', lane: 'client_logic', path: 'ghost.ts' })],
        [{ from: 'call1', to: 'x', relation: 'passes' }],
        { sink: { hop: 'x', kind: 'rendered' } },
      ),
      seed,
      lain,
      dispatcherFor(lain),
    );
    expect(r.sink).toBeNull();
    expect(r.complete).toBe(false);
    expect(
      r.gaps.some(
        (g) => g.after.startsWith('call') && /Towards where the value ends/.test(g.reason),
      ),
    ).toBe(true);
  });

  it('a model hop that duplicates the contract or an engine call site is the SAME hop: merged, links and sink remapped', async () => {
    const { lain } = engine();
    const r = await finalize(
      submit(
        [
          H({ id: 'h1', lane: 'api_handler' }),
          H({ id: 'hc', lane: 'contract', repo: 'api', path: 'schema.graphql', line: 447 }),
          H({ id: 'hx', lane: 'client_call', repo: 'web', path: 'src/q.ts', line: 136 }),
          H({ id: 'h2', lane: 'sink', repo: 'web', path: 'src/ui.ts' }),
        ],
        [
          { from: 'h1', to: 'hc', relation: 'serves' },
          { from: 'hx', to: 'h2', relation: 'renders' },
        ],
        { sink: { hop: 'hx', kind: 'rendered' }, gaps: [{ after: 'hc', reason: 'orm' }] },
      ),
      seed,
      lain,
      dispatcherFor(lain),
    );
    expect(r.hops.filter((h) => h.lane === 'contract')).toHaveLength(1);
    expect(r.hops.filter((h) => h.lane === 'client_call').map((h) => h.id)).toEqual([
      'call1',
      'call2',
    ]);
    expect(r.links.find((l) => l.relation === 'serves')).toMatchObject({
      from: 'h1',
      to: 'contract',
    });
    expect(r.links.find((l) => l.relation === 'renders')).toMatchObject({
      from: 'call1',
      to: 'h2',
    });
    expect(r.sink?.hop).toBe('call1');
    expect(r.gaps[0]?.after).toBe('contract');
  });

  it('placeholder hops ("N/A", "not found") are dropped: a missing link is a gap, never a hop', async () => {
    const { lain } = engine();
    const r = await finalize(
      submit(
        [
          H({ id: 'a' }),
          H({ id: 'b', path: 'N/A' }),
          H({ id: 'c', label: 'Client call site - NOT FOUND' }),
          H({ id: 'd', repo: 'unknown' }),
        ],
        [{ from: 'a', to: 'b', relation: 'calls' }],
      ),
      seed,
      lain,
      dispatcherFor(lain),
    );
    expect(r.hops.filter((h) => h.origin === 'model').map((h) => h.id)).toEqual(['a']);
    expect(r.links.filter((l) => l.to === 'b')).toHaveLength(0);
  });

  describe('link basis (the trust line)', () => {
    const modelLink = (
      r: { links: Array<{ from: string; to: string; basis: string; because: string }> },
      from: string,
    ) => r.links.find((l) => l.from === from);
    const two = [
      H({ id: 'a', contains: 'perform_mutation' }),
      H({ id: 'b', contains: 'change_address', path: 'a/c.py' }),
    ];
    const code = () => '10: perform_mutation change_address contains_here';
    it('"calls" is ENGINE-confirmed when the call graph has the chain, and says why', async () => {
      const { lain, calls } = engine({
        code,
        chain: () =>
          '## Call Chain: perform_mutation -> change_address\n\nperform_mutation → change_address',
      });
      const r = await finalize(
        submit(two, [{ from: 'a', to: 'b', relation: 'calls' }]),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(modelLink(r, 'a')).toMatchObject({
        basis: 'engine',
        because: expect.stringMatching(/call graph has a call path/),
      });
      expect(calls.find((c) => c.tool === 'get_call_chain')?.args).toMatchObject({
        from: 'perform_mutation',
        to: 'change_address',
        repo_id: 'orders',
      });
    });
    it('no chain found is "not_found", explicitly NOT a contradiction (the graph cannot see dynamic dispatch)', async () => {
      const { lain } = engine({
        code,
        chain: () => "No call path found from 'a' to 'b' in this repository.",
      });
      const r = await finalize(
        submit(two, [{ from: 'a', to: 'b', relation: 'calls' }]),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(r.links.find((l) => l.from === 'a')).toMatchObject({ basis: 'not_found' });
      expect(r.links.find((l) => l.from === 'a')?.because).toMatch(/not a contradiction/);
    });
    it('every other relation is only ASSERTED by the model, and nothing is checked for it', async () => {
      const { lain, calls } = engine({ code });
      const r = await finalize(
        submit(two, [
          { from: 'a', to: 'b', relation: 'reads' },
          { from: 'b', to: 'a', relation: 'returns' },
        ]),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(r.links.filter((l) => l.from !== 'contract').map((l) => l.basis)).toEqual([
        'asserted',
        'asserted',
      ]);
      expect(calls.filter((c) => c.tool === 'get_call_chain')).toHaveLength(0);
    });
    it('hops in different repos are not asked to the call graph (it is per repository)', async () => {
      const { lain, calls } = engine({ chain: () => '## Call Chain: x' });
      const r = await finalize(
        submit(
          [H({ id: 'a', repo: 'orders' }), H({ id: 'b', repo: 'billing', path: 'z.py' })],
          [{ from: 'a', to: 'b', relation: 'calls' }],
        ),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(modelLink(r, 'a')?.basis).toBe('asserted');
      expect(calls).toHaveLength(0);
    });
    it("the model cannot borrow the engine's call-site fact for its OWN link to a call site", async () => {
      const { lain } = engine();
      const r = await finalize(
        submit(
          [H({ id: 'hook', lane: 'client_logic', repo: 'web', path: 'src/hook.ts' })],
          [{ from: 'call1', to: 'hook', relation: 'calls' }],
        ),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(r.links.find((l) => l.to === 'hook')?.basis).toBe('asserted');
    });
    it('the server adds contract → call site as an ENGINE fact, once, even if the model also submitted it', async () => {
      const { lain } = engine();
      const r = await finalize(
        submit([H({ id: 'a' })], [{ from: 'contract', to: 'call1', relation: 'consumes' }]),
        seed,
        lain,
        dispatcherFor(lain),
      );
      const consumes = r.links.filter((l) => l.from === 'contract' && l.to === 'call1');
      expect(consumes).toHaveLength(1);
      expect(consumes[0]).toMatchObject({ basis: 'engine' });
    });
    it('a link to a hop that does not exist is not shown; duplicates collapse', async () => {
      const { lain } = engine({ code });
      const r = await finalize(
        submit(two, [
          { from: 'a', to: 'ghost', relation: 'calls' },
          { from: 'a', to: 'b', relation: 'reads' },
          { from: 'a', to: 'b', relation: 'reads' },
        ]),
        seed,
        lain,
        dispatcherFor(lain),
      );
      expect(r.links.filter((l) => l.from === 'a')).toHaveLength(1);
    });
  });

  it('"complete" needs a sink the model actually reached', async () => {
    const { lain } = engine();
    const base = [H({ id: 'a' }), H({ id: 'z', lane: 'sink' })];
    expect(
      (
        await finalize(
          submit(base, [], { sink: { hop: 'z', kind: 'rendered' } }),
          seed,
          lain,
          dispatcherFor(lain),
        )
      ).complete,
    ).toBe(true);
    expect(
      (
        await finalize(
          submit(base, [], { sink: { hop: 'z', kind: 'unknown' } }),
          seed,
          lain,
          dispatcherFor(lain),
        )
      ).complete,
    ).toBe(false);
    expect((await finalize(submit(base), seed, lain, dispatcherFor(lain))).complete).toBe(false);
  });
});

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const resp = (toolCalls: ToolCall[], content: string | null = null): NemotronResponse => ({
  content,
  toolCalls,
  finishReason: 'tool_calls',
  usage: { promptTokens: 100, completionTokens: 10 },
  model: 'f',
  latencyMs: 1,
});
class Script implements ChatCompleter {
  readonly seen: Array<{ messages: ChatMessage[]; toolChoice: unknown; parallel?: boolean }> = [];
  n = 0;
  constructor(private readonly f: (n: number, toolChoice: unknown) => NemotronResponse) {}
  async complete(
    messages: ChatMessage[],
    o?: { toolChoice?: unknown; parallelToolCalls?: boolean },
  ) {
    this.seen.push({
      messages: structuredClone(messages),
      toolChoice: o?.toolChoice,
      ...(o?.parallelToolCalls !== undefined ? { parallel: o.parallelToolCalls } : {}),
    });
    return this.f(this.n++, o?.toolChoice);
  }
}
const goodSubmit = (id = 's') =>
  call(id, SUBMIT_TRACE, {
    summary: 'done',
    hops: [H({ id: 'a', lane: 'api_handler', contains: 'contains_here' })],
    links: [{ from: 'a', to: 'contract', relation: 'serves' }],
    sink: { hop: 'a', kind: 'returned' },
  });

describe('traceEndToEnd — the loop', () => {
  it('reads, then submits; the result carries what it cost and what the engine confirmed', async () => {
    const { lain } = engine();
    const events: string[] = [];
    const model = new Script((n) =>
      n === 0 ? resp([call('r', 'search_code', { query: 'products' })]) : resp([goodSubmit()]),
    );
    const r = await traceEndToEnd({ seed, lain, model, onProgress: (e) => events.push(e.type) });
    expect(r.status).toBe('available');
    expect(r.hops.map((h) => h.id).sort()).toEqual(['a', 'call1', 'call2', 'contract']);
    expect(r.usage).toMatchObject({ modelCalls: 2, toolCalls: 1, promptTokens: 200 });
    expect(events).toEqual(['round', 'tool', 'round', 'verify']);
    expect(r.seed).toEqual({ key: KEY, service: 'api' });
  });

  it('is told the contract, its provider and the call sites up front', async () => {
    const { lain } = engine();
    const model = new Script(() => resp([goodSubmit()]));
    await traceEndToEnd({ seed, lain, model });
    const user = model.seen[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toMatch(/Contract: graphql:query:products/);
    expect(user).toMatch(/defined at: api:schema\.graphql:447/);
    expect(user).toMatch(/web: 3 uses \(deterministic\)/);
    const system = model.seen[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toMatch(/Never create a placeholder hop/);
    expect(system).toMatch(/model class/i);
  });

  it('a model that never stops reading is forced to deliver, with ONE call at a time', async () => {
    const { lain } = engine();
    const model = new Script((n, tc) =>
      tc && typeof tc === 'object'
        ? resp([goodSubmit()])
        : resp([call(`c${n}`, 'search_code', { query: `q${n}` })]),
    );
    const r = await traceEndToEnd({
      seed,
      lain,
      model,
      budget: { maxToolCalls: 4, maxModelMs: 60_000 },
    });
    expect(r.status).toBe('available');
    const forced = model.seen.filter((s) => s.toolChoice && typeof s.toolChoice === 'object');
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.every((s) => s.parallel === false)).toBe(true);
  });

  it('a reply with hundreds of calls is cut to a few, and the history stays small', async () => {
    const { lain } = engine();
    const model = new Script((n) =>
      n === 0
        ? resp(
            Array.from({ length: 200 }, (_, i) => call(`c${i}`, 'search_code', { query: `q${i}` })),
          )
        : resp([goodSubmit()]),
    );
    const r = await traceEndToEnd({ seed, lain, model });
    expect(
      r.errors.some((e) => /200 tool calls in one reply; only the first 8 were kept/.test(e)),
    ).toBe(true);
    expect(Math.max(...model.seen.map((s) => s.messages.length))).toBeLessThan(40);
  });

  it('an invalid submission is explained to the model and retried; three bad ones end as failed:invalid_trace', async () => {
    const { lain } = engine();
    const bad = call('b', SUBMIT_TRACE, {
      summary: 's',
      hops: [{ id: 'a', lane: 'nowhere' }],
      links: [],
    });
    const model = new Script(() => resp([bad]));
    const r = await traceEndToEnd({ seed, lain, model });
    expect(r.status).toBe('failed:invalid_trace');
    expect(r.errors[0]).toMatch(/invalid submit_trace/);
    expect(model.seen).toHaveLength(3);
    // El mensaje de la segunda ronda le dice qué estaba mal.
    const tool = model.seen[1]?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    expect(tool).toMatch(/invalid_schema/);
  });

  it('a first invalid submission followed by a good one succeeds', async () => {
    const { lain } = engine();
    const model = new Script((n) =>
      resp([
        n === 0 ? call('b', SUBMIT_TRACE, { summary: 's', hops: [], links: [] }) : goodSubmit(),
      ]),
    );
    expect((await traceEndToEnd({ seed, lain, model })).status).toBe('available');
  });

  it('prose without a submission is asked once to deliver, then is a failure — never an invented trace', async () => {
    const { lain } = engine();
    const model = new Script(() =>
      resp([], 'I think the value flows from the database to the UI.'),
    );
    const r = await traceEndToEnd({ seed, lain, model });
    expect(r.status).toBe('failed:no_trace');
    expect(r.hops).toEqual([]);
    expect(model.seen).toHaveLength(2);
  });

  it('a model failure is reported, with what was measured', async () => {
    const { lain } = engine();
    const model: ChatCompleter = {
      complete: async () => {
        throw new Error('rate limited');
      },
    };
    const r = await traceEndToEnd({ seed, lain, model });
    expect(r.status).toBe('failed:model_error');
    expect(r.errors).toContain('rate limited');
  });

  it('the trace has its own, larger caps (a cross-repo trace needs more searches than a question)', async () => {
    const { lain } = engine();
    let searches = 0;
    const model = new Script((n) => {
      if (n < 7) {
        searches++;
        return resp([call(`c${n}`, 'search_code', { query: `q${n}` })]);
      }
      return resp([goodSubmit()]);
    });
    const r = await traceEndToEnd({ seed, lain, model });
    expect(searches).toBe(7);
    expect(r.usage.toolCalls).toBe(7); // el tope normal de search_code es 4
  });

  it('a trace submitted without reading anything is sent back once, then accepted if the model insists', async () => {
    const { lain } = engine();
    const model = new Script(() => resp([goodSubmit()]));
    const r = await traceEndToEnd({ seed, lain, model });
    expect(r.status).toBe('available');
    expect(model.seen).toHaveLength(2);
    const tool = model.seen[1]?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    expect(tool).toMatch(/no_evidence/);
    expect(tool).toMatch(/from memory are not evidence/);
  });

  it("hops the engine could not find are handed back WITH the engine's reasons, once, and the corrected trace is what comes out", async () => {
    const { lain } = engine({
      code: (a) =>
        a.path.endsWith('ghost.py') ? 'Error: Not found: Path not found: /x' : '10: contains_here',
    });
    const bad = call('s1', SUBMIT_TRACE, {
      summary: 'first',
      hops: [H({ id: 'ok1', path: 'real.py' }), H({ id: 'bad1', path: 'ghost.py' })],
      links: [],
    });
    const fixed = call('s2', SUBMIT_TRACE, {
      summary: 'second',
      hops: [H({ id: 'ok1', path: 'real.py' }), H({ id: 'fix1', path: 'real2.py' })],
      links: [],
    });
    const model = new Script((n) =>
      n === 0
        ? resp([call('r', 'search_code', { query: 'x' })])
        : n === 1
          ? resp([bad])
          : resp([fixed]),
    );
    const events: string[] = [];
    const r = await traceEndToEnd({ seed, lain, model, onProgress: (e) => events.push(e.type) });
    expect(r.status).toBe('available');
    expect(r.summary).toBe('second');
    expect(
      r.hops
        .filter((h) => h.origin === 'model')
        .map((h) => h.id)
        .sort(),
    ).toEqual(['fix1', 'ok1']);
    expect(r.hops.every((h) => h.status !== 'contradicted')).toBe(true);
    expect(r.rejected).toEqual([]);
    const feedback = JSON.parse(
      model.seen[2]?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '{}',
    ) as { error: { code: string; message: string } };
    expect(feedback.error.code).toBe('hops_not_found');
    expect(feedback.error.message).toMatch(/bad1 \(orders:ghost\.py:10, "contains_here"\)/);
    expect(feedback.error.message).toMatch(/does not exist in the index/);
    expect(r.errors).toContain('repair requested for 1 hop(s)');
  });

  it('the repair is offered ONCE: if the hop is still wrong the trace is returned with it flagged, never looped', async () => {
    const { lain } = engine({
      code: (a) =>
        a.path.endsWith('ghost.py') ? 'Error: Not found: Path not found: /x' : '10: contains_here',
    });
    const stillBad = call('s', SUBMIT_TRACE, {
      summary: 'x',
      hops: [H({ id: 'bad1', path: 'ghost.py' })],
      links: [],
    });
    const model = new Script((n) =>
      n === 0 ? resp([call('r', 'search_code', { query: 'x' })]) : resp([stillBad]),
    );
    const r = await traceEndToEnd({ seed, lain, model });
    expect(model.seen).toHaveLength(3); // lectura, entrega, entrega corregida
    // Lo que sigue sin encontrarse NO está en el recorrido: se aparta, con su razón.
    expect(r.hops.find((h) => h.id === 'bad1')).toBeUndefined();
    expect(r.rejected.map((h) => h.id)).toEqual(['bad1']);
    expect(r.status).toBe('available');
  });
});
