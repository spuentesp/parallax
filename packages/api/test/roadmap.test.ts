// Preguntas que piden el recorrido de un dato o el radio de impacto: se reconocen, se
// resuelven a UN contrato, y la respuesta sale del motor (el radio) o del trazador.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { annotateRepos, toOrgGraph } from '../src/org-graph.js';
import { blastRadius, blastSentence } from '../src/roadmap/blast.js';
import { detectRoadmap } from '../src/roadmap/intent.js';
import { buildApp } from '../src/server.js';
import { buildEndpointTopology } from '../src/topology.js';

const P = 'graphql:query:products';
const O = 'graphql:mutation:products';
const use = (
  key: string,
  repo: string,
  path: string,
  line: number,
  kind: 'static' | 'heuristic',
) => ({
  binding: { confidence: kind === 'static' ? 1 : 0.5, kind },
  endpoint: { key, service: 'api' },
  fields: ['id'],
  caller: { repo, path, line },
});
const engine = {
  ...createLainMock(),
  listServices: async () => ({
    items: ['api', 'web', 'mobile', 'admin'].map((s) => ({
      service: s,
      repo: s,
      endpoints: s === 'web' ? 1 : s === 'api' ? 2 : 0,
      consumer_services: 1,
      unresolved_inbound: 0,
      paths: [],
    })),
    scope: { configured_only: true, reviewed: [], unreviewed: [] },
  }),
  listContracts: async () => ({
    items: [
      {
        endpoint: { key: P, service: 'api' },
        has_schema: false,
        bound_consumers: 2,
        providers: [{ repo: 'api', path: 'schema.graphql', line: 447 }],
      },
      {
        endpoint: { key: 'GET /api/cart', service: 'web' },
        has_schema: false,
        bound_consumers: 1,
        providers: [{ repo: 'web', path: 'src/cart.ts', line: 3 }],
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
                use(P, 'web', 'src/q.ts', 135, 'static'),
                use(P, 'web', 'src/q.ts', 164, 'static'),
              ],
            },
            {
              service: 'mobile',
              repo: 'mobile',
              uses: [use(P, 'mobile', 'app/q.ts', 7, 'heuristic')],
            },
          ]
        : service === 'web'
          ? [
              {
                service: 'admin',
                repo: 'admin',
                uses: [
                  {
                    ...use('GET /api/cart', 'admin', 'a.ts', 1, 'static'),
                    endpoint: { key: 'GET /api/cart', service: 'web' },
                  },
                ],
              },
            ]
          : [],
  }),
  getCodeSnippet: async () => ({ text: '10: def list_products() products' }),
} as unknown as LainAdapter;

const graph = async () =>
  annotateRepos(
    toOrgGraph(await buildEndpointTopology(engine)),
    new Set(['api', 'web', 'mobile', 'admin']),
  );

describe('detectRoadmap', () => {
  it('recognises a trace request that names one contract', async () => {
    const g = await graph();
    for (const q of [
      'Trace the products query end to end',
      'Follow the data of graphql:query:products from the database to the UI',
      'Give me the roadmap of products',
    ]) {
      expect(detectRoadmap(q, g), q).toEqual({
        kind: 'trace',
        key: P,
        service: 'api',
        candidates: [{ key: P, service: 'api' }],
      });
    }
  });

  it('recognises an impact request, and impact wins over trace words', async () => {
    const g = await graph();
    for (const q of [
      'What is the blast radius of changing the products query?',
      'what would break if I rename products',
      'Who is affected by graphql:query:products?',
    ]) {
      expect(detectRoadmap(q, g), q).toEqual({
        kind: 'blast',
        key: P,
        service: 'api',
        candidates: [{ key: P, service: 'api' }],
      });
    }
  });

  it('is silent when the question is not about a recognisable flow or names no contract', async () => {
    const g = await graph();
    expect(detectRoadmap('Who consumes the orders API?', g)).toBeNull();
    expect(detectRoadmap('Trace the checkout flow end to end', g)).toBeNull();
    expect(detectRoadmap('What is the blast radius of changing everything?', g)).toBeNull();
    // un nombre embebido en otra palabra no cuenta
    expect(detectRoadmap('trace reproductions end to end', g)).toBeNull();
  });

  it('when the name fits more than one contract it hands the candidates over, never guesses which', async () => {
    const extra = await graph();
    extra.nodes.push({
      id: 'ep:x',
      label: O,
      kind: 'endpoint',
      parent: extra.nodes.find((n) => n.id === 'ep:x')?.parent ?? null,
      meta: {},
    });
    const ambiguous = detectRoadmap('trace products end to end', extra);
    expect(ambiguous?.key).toBeNull();
    expect(ambiguous?.candidates.map((c) => c.key).sort()).toEqual([P, O].sort());
    // pero la clave completa desambigua
    expect(detectRoadmap(`trace ${O} end to end`, extra)?.key).toBe(O);
  });
});

describe('blastRadius — only what the engine recorded', () => {
  it('lists direct consumers with their uses, sites and provenance', async () => {
    const b = blastRadius(await graph(), P, 'api');
    expect(b?.direct.map((d) => [d.service, d.uses, d.provenance])).toEqual([
      ['web', 2, 'deterministic'],
      ['mobile', 1, 'inferred'],
    ]);
    expect(b?.direct[0]?.sites).toEqual([
      { repo: 'web', path: 'src/q.ts', line: 135 },
      { repo: 'web', path: 'src/q.ts', line: 164 },
    ]);
    expect(b?.totalUses).toBe(3);
    expect(b?.caveats.join(' ')).toMatch(/mobile is linked by inference/);
  });

  it('adds the second ring: services that depend on what the direct consumers provide', async () => {
    const b = blastRadius(await graph(), P, 'api');
    expect(b?.ripple).toEqual([{ service: 'admin', repo: 'admin', via: 'web', uses: 1 }]);
    expect(blastSentence(b!)).toMatch(
      /directly affects 2 services and 3 call sites.*Second ring: admin \(via web\)/,
    );
  });

  it('says plainly that no consumer was found, without claiming nobody calls it', async () => {
    const b = blastRadius(await graph(), 'GET /api/cart', 'web');
    expect(b?.direct.map((d) => d.service)).toEqual(['admin']);
    const none = blastRadius({ ...(await graph()), edges: [] }, P, 'api');
    expect(none?.direct).toEqual([]);
    expect(none?.caveats[0]).toMatch(/does not prove nobody calls it/);
    expect(blastSentence(none!)).toMatch(/no known consumer/);
  });

  it('an unknown contract is null', async () => {
    expect(blastRadius(await graph(), 'graphql:query:nope', 'api')).toBeNull();
  });
});

describe('POST /api/query — roadmap questions', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roadmap-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function start(model: boolean) {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
      ...(model ? { nebiusToken: 'tok' } : {}),
    });
    app.lainClientFor = async () => engine;
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'ws', lainUrl: 'http://lain.test' },
    });
    return (r.json() as { workspace: { id: string } }).workspace.id;
  }
  const ask = (orgId: string, question: string) =>
    app.inject({ method: 'POST', url: '/api/query', headers: H, payload: { orgId, question } });

  it('an impact question is answered from the engine, with the structured radius, and needs no model', async () => {
    const ws = await start(false);
    const res = await ask(ws, 'What is the blast radius of changing the products query?');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      answer: string;
      explanation_status: string;
      roadmap: { kind: string; blast: { key: string; direct: unknown[] } };
      conversation: { id: string } | null;
    };
    expect(body.explanation_status).toBe('available');
    expect(body.answer).toMatch(/directly affects 2 services and 3 call sites/);
    expect(body.roadmap.kind).toBe('blast');
    expect(body.roadmap.blast.key).toBe(P);
    expect(body.roadmap.blast.direct).toHaveLength(2);
    // y queda en la conversación
    expect(body.conversation).not.toBeNull();
  });

  it('the roadmap is stored with the turn: a restored conversation redraws it', async () => {
    const ws = await start(false);
    const res = await ask(ws, 'What is the blast radius of changing the products query?');
    const body = res.json() as { conversation: { id: string } | null };
    expect(body.conversation).not.toBeNull();

    const conv = await app.inject({
      method: 'GET',
      url: `/api/conversations/${body.conversation?.id}`,
      headers: H,
    });
    expect(conv.statusCode).toBe(200);
    const turns = (
      conv.json() as { turns: Array<{ roadmap?: { kind: string; blast: { key: string } } }> }
    ).turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.roadmap?.kind).toBe('blast');
    expect(turns[0]?.roadmap?.blast.key).toBe(P);
  });

  it('a trace question runs the tracer and returns the structured trace', async () => {
    const ws = await start(true);
    let i = 0;
    vi.stubGlobal('fetch', async () => {
      const calls = [
        { name: 'search_code', args: { query: 'products' } },
        {
          name: 'submit_trace',
          args: {
            summary: 'products flows from the resolver to the UI',
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
    const res = await ask(ws, 'Trace the products query end to end');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      answer: string;
      roadmap: {
        kind: string;
        trace: { hops: Array<{ id: string; status: string }>; status: string };
      };
    };
    expect(body.roadmap.kind).toBe('trace');
    expect(body.roadmap.trace.status).toBe('available');
    expect(body.roadmap.trace.hops.find((h) => h.id === 'h1')?.status).toBe('verified');
    expect(body.answer).toMatch(/products flows from the resolver to the UI/);
  });

  it('a question that names no contract does NOT take the roadmap path', async () => {
    const ws = await start(false);
    const res = await ask(ws, 'Who consumes the orders API?');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { roadmap?: unknown }).roadmap).toBeUndefined();
  });
});
