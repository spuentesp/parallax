// De punta a punta por /api/query: con clave de Tavily el modelo ve web_search, lo que la
// web devolvió se indexa y su cita se verifica; sin clave la herramienta no existe. Y el
// turno guarda la traza de la investigación. Sólo el borde de red es falso (fetch).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationTrace } from '../src/agent/trace-log.js';
import { buildApp } from '../src/server.js';

const PAGE = {
  title: 'QuerySet API reference | Django documentation',
  url: 'https://docs.djangoproject.com/en/5.0/ref/models/querysets/',
  content:
    'select_for_update() returns a queryset that will lock rows until the end of the transaction.',
  score: 0.9,
};

interface ModelRequest {
  tools?: Array<{ function: { name: string } }>;
  messages: Array<{ role: string; content: string | null }>;
}

/** El borde de red: Tavily y el modelo. El modelo busca en la web y luego cita lo que vio. */
function stubNetwork() {
  const modelRequests: ModelRequest[] = [];
  const tavilyBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (String(url).startsWith('http://tavily.test')) {
      tavilyBodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ results: [PAGE] }), { status: 200 });
    }
    const body = JSON.parse(init.body) as ModelRequest;
    modelRequests.push(body);
    const offered = body.tools?.some((t) => t.function.name === 'web_search') ?? false;
    const call =
      modelRequests.length === 1 && offered
        ? {
            name: 'web_search',
            arguments: { query: 'django select_for_update' },
          }
        : {
            name: 'submit_answer',
            arguments: {
              answer:
                'Per the Django docs, select_for_update locks rows until the transaction ends.',
              claims: offered
                ? [
                    {
                      kind: 'doc_quote',
                      repo: 'web',
                      path: PAGE.url,
                      section: PAGE.title,
                      quote: 'lock rows until the end of the transaction',
                      text: 'select_for_update locks rows for the transaction',
                    },
                  ]
                : [
                    {
                      kind: 'relation',
                      consumer: 'billing',
                      provider: 'orders',
                      polarity: 'present',
                    },
                  ],
            },
          };
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: `c${modelRequests.length}`,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  return { modelRequests, tavilyBodies };
}

describe('web search and trace through /api/query', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const A = { authorization: 'Bearer token-a' };

  async function start(withTavily: boolean) {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 'token-a', orgId: 'o', scopes: ['read'] }],
      webBundlePath: dir,
      nebiusToken: 'test-token',
      investigatorHandoff: 'off',
      ...(withTavily
        ? { tavilyApiKey: 'tvly-test', tavilyBaseUrl: 'http://tavily.test/search' }
        : {}),
    });
  }
  const ask = (question: string) =>
    app.inject({
      method: 'POST',
      url: '/api/query',
      headers: A,
      payload: { question, orgId: 'org_demo' },
    });
  const traceRows = () =>
    app.db.all<{ trace_json: string | null }>(sql`SELECT trace_json FROM turn`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-web-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('with a key: the model is offered web_search, the cited web quote is verified, and the trace is saved', async () => {
    const net = stubNetwork();
    await start(true);
    const r = await ask('What does select_for_update do in Django?');
    const body = r.json();
    expect(net.tavilyBodies).toHaveLength(1);
    expect(net.modelRequests[0]?.tools?.map((t) => t.function.name)).toContain('web_search');
    expect(body.explanation_status).toBe('available');
    const web = (body.claims as Array<{ claim: { kind: string }; verdict: string }>).find(
      (c) => c.claim.kind === 'doc_quote',
    );
    expect(web?.verdict).toBe('verified');

    // La traza salió del camino real y quedó en el turno.
    const [row] = traceRows();
    const trace = JSON.parse(row?.trace_json ?? 'null') as InvestigationTrace;
    expect(trace).toMatchObject({
      v: 1,
      webUsed: true,
      allVerified: true,
      questionType: 'orientation',
    });
    expect(trace.tools.map((t) => t.tool)).toEqual(['web_search', 'submit_answer']);
  });

  it('without a key: web_search is not offered and nothing leaves for Tavily', async () => {
    const net = stubNetwork();
    await start(false);
    await ask('What does select_for_update do in Django?');
    expect(net.modelRequests[0]?.tools?.map((t) => t.function.name)).not.toContain('web_search');
    expect(net.tavilyBodies).toHaveLength(0);
    const [row] = traceRows();
    expect(JSON.parse(row?.trace_json ?? 'null')).toMatchObject({ webUsed: false });
  });
});
