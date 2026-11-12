import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

const KEY = 'graphql:query:products';
const engine = {
  ...createLainMock(),
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
        bound_consumers: 1,
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
                {
                  binding: { confidence: 1, kind: 'static' },
                  endpoint: { key: KEY, service: 'api' },
                  fields: [],
                  caller: { repo: 'web', path: 'src/q.ts', line: 135 },
                },
              ],
            },
          ]
        : [],
  }),
  getCodeSnippet: async () => ({ text: '10: def list_products() products' }),
} as unknown as LainAdapter;

function stubModel() {
  let i = 0;
  vi.stubGlobal('fetch', async () => {
    const calls = [
      { name: 'search_code', args: { query: 'products' } },
      {
        name: 'submit_trace',
        args: {
          summary: 'products flows from the model to the UI',
          hops: [
            {
              id: 'h1',
              lane: 'api_handler',
              label: 'products resolver',
              repo: 'api',
              path: 'resolvers.py',
              line: 10,
              contains: 'products',
            },
          ],
          links: [{ from: 'h1', to: 'contract', relation: 'serves' }],
          sink: { hop: 'call1', kind: 'rendered' },
        },
      },
    ];
    const c = calls[Math.min(i, calls.length - 1)]!;
    return new Response(
      JSON.stringify({
        model: 'fake',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: `c${i++}`,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
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

const parseSse = (t: string) =>
  t
    .split('\n\n')
    .filter(Boolean)
    .map((b) => ({
      event: /^event: (.*)$/m.exec(b)?.[1] ?? '',
      data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? '{}') as Record<string, unknown>,
    }));

describe('POST /api/workspaces/:id/trace', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;
  const H = { authorization: 'Bearer t' };

  async function start(opts: { model?: boolean; lain?: boolean } = {}) {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
      ...(opts.model === false ? {} : { nebiusToken: 'tok' }),
    });
    app.lainClientFor = async () => engine;
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'ws', ...(opts.lain === false ? {} : { lainUrl: 'http://lain.test' }) },
    });
    wsId = (r.json() as { workspace: { id: string } }).workspace.id;
  }
  const trace = (url: string, key = KEY, headers: Record<string, string> = H) =>
    app.inject({ method: 'POST', url: `/api/workspaces/${wsId}${url}`, headers, payload: { key } });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-trace-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams the reads as they happen and ends with the verified trace', async () => {
    await start();
    stubModel();
    const r = await trace('/trace/stream');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/event-stream/);
    const events = parseSse(r.body);
    expect(events.filter((e) => e.data.type === 'tool').map((e) => e.data.tool)).toEqual([
      'search_code',
    ]);
    const result = events.at(-1);
    expect(result?.event).toBe('result');
    const t = result?.data as {
      status: string;
      hops: Array<{ id: string; origin: string; status: string }>;
      links: Array<{ from: string; to: string; basis: string }>;
      complete: boolean;
      seed: { key: string };
    };
    expect(t.status).toBe('available');
    expect(t.seed.key).toBe(KEY);
    expect(t.hops.map((h) => h.id).sort()).toEqual(['call1', 'contract', 'h1']);
    expect(t.hops.find((h) => h.id === 'h1')).toMatchObject({
      origin: 'model',
      status: 'verified',
    });
    expect(t.hops.find((h) => h.id === 'call1')).toMatchObject({ origin: 'engine' });
    expect(t.links.find((l) => l.to === 'call1')).toMatchObject({
      from: 'contract',
      basis: 'engine',
    });
    expect(t.links.find((l) => l.from === 'h1')).toMatchObject({ basis: 'asserted' });
    expect(t.complete).toBe(true);
  });

  it('the JSON route answers the same trace without a stream', async () => {
    await start();
    stubModel();
    const r = await trace('/trace');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'available', seed: { key: KEY, service: 'api' } });
  });

  it('calls native trace_flow with endpoint, direction, strategy, and bounds', async () => {
    await start();
    const r = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/trace/flow`,
      headers: H,
      payload: {
        from: { endpoint: { key: KEY, service: 'api' } },
        direction: 'downstream',
        strategy: 'breadth',
        depth: 2,
        cap: 5,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      direction: 'downstream',
      seeds: [KEY],
      paths: [],
      gaps: [{ kind: 'no_handler' }],
      truncated: false,
    });
  });

  it('streams the native trace_flow result and tool progress', async () => {
    await start();
    const r = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/trace/flow/stream`,
      headers: H,
      payload: {
        from: { symbol: 'products', repo_id: 'api' },
        strategy: 'depth',
        depth: 3,
      },
    });
    expect(r.statusCode).toBe(200);
    const events = parseSse(r.body);
    expect(events.some((event) => event.data.tool === 'trace_flow')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      event: 'result',
      data: { strategy: 'depth', seeds: ['products'], truncated: false },
    });
  });

  it('says why it cannot trace, before opening any stream: unknown contract, no model, no LAIN', async () => {
    await start();
    stubModel();
    const a = await trace('/trace/stream', 'graphql:query:ghost');
    expect(a.statusCode).toBe(404);
    expect(a.json()).toMatchObject({ code: 'ContractNotFound' });
    await app.close();
    await start({ model: false });
    const b = await trace('/trace/stream');
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ code: 'NoModel' });
    await app.close();
    await start({ lain: false });
    const c = await trace('/trace/stream');
    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ code: 'NoMap' });
  });

  it('is limited to 8 traces per hour per workspace, with Retry-After', async () => {
    await start();
    stubModel();
    for (let i = 0; i < 8; i++) expect((await trace('/trace')).statusCode).toBe(200);
    const r = await trace('/trace');
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBeTruthy();
  });

  it('needs a token', async () => {
    await start();
    expect((await trace('/trace/stream', KEY, {})).statusCode).toBe(401);
  });
});
