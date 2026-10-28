// Progreso en vivo: POST /api/query/stream emite eventos (server-sent events) mientras
// el investigador trabaja y cierra con el MISMO resultado que /api/query. Modelo
// interceptado en el borde de red; investigador, despachante y motor (mock) reales.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summarizeCall } from '../src/agent/investigator.js';
import { buildApp } from '../src/server.js';

type Turn = { tool: string; args?: unknown };

function stubModel(turns: Turn[]): void {
  let i = 0;
  vi.stubGlobal('fetch', async () => {
    const t = turns[Math.min(i, turns.length - 1)] as Turn;
    const id = `call_${i++}`;
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id,
                  type: 'function',
                  function: { name: t.tool, arguments: JSON.stringify(t.args ?? {}) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

interface Sse {
  event: string;
  data: Record<string, unknown>;
}
const parseSse = (text: string): Sse[] =>
  text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>;
      return { event, data };
    });

describe('summarizeCall', () => {
  it('reads like a sentence, not like JSON', () => {
    expect(
      summarizeCall(
        JSON.stringify({ query: 'checkout shipping address', repo: 'saleor', limit: 5 }),
      ),
    ).toBe('checkout shipping address · in saleor');
    expect(summarizeCall(JSON.stringify({ path: 'saleor/checkout/utils.py', line: 440 }))).toBe(
      'saleor/checkout/utils.py:440',
    );
    expect(
      summarizeCall(JSON.stringify({ node_id: '0def89de-d0b8-5a3e-99bc', repo: 'saleor' })),
    ).toBe('0def89de · in saleor');
    expect(summarizeCall('not json')).toBe('');
    expect(summarizeCall(JSON.stringify({ query: 'x'.repeat(300) })).length).toBeLessThanOrEqual(
      110,
    );
  });
});

describe('POST /api/query/stream', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer rw' };

  async function start(rate?: number) {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 'rw', orgId: 'org_demo', scopes: ['read', 'write'] }],
      webBundlePath: dir,
      nebiusToken: 'test-token',
      investigatorMaxToolCalls: 8,
      ...(rate !== undefined ? { queryRateLimitPerHour: rate } : {}),
    });
  }
  const stream = (payload: object, headers: Record<string, string> = H) =>
    app.inject({ method: 'POST', url: '/api/query/stream', headers, payload });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-stream-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams each round and each read as it happens, then the final result', async () => {
    stubModel([
      { tool: 'list_services' },
      { tool: 'search_code', args: { query: 'checkout shipping' } },
      {
        tool: 'submit_answer',
        args: {
          answer: 'billing consumes orders.',
          claims: [
            { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
          ],
        },
      },
    ]);
    await start();
    const r = await stream({ question: 'q', orgId: 'org_demo' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(r.body);
    const kinds = events.map((e) => (e.event === 'progress' ? `progress:${e.data.type}` : e.event));
    // Orden real: ronda → lectura → ronda → lectura → ronda → verificación → resultado.
    expect(kinds).toEqual([
      'progress:round',
      'progress:tool',
      'progress:round',
      'progress:tool',
      'progress:round',
      'progress:verify',
      'result',
    ]);
    const tools = events.filter((e) => e.data.type === 'tool').map((e) => e.data);
    expect(tools[1]).toMatchObject({ tool: 'search_code', summary: 'checkout shipping', ok: true });
    expect(events[0]?.data).toMatchObject({ type: 'round', round: 1, maxToolCalls: 8 });
    const result = events.at(-1)?.data as {
      answer: string;
      claims_summary: { verified: number };
      conversation: { id: string } | null;
    };
    expect(result.answer).toBe('billing consumes orders.');
    expect(result.claims_summary.verified).toBe(1);
    expect(result.conversation?.id).toBeTruthy();
  });

  it('the result is the same one /api/query gives, and the turn is saved and readable', async () => {
    stubModel([
      { tool: 'list_services' },
      { tool: 'submit_answer', args: { answer: 'ok', claims: [] } },
    ]);
    await start();
    const r = await stream({ question: 'what?', orgId: 'org_demo' });
    const result = parseSse(r.body).at(-1)?.data as { conversation: { id: string; seq: number } };
    const got = await app.inject({
      method: 'GET',
      url: `/api/conversations/${result.conversation.id}`,
      headers: H,
    });
    expect((got.json() as { turns: Array<{ question: string }> }).turns[0]?.question).toBe('what?');
  });

  it('errors that happen BEFORE the model are plain JSON, not an empty stream', async () => {
    stubModel([{ tool: 'list_services' }]);
    await start(1);
    expect((await stream({ question: 'a', orgId: 'org_demo' })).headers['content-type']).toMatch(
      /event-stream/,
    );
    const limited = await stream({ question: 'b', orgId: 'org_demo' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['content-type']).toMatch(/json/);
    expect(limited.headers['retry-after']).toBeTruthy();
  });

  it('a conversation that is not yours is a JSON 404, same as the plain route', async () => {
    stubModel([{ tool: 'list_services' }]);
    await start();
    const r = await stream({ question: 'q', orgId: 'org_demo', conversationId: 'conv_nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ code: 'NotFound' });
  });

  it('requires a token', async () => {
    stubModel([{ tool: 'list_services' }]);
    await start();
    expect((await stream({ question: 'q', orgId: 'org_demo' }, {})).statusCode).toBe(401);
  });

  it('announces the wrap-up when the budget runs out', async () => {
    // Un modelo que nunca deja de leer: se le pide cerrar.
    stubModel([
      { tool: 'list_services' },
      { tool: 'list_contracts' },
      { tool: 'list_unresolved' },
      { tool: 'get_coverage' },
      { tool: 'search_code', args: { query: 'a' } },
      { tool: 'search_code', args: { query: 'b' } },
      { tool: 'submit_answer', args: { answer: 'done', claims: [] } },
    ]);
    await start();
    const events = parseSse((await stream({ question: 'q', orgId: 'org_demo' })).body);
    expect(events.some((e) => e.data.type === 'wrapup' && e.data.reason === 'budget')).toBe(true);
    expect(events.at(-1)?.event).toBe('result');
  });
});
