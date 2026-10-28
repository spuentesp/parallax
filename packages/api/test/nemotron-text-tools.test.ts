// Algunos endpoints devuelven la llamada a una herramienta como texto en
// `content` (<tool_call><function=…><parameter=…>). Se lee si está completa; si
// vino cortada se detecta y se limpia, sin dejar XML en la respuesta.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasTextToolCall,
  NemotronProvider,
  parseTextToolCalls,
  stripToolMarkup,
} from '../src/agent/nemotron.js';

afterEach(() => vi.unstubAllGlobals());

const call = (name: string, params: Record<string, string>) =>
  `<tool_call>\n<function=${name}>\n${Object.entries(params)
    .map(([k, v]) => `<parameter=${k}>\n${v}\n</parameter>`)
    .join('\n')}\n</function>\n</tool_call>`;

describe('parseTextToolCalls', () => {
  it('reads a complete call: strings stay strings, [ and { parameters are JSON', () => {
    const claims = JSON.stringify([
      { kind: 'relation', consumer: 'a', provider: 'b', polarity: 'present' },
    ]);
    const text = call('submit_answer', {
      answer: '## Title\n\nSome *markdown* with "quotes".',
      claims,
    });
    const { calls, rest } = parseTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'text_call_0', type: 'function' });
    expect(calls[0]?.function.name).toBe('submit_answer');
    expect(JSON.parse(calls[0]?.function.arguments ?? '{}')).toEqual({
      answer: '## Title\n\nSome *markdown* with "quotes".',
      claims: [{ kind: 'relation', consumer: 'a', provider: 'b', polarity: 'present' }],
    });
    expect(rest).toBe('');
  });

  it('keeps the text around the call, and reads several calls in order', () => {
    const text = `Let me check.\n${call('get_service', { service: 'orders' })}\nand\n${call('get_contract', { key: 'http:GET /x' })}`;
    const { calls, rest } = parseTextToolCalls(text);
    expect(calls.map((c) => [c.id, c.function.name])).toEqual([
      ['text_call_0', 'get_service'],
      ['text_call_1', 'get_contract'],
    ]);
    expect(rest).toBe('Let me check.\n\nand');
  });

  it('an invalid JSON-looking parameter stays as text instead of failing', () => {
    const { calls } = parseTextToolCalls(
      call('submit_answer', { answer: '[not json', claims: '[1,' }),
    );
    expect(JSON.parse(calls[0]?.function.arguments ?? '{}')).toEqual({
      answer: '[not json',
      claims: '[1,',
    });
  });

  it('a call cut off before it closes is not read', () => {
    const cut = '<tool_call>\n<function=submit_answer>\n<parameter=answer>\nThree services consume';
    expect(parseTextToolCalls(cut)).toEqual({ calls: [], rest: cut });
  });

  it('plain text and null pass through', () => {
    expect(parseTextToolCalls('just prose')).toEqual({ calls: [], rest: 'just prose' });
    expect(parseTextToolCalls(null)).toEqual({ calls: [], rest: '' });
    expect(parseTextToolCalls('')).toEqual({ calls: [], rest: '' });
  });
});

describe('hasTextToolCall / stripToolMarkup', () => {
  it('detects leftover markup, and cleans it for display', () => {
    expect(hasTextToolCall('<tool_call>\n<function=submit_answer>')).toBe(true);
    expect(hasTextToolCall('<function=x>')).toBe(true);
    expect(hasTextToolCall('no markup here')).toBe(false);
    expect(hasTextToolCall(null)).toBe(false);
    const cut =
      '<tool_call>\n<function=submit_answer>\n<parameter=answer>\n## Consumers\n\nThree services';
    expect(stripToolMarkup(cut)).toBe('## Consumers\n\nThree services');
    expect(stripToolMarkup('</parameter></function></tool_call>done')).toBe('done');
  });
});

describe('NemotronProvider.complete', () => {
  const provider = new NemotronProvider({
    baseUrl: 'https://tf.test/v1',
    apiKey: 'k',
    plannerModel: 'p',
    workerModel: 'w',
  });
  const reply = (message: object, finish = 'stop') =>
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            model: 'm',
            choices: [{ message, finish_reason: finish }],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

  it('turns a text-form tool call into a real one and marks the turn as a tool-call turn', async () => {
    reply({ content: call('submit_answer', { answer: 'ok', claims: '[]' }) });
    const r = await provider.complete([{ role: 'user', content: 'q' }]);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.function.name).toBe('submit_answer');
    expect(r.content).toBeNull();
    expect(r.finishReason).toBe('tool_calls');
  });

  it('leaves structured tool calls and plain answers exactly as they came', async () => {
    const structured = [
      { id: 'c1', type: 'function', function: { name: 'get_service', arguments: '{}' } },
    ];
    reply({ content: 'thinking', tool_calls: structured }, 'tool_calls');
    const a = await provider.complete([{ role: 'user', content: 'q' }]);
    expect(a.toolCalls).toEqual(structured);
    expect(a.content).toBe('thinking');
    reply({ content: 'plain answer' });
    const b = await provider.complete([{ role: 'user', content: 'q' }]);
    expect(b).toMatchObject({ content: 'plain answer', toolCalls: [], finishReason: 'stop' });
  });

  it('keeps the text after a parsed call as the content', async () => {
    reply({ content: `Checking.\n${call('get_service', { service: 'orders' })}` });
    const r = await provider.complete([{ role: 'user', content: 'q' }]);
    expect(r.content).toBe('Checking.');
    expect(r.toolCalls).toHaveLength(1);
  });
});
