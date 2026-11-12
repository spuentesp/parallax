// Una afirmación que el motor CONTRADICE vuelve al modelo con lo que el motor
// leyó de verdad, UNA vez. Lo que se guarda al final es el veredicto de la
// entrega aceptada, no el de la primera.

import { describe, expect, it } from 'vitest';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const FILE = [
  '437:     return updated_fields',
  '438: ',
  '440: def change_shipping_address_in_checkout(',
  '441:     checkout_info: "CheckoutInfo",',
].join('\n');

/** El motor en el borde: lee esas líneas y no hay más. */
function engine() {
  const lain = {
    ...createLainMock(),
    getCodeSnippet: async () => ({ text: `File: x\nShowing lines 437-468\n\n${FILE}` }),
  } as unknown as LainAdapter;
  return lain;
}

const tc = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const resp = (toolCalls: ToolCall[]): NemotronResponse => ({
  content: null,
  toolCalls,
  finishReason: 'tool_calls',
  usage: { promptTokens: 1, completionTokens: 1 },
  model: 'f',
  latencyMs: 1,
});

const claim = (contains: string) => ({
  kind: 'location',
  repo: 'orders',
  path: 'saleor/checkout/utils.py',
  line: 440,
  contains,
  text: 'sets the shipping address',
});

async function run(script: unknown[]) {
  const seen: ChatMessage[][] = [];
  const model: ChatCompleter = {
    complete: async (m) => {
      seen.push(structuredClone(m));
      return (script as NemotronResponse[]).shift() as NemotronResponse;
    },
  };
  const result = await investigate({
    question: 'where?',
    lain: engine(),
    model,
    view: 'live',
    budget: { maxToolCalls: 8, maxModelMs: 30_000 },
  });
  return { result, seen };
}

describe('the repair bounce for contradicted claims', () => {
  it('sends the contradiction back once, with what the engine actually read', async () => {
    const { result, seen } = await run([
      resp([tc('a', 'list_services', {})]),
      resp([
        tc('b', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [claim('billing_address')],
        }),
      ]),
      resp([
        tc('c', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [claim('change_shipping_address_in_checkout')],
        }),
      ]),
    ]);

    const pushback =
      seen
        .at(-1)
        ?.filter((m) => m.role === 'tool')
        .map((m) => m.content ?? '')
        .join('\n') ?? '';
    expect(pushback).toMatch(/claims_contradicted/);
    // El motivo de la contradicción…
    expect(pushback).toMatch(/is not there/);
    // …y lo que el motor leyó de verdad, para que lo corrija.
    expect(pushback).toMatch(/What the engine actually read/);
    expect(pushback).toContain('change_shipping_address_in_checkout');

    // Lo que se guarda es el veredicto de la entrega ACEPTADA.
    expect(result.claims.map((c) => c.verdict)).toEqual(['verified']);
    expect(result.explanationStatus).toBe('available');
  });

  it('only once: a second contradiction is accepted, not bounced again', async () => {
    const { result, seen } = await run([
      resp([tc('a', 'list_services', {})]),
      resp([
        tc('b', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [claim('billing_address')],
        }),
      ]),
      resp([
        tc('c', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [claim('billing_address')],
        }),
      ]),
    ]);

    expect(result.claims.map((c) => c.verdict)).toEqual(['contradicted']);
    expect(result.claimsSummary.contradicted).toBe(1);
    // No se le pide una tercera entrega: dos rondas de modelo tras la lectura.
    expect(seen).toHaveLength(3);
  });

  it('an answer with no claims at all is not bounced', async () => {
    const { result, seen } = await run([
      resp([tc('a', 'list_services', {})]),
      resp([
        tc('b', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [],
        }),
      ]),
      resp([
        tc('c', 'submit_answer', {
          answer: 'The address is set at saleor/checkout/utils.py:440.',
          claims: [claim('change_shipping_address_in_checkout')],
        }),
      ]),
    ]);
    // La primera entrega no tenía afirmaciones de lugar: eso es otro rebote
    // (location_claims_missing), no una contradicción.
    const pushback =
      seen
        .at(-1)
        ?.filter((m) => m.role === 'tool')
        .map((m) => m.content ?? '')
        .join('\n') ?? '';
    expect(pushback).toMatch(/location_claims_missing/);
    expect(pushback).not.toMatch(/claims_contradicted/);
    expect(result.claims.map((c) => c.verdict)).toEqual(['verified']);
  });
});
