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
  readonly seen: Array<{ messages: ChatMessage[]; toolChoice: unknown }> = [];
  private n = 0;
  constructor(private readonly reply: (n: number, toolChoice: unknown) => NemotronResponse) {}
  async complete(
    messages: ChatMessage[],
    opts?: { toolChoice?: unknown },
  ): Promise<NemotronResponse> {
    this.seen.push({ messages: structuredClone(messages), toolChoice: opts?.toolChoice });
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
});
