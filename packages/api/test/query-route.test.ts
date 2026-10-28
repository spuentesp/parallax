// POST /api/query con modelo configurado: el modelo se intercepta en el borde
// de red (fetch hacia Token Factory); el investigador, el despachante y LAIN
// (mock) son los reales. Fija la forma de `budget` que ve el cliente.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { toOrgGraph } from '../src/org-graph.js';
import { buildApp } from '../src/server.js';
import { buildEndpointTopology } from '../src/topology.js';

type ModelTurn = { content: string | null; tool?: string; args?: unknown };

function stubModel(turns: ModelTurn[]): void {
  let i = 0;
  vi.stubGlobal('fetch', async () => {
    const turn = turns[Math.min(i, turns.length - 1)] as ModelTurn;
    const id = `call_${i++}`;
    const message = turn.tool
      ? {
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name: turn.tool, arguments: JSON.stringify(turn.args ?? {}) },
            },
          ],
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
    expect(r.json().map_focus).toBeNull();
  });

  it('reports cutShort when the budget refused a read the model asked for', async () => {
    stubModel([{ content: null, tool: 'list_services' }]);
    await start(2);
    const r = await ask();
    expect(r.statusCode).toBe(200);
    expect(r.json().budget).toMatchObject({ toolCallsUsed: 2, exhausted: true, cutShort: true });
  });

  it('verifies a relation claim but gives no map focus when the workspace has no map of its own', async () => {
    // org_demo no es un workspace con LAIN: el investigador usó el adapter por
    // defecto (mock) y el mapa dice "unconfigured". Apuntarle un foco a nodos
    // que ese mapa no muestra sería enviar al usuario a ninguna parte.
    stubModel([
      {
        content: null,
        tool: 'submit_answer',
        args: {
          answer: 'billing consumes orders.',
          claims: [
            { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
          ],
        },
      },
    ]);
    await start(8);
    const r = await ask();
    expect(r.json().claims_summary).toMatchObject({ verified: 1 });
    expect(r.json().map_focus).toBeNull();
  });

  it('returns a map focus built from verified claims and validated against the map graph', async () => {
    stubModel([
      {
        content: null,
        tool: 'submit_answer',
        args: {
          answer: 'billing consumes orders.',
          claims: [
            { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
          ],
        },
      },
    ]);
    await start(8);
    // El mapa del workspace (aquí el motor mock): lo que el agente cita debe estar en él.
    const graph = toOrgGraph(await buildEndpointTopology(createLainMock()));
    app.orgGraphs = { load: async () => ({ ok: true, graph, meta: { source: 'lain' } }) };
    const r = await ask();
    const focus = r.json().map_focus as {
      seed: string;
      ids: string[];
      relations: Array<{
        consumer: string;
        provider: string;
        polarity: string;
        uses: number;
        complete: boolean;
      }>;
      query: string;
    };
    expect(focus.ids).toEqual(expect.arrayContaining(['svc:billing', 'svc:orders']));
    expect(focus.relations[0]).toMatchObject({
      consumer: 'billing',
      provider: 'orders',
      polarity: 'present',
      complete: true,
    });
    expect(focus.relations[0]?.uses).toBeGreaterThan(0);
    expect(new URLSearchParams(focus.query).get('focus')).toBe(focus.seed);

    // Si el mapa no tiene esos nodos, no hay foco.
    app.orgGraphs = { load: async () => ({ ok: true, graph: { nodes: [], edges: [] }, meta: {} }) };
    stubModel([
      {
        content: null,
        tool: 'submit_answer',
        args: {
          answer: 'x',
          claims: [
            { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
          ],
        },
      },
    ]);
    expect((await ask()).json().map_focus).toBeNull();
  });
});
