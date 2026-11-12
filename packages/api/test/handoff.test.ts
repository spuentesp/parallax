// El relevo: el planificador PLANEA y REDACTA, el trabajador LEE.
//
// Lo que se prueba aquí es el mecanismo (quién hace qué, y qué pasa cuando
// una fase falla); lo que no se puede probar con un modelo guionizado es si
// el relevo MEJORA la respuesta: eso lo mide scripts/eval-saleor.ts contra el
// motor real, y su tabla está en docs/agent-spend.md.

import { describe, expect, it } from 'vitest';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const tc = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const resp = (toolCalls: ToolCall[], content: string | null = null): NemotronResponse => ({
  content,
  toolCalls,
  finishReason: 'tool_calls',
  usage: { promptTokens: 10, completionTokens: 5 },
  model: 'fake/nemotron',
  latencyMs: 1,
});

const PLAN = {
  goal: 'find where the shipping address is set',
  steps: [{ tool: 'search_code', args: { query: 'change_shipping_address' }, why: 'locate it' }],
  look_at: ['saleor/checkout/utils.py'],
};

const DRAFT = {
  answer: 'The address is set at saleor/checkout/utils.py:440.',
  claims: [],
};

interface Call {
  messages: ChatMessage[];
  model?: string;
  tools?: unknown;
}

/** ¿Es esta llamada la del planificador? (sólo él tiene la herramienta del plan) */
const isPlan = (call: Call): boolean => JSON.stringify(call.tools ?? '').includes('submit_plan');
/** ¿Es la escritura? La hace el planificador; el trabajador va con el modelo rápido. */
const isWriter = (call: Call): boolean => call.model === 'planner' && !isPlan(call);

/** Un modelo que responde según la fase en la que está. */
class Relay implements ChatCompleter {
  readonly calls: Call[] = [];
  constructor(private readonly reply: (call: Call) => NemotronResponse | Error) {}
  async complete(
    messages: ChatMessage[],
    opts?: { model?: string; tools?: unknown },
  ): Promise<NemotronResponse> {
    const call: Call = {
      messages: structuredClone(messages),
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.tools ? { tools: opts.tools } : {}),
    };
    this.calls.push(call);
    const next = this.reply(call);
    if (next instanceof Error) throw next;
    return next;
  }
}

/** El trabajador: lee una vez y entrega su borrador. */
const worker = (call: Call): NemotronResponse =>
  call.messages.at(-1)?.role === 'tool'
    ? resp([tc('w', 'submit_answer', DRAFT)])
    : resp([tc('r', 'list_services', {})]);

const writerSays = (answer: string): NemotronResponse =>
  resp([tc('w', 'submit_answer', { answer, claims: [] })]);

describe('the relay: plan → work → write', () => {
  it('the planner plans, the worker reads, the planner writes', async () => {
    const model = new Relay((call) => {
      if (isPlan(call)) return resp([tc('p', 'submit_plan', PLAN)]);
      if (isWriter(call)) return writerSays('Written by the planner.');
      return worker(call);
    });

    const result = await investigate({
      question: 'where is the shipping address set?',
      lain: createLainMock(),
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });

    // Tres fases: el plan (planner), el bucle (worker) y la escritura (planner).
    expect(model.calls.length).toBeGreaterThanOrEqual(3);
    expect(model.calls[0]?.model).toBe('planner');
    expect(isPlan(model.calls[0] as Call)).toBe(true);
    // El plan llega al trabajador.
    const workerContext = JSON.stringify(model.calls[1]?.messages);
    expect(workerContext).toContain('Research plan from the planner model');
    expect(workerContext).toContain('find where the shipping address is set');
    // La escritura la hace el planificador, y ve los resultados del trabajador.
    const writer = model.calls.find((c) => isWriter(c));
    expect(writer?.model).toBe('planner');
    const writerContext = JSON.stringify(writer?.messages);
    expect(writerContext).toContain('tool result 1');
    expect(writerContext).toContain('The worker gathered these tool results');
    // Y lo que escribió el planificador es la respuesta final.
    expect(result.answer).toBe('Written by the planner.');
  });

  it('the writer is told which ids and receipts it may cite', async () => {
    const model = new Relay((call) => {
      if (isPlan(call)) return resp([tc('p', 'submit_plan', PLAN)]);
      if (isWriter(call)) return writerSays('ok');
      return worker(call);
    });
    await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    const writer = model.calls.find((c) => isWriter(c));
    const ctx = JSON.stringify(writer?.messages);
    // El escritor sabe qué puede citar: los ids que entregó el backend (aquí
    // ninguno) y los recibos de las lecturas.
    expect(ctx).toContain('Never invent an id');
    expect(ctx).toContain('Query receipts you may cite');
    // El recibo de la lectura que hizo el trabajador.
    expect(ctx).toContain('q:1');
  });

  it('a plan that never arrives does not stop the investigation', async () => {
    const model = new Relay((call) => {
      if (isPlan(call)) return new Error('planner is down');
      if (isWriter(call)) return writerSays('written anyway');
      return worker(call);
    });
    const result = await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    // El fallo del planificador queda a la vista, pero la respuesta existe.
    expect(result.errors.join(' ')).toMatch(/planner plan failed/);
    expect(result.answer).toBe('written anyway');
    // Y el trabajador corrió sin plan.
    expect(JSON.stringify(model.calls[1]?.messages)).not.toContain(
      'Research plan from the planner',
    );
  });

  it('a writer that fails leaves the worker draft standing', async () => {
    const model = new Relay((call) => {
      if (isPlan(call)) return resp([tc('p', 'submit_plan', PLAN)]);
      if (isWriter(call)) return new Error('writer is down');
      return worker(call);
    });
    const result = await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    expect(result.errors.join(' ')).toMatch(/the writer failed/);
    expect(result.answer).toBe(DRAFT.answer);
  });

  it('a contradicted claim goes back to the WRITER, with what the engine read', async () => {
    const lain = {
      ...createLainMock(),
      getCodeSnippet: async () => ({
        text: 'File: x\nShowing lines 437-468\n\n   440: def another_function(',
      }),
    } as unknown as LainAdapter;
    const model = new Relay((call) => {
      if (isPlan(call)) return resp([tc('p', 'submit_plan', PLAN)]);
      if (isWriter(call)) {
        return resp([
          tc('w', 'submit_answer', {
            answer: 'It is at saleor/checkout/utils.py:440.',
            claims: [
              {
                kind: 'location',
                repo: 'orders',
                path: 'saleor/checkout/utils.py',
                line: 440,
                contains: 'change_shipping_address_in_checkout',
                text: 'sets it',
              },
            ],
          }),
        ]);
      }
      return worker(call);
    });
    const result = await investigate({
      question: 'q',
      lain,
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    // El rebote va al ESCRITOR (es el que escribió la afirmación), no al trabajador.
    const writers = model.calls.filter((c) => isWriter(c));
    expect(writers).toHaveLength(2);
    const second = JSON.stringify(writers[1]?.messages);
    expect(second).toMatch(/claims_contradicted/);
    expect(second).toMatch(/What the engine actually read/);
    // Y la entrega se acepta con su veredicto, una sola vez.
    expect(result.claims.map((c) => c.verdict)).toEqual(['contradicted']);
  });

  it('a writer cut off by the token limit gets another chance with more room', async () => {
    let writerCalls = 0;
    const model = new Relay((call) => {
      if (isPlan(call)) return resp([tc('p', 'submit_plan', PLAN)]);
      if (isWriter(call)) {
        writerCalls++;
        if (writerCalls === 1) {
          // Cortada a medias: los argumentos de la llamada quedan a medias.
          const cut: ToolCall = {
            id: 'w',
            type: 'function',
            function: { name: 'submit_answer', arguments: '{"answer": "cut off mid' },
          };
          return { ...resp([cut]), finishReason: 'length' };
        }
        return writerSays('written on the second try');
      }
      return worker(call);
    });
    const result = await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      handoff: true,
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    expect(writerCalls).toBe(2);
    expect(result.errors.join(' ')).toMatch(/cut off/);
    expect(result.answer).toBe('written on the second try');
  });

  it('the relay is OFF by default: the worker writes and nobody plans', async () => {
    const model = new Relay((call) => {
      if (isPlan(call)) throw new Error('the planner must not be called');
      return worker(call);
    });
    const result = await investigate({
      question: 'q',
      lain: createLainMock(),
      model,
      view: 'live',
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    expect(result.answer).toBe(DRAFT.answer);
    // Sólo el bucle: ninguna llamada al planificador.
    expect(model.calls.every((c) => c.model !== 'planner')).toBe(true);
  });
});
