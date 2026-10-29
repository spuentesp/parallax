// Una investigación no puede dar vueltas sin rumbo: no repite la misma llamada,
// no martillea una herramienta, cierra cuando se acaba el presupuesto y dice lo
// que costó. El motor es el mock; el modelo, guionizado.

import { describe, expect, it } from 'vitest';
import { createDispatcher, PER_TOOL_CAP } from '../src/agent/dispatcher.js';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const resp = (
  toolCalls: ToolCall[],
  usage = { promptTokens: 1000, completionTokens: 50 },
): NemotronResponse => ({
  content: null,
  toolCalls,
  finishReason: 'tool_calls',
  usage,
  model: 'fake',
  latencyMs: 1,
});

describe('dispatcher — no repeating, no hammering', () => {
  it('the same call twice is refused the second time, without touching the engine or the budget', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxToolCalls: 5 });
    const first = await d.execute(call('a', 'search_code', { query: 'checkout' }));
    const again = await d.execute(call('b', 'search_code', { query: 'checkout' }));
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: false, code: 'duplicate_call' });
    expect(d.budgetUse().toolCallsUsed).toBe(1);
  });

  it('argument order does not hide a repeat', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    await d.execute(call('a', 'search_code', { query: 'x', limit: 5 }));
    const again = await d.execute(call('b', 'search_code', { limit: 5, query: 'x' }));
    expect(again).toMatchObject({ ok: false, code: 'duplicate_call' });
  });

  it('a tool has a cap: the next call is refused and the message says what to do instead', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxToolCalls: 30 });
    const cap = PER_TOOL_CAP.search_code as number;
    for (let i = 0; i < cap; i++) {
      expect((await d.execute(call(`c${i}`, 'search_code', { query: `q${i}` }))).ok).toBe(true);
    }
    const over = await d.execute(call('over', 'search_code', { query: 'one more' }));
    expect(over).toMatchObject({ ok: false, code: 'tool_cap' });
    expect((over as { message: string }).message).toMatch(
      /try a different tool, or call submit_answer/,
    );
    // Otras herramientas siguen disponibles.
    expect((await d.execute(call('o', 'find_symbol', { name: 'main' }))).ok).toBe(true);
  });
});

class Recording implements ChatCompleter {
  readonly seen: Array<{ messages: ChatMessage[]; toolChoice: unknown; parallel?: boolean }> = [];
  private n = 0;
  constructor(private readonly reply: (n: number, toolChoice: unknown) => NemotronResponse) {}
  async complete(
    messages: ChatMessage[],
    opts?: { toolChoice?: unknown; parallelToolCalls?: boolean },
  ): Promise<NemotronResponse> {
    this.seen.push({
      messages: structuredClone(messages),
      toolChoice: opts?.toolChoice,
      ...(opts?.parallelToolCalls !== undefined ? { parallel: opts.parallelToolCalls } : {}),
    });
    return this.reply(this.n++, opts?.toolChoice);
  }
}

describe('investigate — the loop converges', () => {
  const MAX = 6;
  // Un modelo que nunca deja de buscar: cada ronda, una consulta nueva.
  const endless = (n: number, toolChoice: unknown): NemotronResponse =>
    toolChoice && typeof toolChoice === 'object'
      ? resp([call(`s${n}`, 'submit_answer', { answer: 'Here is what I found.', claims: [] })])
      : resp([call(`c${n}`, 'search_code', { query: `try ${n}` })]);

  async function run() {
    const model = new Recording(endless);
    const result = await investigate({
      question: 'where is X?',
      lain: createLainMock(),
      model,
      view: 'live',
      budget: { maxToolCalls: MAX, maxModelMs: 60_000 },
    });
    return { model, result };
  }

  it('asks it to wrap up once, at 60% of the tool budget', async () => {
    const { model } = await run();
    const nudges = model.seen
      .flatMap((s) => s.messages)
      .filter(
        (m) => m.role === 'user' && /tool calls\. Unless one specific fact/.test(m.content ?? ''),
      );
    // El mensaje se arrastra en el historial de las rondas siguientes: es el MISMO, una vez.
    expect(new Set(nudges.map((m) => m.content)).size).toBe(1);
    expect(nudges[0]?.content).toContain(`of ${MAX} tool calls`);
  });

  it('forces the delivery on the last allowed read: the model no longer chooses', async () => {
    const { model, result } = await run();
    const forced = model.seen.filter((s) => s.toolChoice && typeof s.toolChoice === 'object');
    expect(forced.length).toBeGreaterThan(0);
    expect(forced[0]?.toolChoice).toEqual({
      type: 'function',
      function: { name: 'submit_answer' },
    });
    // Nunca se forzó antes de gastar casi todo el presupuesto.
    const firstForcedAt = model.seen.findIndex(
      (s) => s.toolChoice && typeof s.toolChoice === 'object',
    );
    expect(firstForcedAt).toBeGreaterThanOrEqual(MAX - 1);
    // Y terminó con una respuesta, no agotando el presupuesto.
    expect(result.answer).toBe('Here is what I found.');
    expect(result.budget.toolCallsUsed).toBeLessThanOrEqual(MAX);
  });

  it('reports the tokens of every round, input and output', async () => {
    const { model, result } = await run();
    expect(result.budget.promptTokens).toBe(model.seen.length * 1000);
    expect(result.budget.completionTokens).toBe(model.seen.length * 50);
    expect(result.budget.rounds).toBeGreaterThan(0);
  });

  it('an explicit tool choice from the caller is respected (not overridden)', async () => {
    const model = new Recording(() => resp([call('x', 'list_services', {})]));
    await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      toolChoice: 'none',
      budget: { maxToolCalls: 2, maxModelMs: 10_000 },
    }).catch(() => undefined);
    expect(model.seen.every((s) => s.toolChoice === 'none')).toBe(true);
  });

  it('forcing the delivery asks the server for ONE call (parallel off); normal rounds do not', async () => {
    const { model } = await run();
    const forced = model.seen.filter((s) => s.toolChoice && typeof s.toolChoice === 'object');
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.every((s) => s.parallel === false)).toBe(true);
    expect(
      model.seen
        .filter((s) => !s.toolChoice || typeof s.toolChoice === 'string')
        .every((s) => s.parallel === undefined),
    ).toBe(true);
  });

  it('a reply with hundreds of tool calls is a degenerate repetition: only the first few are kept, and the history stays small', async () => {
    // Lo que se observó de verdad: al forzar la entrega, 256–280 submit_answer en una respuesta.
    const flood = (n: number, toolChoice: unknown): NemotronResponse =>
      toolChoice && typeof toolChoice === 'object'
        ? resp(
            Array.from({ length: 280 }, (_, i) =>
              call(`s${n}_${i}`, 'submit_answer', { answer: 'Done here.', claims: [] }),
            ),
          )
        : resp([call(`c${n}`, 'search_code', { query: `try ${n}` })]);
    const model = new Recording(flood);
    const result = await investigate({
      question: 'where is X?',
      lain: createLainMock(),
      model,
      view: 'live',
      budget: { maxToolCalls: 4, maxModelMs: 60_000 },
    });
    expect(result.answer).toBe('Done here.');
    expect(
      result.errors.some((e) => /280 tool calls in one reply; only the first 1 were kept/.test(e)),
    ).toBe(true);
    // Ninguna ronda posterior arrastra cientos de mensajes de herramienta.
    const biggest = Math.max(...model.seen.map((s) => s.messages.length));
    expect(biggest).toBeLessThan(40);
  });

  it('an ordinary round also has a ceiling on calls (8), the rest are dropped', async () => {
    const many = (n: number): NemotronResponse =>
      n === 0
        ? resp(
            Array.from({ length: 30 }, (_, i) => call(`m${i}`, 'search_code', { query: `q${i}` })),
          )
        : resp([call('s', 'submit_answer', { answer: 'ok', claims: [] })]);
    const model = new Recording((n) => many(n));
    const result = await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      budget: { maxToolCalls: 20, maxModelMs: 60_000 },
    });
    // Tope por herramienta: de las 8 aceptadas, sólo 4 se ejecutan; el resto se rechaza.
    expect(result.toolCallLog.filter((c) => c.tool === 'search_code' && c.ok)).toHaveLength(4);
    expect(
      result.errors.some((e) => /30 tool calls in one reply; only the first 8 were kept/.test(e)),
    ).toBe(true);
    const assistant = model.seen[1]?.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    expect(assistant?.tool_calls?.length).toBe(8);
  });
});

import { memoizeReads } from '../src/agent/memo-lain.js';

describe('memoizeReads — the heavy read is paid once per investigation', () => {
  it('the same get_service/list call is answered from memory; different arguments are not', async () => {
    let n = 0;
    const base = createLainMock();
    const lain = {
      ...base,
      getService: async (a: never) => {
        n++;
        return base.getService(a);
      },
    };
    const m = memoizeReads(lain as never);
    const a = await m.getService({ snapshot: 'live', service: 'billing' } as never);
    const b = await m.getService({ snapshot: 'live', service: 'billing' } as never);
    await m.getService({ snapshot: 'live', service: 'orders' } as never);
    expect(b).toBe(a);
    expect(n).toBe(2);
  });

  it('works with a CLASS-based adapter (the real client): prototype methods survive, `this` still works', async () => {
    class RealLike {
      readonly analyzerVersion = 't';
      readonly apiVersion = '1' as const;
      private calls = 0;
      async getService() {
        this.calls++;
        return { consumers: [], calls: this.calls };
      }
      async getCodeSnippet(a: { path: string }) {
        return { text: `code of ${a.path} (${this.analyzerVersion})` };
      }
      async codeTool(tool: string) {
        return { text: `ran ${tool}` };
      }
    }
    const m = memoizeReads(new RealLike() as never) as unknown as RealLike;
    expect((await m.getCodeSnippet({ path: 'a.ts' })).text).toBe('code of a.ts (t)');
    expect((await m.codeTool('search_code')).text).toBe('ran search_code');
    const x = (await m.getService()) as { calls: number };
    const y = (await m.getService()) as { calls: number };
    expect(y).toBe(x);
    expect(x.calls).toBe(1);
    expect(m.analyzerVersion).toBe('t');
  });

  it('a failure is not remembered: the next attempt asks again', async () => {
    let n = 0;
    const lain = {
      ...createLainMock(),
      listServices: async () => {
        n++;
        if (n === 1) throw new Error('boom');
        return { items: [], scope: { configured_only: true, reviewed: [], unreviewed: [] } };
      },
    };
    const m = memoizeReads(lain as never);
    await expect(m.listServices({ snapshot: 'live' } as never)).rejects.toThrow('boom');
    await expect(m.listServices({ snapshot: 'live' } as never)).resolves.toBeTruthy();
    expect(n).toBe(2);
  });
});

describe('find_docs — the repositories document themselves', () => {
  const searchText = `## search_code: x (mode=lexical, fell_back=false)

1. **0004-race-safe-balance-adjustments.md** file docs/adr/0004-race-safe-balance-adjustments.md anchor=0.00 (\`aaa\`)
2. **gift_card_balance_adjusted_event** function saleor/giftcard/events.py:33 anchor=0.37 (\`bbb\`)
3. **AGENTS.md** file AGENTS.md anchor=0.10 (\`ccc\`)
`;
  const lain = (seen: Array<Record<string, unknown>>, text = searchText) =>
    ({
      ...createLainMock(),
      codeTool: async (_t: string, a: Record<string, unknown>) => {
        seen.push(a);
        return { text: a.repo_id === 'orders' ? text : '## search_code: x\n\nNo results.' };
      },
    }) as never;

  it('keeps only documentation files, asks every repo of the catalog, and says how to read one', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const d = createDispatcher({ lain: lain(seen), view: 'live' });
    const r = await d.execute(call('a', 'find_docs', { query: 'race safe' }));
    expect(r.ok).toBe(true);
    const text = JSON.stringify(r);
    expect(text).toContain('orders: docs/adr/0004-race-safe-balance-adjustments.md');
    expect(text).toContain('orders: AGENTS.md');
    expect(text).not.toContain('events.py');
    expect(text).toContain('get_code_snippet');
    expect(seen.map((s) => s.repo_id).sort()).toEqual(
      [...new Set(seen.map((s) => s.repo_id))].sort(),
    );
    expect(seen.length).toBeGreaterThan(1);
  });

  it('a named repo is the only one asked', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const d = createDispatcher({ lain: lain(seen), view: 'live' });
    await d.execute(call('a', 'find_docs', { query: 'x', repo: 'orders' }));
    expect(seen.map((s) => s.repo_id)).toEqual(['orders']);
  });

  it('no match says so plainly and tells the model to fall back to code', async () => {
    const d = createDispatcher({ lain: lain([], 'nothing'), view: 'live' });
    const r = await d.execute(call('a', 'find_docs', { query: 'zzz' }));
    expect(JSON.stringify(r)).toMatch(/No documentation file matched/);
  });

  it('is capped like the other searches', () => {
    expect(PER_TOOL_CAP.find_docs).toBe(3);
  });

  it("docsFor: finds the ADR whose name shares the question's words, ignores symbols and generic READMEs", async () => {
    const byQuery: Record<string, string> = {
      gift: '1. **README.md** file README.md anchor=0\n',
      balance:
        '1. **0004-race-safe-balance-adjustments.md** file docs/adr/0004-race-safe-balance-adjustments.md anchor=0\n2. **x** function a/b.py:1 anchor=0\n',
      adjustments:
        '1. **0004-race-safe-balance-adjustments.md** file docs/adr/0004-race-safe-balance-adjustments.md anchor=0\n',
    };
    const l = {
      ...createLainMock(),
      codeTool: async (_t: string, a: Record<string, unknown>) => ({
        text: a.repo_id === 'orders' ? (byQuery[a.query as string] ?? '') : '',
      }),
    } as never;
    const d = createDispatcher({ lain: l, view: 'live' });
    const out = await d.docsFor('Why must gift card balance adjustments be race-safe?');
    expect(out).toBe('- orders: docs/adr/0004-race-safe-balance-adjustments.md');
  });

  it('docsFor: nothing relevant is an empty string, and an engine failure never throws', async () => {
    const none = createDispatcher({ lain: lain([], 'nothing'), view: 'live' });
    expect(await none.docsFor('Explain the checkout totals')).toBe('');
    const boom = createDispatcher({
      lain: {
        ...createLainMock(),
        codeTool: async () => {
          throw new Error('down');
        },
      } as never,
      view: 'live',
    });
    expect(await boom.docsFor('Explain the checkout totals')).toBe('');
  });
});

describe('investigate — saying there is no documentation needs a search', () => {
  // Un modelo guionizado: lee, entrega, y entrega otra vez.
  class Script implements ChatCompleter {
    readonly seen: ChatMessage[][] = [];
    constructor(private readonly script: NemotronResponse[]) {}
    async complete(messages: ChatMessage[]): Promise<NemotronResponse> {
      this.seen.push(structuredClone(messages));
      const next = this.script.shift();
      if (!next) throw new Error('script exhausted');
      return next;
    }
  }

  const pushbackOf = (seen: ChatMessage[][]): string =>
    (seen.at(-1) ?? [])
      .filter((m) => m.role === 'tool')
      .map((m) => m.content ?? '')
      .join('\n');

  it('an answer that says nothing is documented is sent back once when no search was made', async () => {
    const model = new Script([
      resp([call('a', 'list_services', {})]),
      resp([call('b', 'submit_answer', { answer: 'No ADR was found for this.', claims: [] })]),
      resp([
        call('c', 'submit_answer', {
          answer: 'I found no ADR after searching the docs.',
          claims: [],
        }),
      ]),
    ]);
    const result = await investigate({
      question: 'Why is the checkout done this way?',
      lain: createLainMock(),
      model,
      view: 'live',
      // Sin índice de documentación: la pista de docs es vacía.
      docs: () => [],
      budget: { maxToolCalls: 8, maxModelMs: 60_000 },
    });
    const pushback = pushbackOf(model.seen);
    expect(pushback).toMatch(/absence_unsupported/);
    expect(pushback).toMatch(/find_docs was never called/);
    expect(result.answer).toBe('I found no ADR after searching the docs.');
  });

  it('after a find_docs call the same answer is accepted: the absence is supported', async () => {
    const model = new Script([
      resp([call('a', 'list_services', {})]),
      resp([call('b', 'find_docs', { query: 'checkout' })]),
      resp([call('c', 'submit_answer', { answer: 'No ADR was found for this.', claims: [] })]),
    ]);
    const result = await investigate({
      question: 'Why is the checkout done this way?',
      lain: createLainMock(),
      model,
      view: 'live',
      docs: () => [],
      budget: { maxToolCalls: 8, maxModelMs: 60_000 },
    });
    expect(pushbackOf(model.seen)).not.toMatch(/absence_unsupported/);
    // No se le pidió una segunda entrega.
    expect(model.seen).toHaveLength(3);
    expect(result.answer).toBe('No ADR was found for this.');
  });

  it('an answer that does not claim an absence is never sent back for one', async () => {
    const model = new Script([
      resp([call('a', 'list_services', {})]),
      resp([
        call('b', 'submit_answer', {
          answer: 'The checkout is implemented in saleor/checkout/utils.py.',
          claims: [],
        }),
      ]),
    ]);
    await investigate({
      question: 'Why is the checkout done this way?',
      lain: createLainMock(),
      model,
      view: 'live',
      docs: () => [],
      budget: { maxToolCalls: 8, maxModelMs: 60_000 },
    });
    expect(pushbackOf(model.seen)).not.toMatch(/absence_unsupported/);
    expect(model.seen).toHaveLength(2);
  });

  it('a documentation hint that IS there means the answer is not about an absence', async () => {
    const model = new Script([
      resp([call('a', 'list_services', {})]),
      resp([
        call('b', 'submit_answer', {
          answer: 'No ADR covers this; the code does it.',
          claims: [],
        }),
      ]),
    ]);
    await investigate({
      question: 'Why is the checkout done this way?',
      lain: createLainMock(),
      model,
      view: 'live',
      // La pista trae un archivo: la ausencia ya está en contexto.
      docs: () => [
        {
          repo: 'saleor',
          path: 'docs/adr/0004.md',
          heading: 'Decision',
          line: 3,
          snippet: 'the balance is adjusted with a lock',
          text: '## Decision (heading at line 3)\nthe balance is adjusted with a lock',
          kind: 'decision',
          title: '0004',
        },
      ],
      budget: { maxToolCalls: 8, maxModelMs: 60_000 },
    });
    expect(pushbackOf(model.seen)).not.toMatch(/absence_unsupported/);
  });
});
