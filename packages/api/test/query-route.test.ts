// POST /api/query con modelo configurado: el modelo se intercepta en el borde
// de red (fetch hacia Token Factory); el investigador, el despachante y LAIN
// (mock) son los reales. Fija la forma de `budget` que ve el cliente.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server.js';

type ModelTurn = { content: string | null; tool?: string };

function stubModel(turns: ModelTurn[]): void {
  let i = 0;
  vi.stubGlobal('fetch', async () => {
    const turn = turns[Math.min(i, turns.length - 1)] as ModelTurn;
    const id = `call_${i++}`;
    const message = turn.tool
      ? {
          content: null,
          tool_calls: [{ id, type: 'function', function: { name: turn.tool, arguments: '{}' } }],
        }
      : { content: turn.content };
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [{ message, finish_reason: turn.tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

describe('POST /api/query budget', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  async function start(investigatorMaxToolCalls: number): Promise<void> {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 'rw', orgId: 'org_demo', scopes: ['read', 'write'] }],
      webBundlePath: dir,
      nebiusToken: 'test-token',
      investigatorMaxToolCalls,
    });
  }

  const ask = () =>
    app.inject({
      method: 'POST',
      url: '/api/query',
      headers: { authorization: 'Bearer rw' },
      payload: { question: 'q', orgId: 'org_demo' },
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-query-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a research that finished inside the budget as not cut short', async () => {
    stubModel([{ content: null, tool: 'list_services' }, { content: 'done, no citations' }]);
    await start(4);
    const r = await ask();
    expect(r.statusCode).toBe(200);
    expect(r.json().budget).toMatchObject({
      maxToolCalls: 4,
      toolCallsUsed: 1,
      exhausted: false,
      cutShort: false,
    });
    // Sin submit_answer no hay afirmaciones: la forma de la respuesta es estable.
    expect(r.json().claims).toEqual([]);
    expect(r.json().claims_summary).toMatchObject({ total: 0, contradicted: 0 });
  });

  it('reports cutShort when the budget refused a read the model asked for', async () => {
    stubModel([{ content: null, tool: 'list_services' }]);
    await start(2);
    const r = await ask();
    expect(r.statusCode).toBe(200);
    expect(r.json().budget).toMatchObject({ toolCallsUsed: 2, exhausted: true, cutShort: true });
  });
});
