// POST /api/workspaces/:id/contracts/recommendations, de punta a punta: el servicio
// de loose-ends, la autenticación y la base de datos son los reales. Fuera del
// proceso sólo hay dos cosas falsas: el motor (adaptador) y la red del modelo (fetch).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import type { RecommendationsDto } from '../src/recommendations/types.js';
import { buildApp } from '../src/server.js';

const ENTRY = `- consumer:
    repo: web
    path: src/a.ts
    symbol: POST /a
    key: http:POST /a
  provider:
    service: api
    key: http:POST /a
`;

const engine = (): LainAdapter =>
  ({
    ...createLainMock(),
    listUnresolved: async () => ({
      items: [
        {
          reason: 'no_match',
          method: 'POST',
          url_expr: 'POST /a',
          consumer: {
            id: 'web:Function:src/a.ts:call:10',
            repo: 'web',
            path: 'src/a.ts',
            line: 10,
          },
          candidates: [
            { endpoint: { key: 'http:POST /a', service: 'api' }, reason: 'pattern' },
            { endpoint: { key: 'http:POST /b', service: 'api' }, reason: 'pattern' },
          ],
        },
      ],
      ambiguous: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listServices: async () => ({
      items: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    checkBinding: async (req: { endpoint: { key: string } }) =>
      req.endpoint.key === 'http:POST /a'
        ? {
            valid: true,
            reasons: [],
            method_match: true,
            template_match: 'exact',
            bindings_entry: ENTRY,
          }
        : {
            valid: false,
            reasons: ['template_mismatch'],
            method_match: true,
            template_match: 'none',
          },
    getCodeSnippet: async () => ({ text: 'await fetch(url)' }),
  }) as unknown as LainAdapter;

describe('POST /contracts/recommendations', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };

  async function start(nebiusToken?: string) {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 't', orgId: 'o', scopes: ['read', 'write'] },
        { token: 'ro', orgId: 'o', scopes: ['read'] },
      ],
      webBundlePath: dir,
      ...(nebiusToken ? { nebiusToken } : {}),
    });
    app.lainClientFor = async () => engine();
  }
  const workspace = async (lainUrl?: string) =>
    (
      (
        await app.inject({
          method: 'POST',
          url: '/api/workspaces',
          headers: H,
          payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
        })
      ).json() as { workspace: { id: string } }
    ).workspace.id;
  const recommend = async (id: string, headers: Record<string, string> = H) =>
    app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/contracts/recommendations`,
      headers,
      payload: {},
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-recs-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('turns an engine-validated candidate into a declaration the remediation accepts', async () => {
    await start();
    const id = await workspace('http://lain.test');
    const r = await recommend(id);
    expect(r.statusCode).toBe(200);
    const body = r.json() as RecommendationsDto;
    expect(body.source).toBe('lain');
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0]).toMatchObject({
      kind: 'binding',
      basis: 'engine_verified',
      declaration: {
        consumer: { repo: 'web', path: 'src/a.ts', key: 'http:POST /a' },
        provider: { service: 'api', key: 'http:POST /a' },
      },
    });
    expect(body.model.note).toMatch(/No model is configured/);
  });

  it('is readable with a read-only token, and needs a token at all', async () => {
    await start();
    const id = await workspace('http://lain.test');
    expect((await recommend(id, { authorization: 'Bearer ro' })).statusCode).toBe(200);
    expect((await recommend(id, {})).statusCode).toBe(401);
  });

  it('a workspace with no LAIN server says so', async () => {
    await start();
    const id = await workspace();
    expect((await recommend(id)).json()).toMatchObject({
      source: 'unconfigured',
      recommendations: [],
    });
  });

  it('with a model it asks once per batch, attaches its reading, and caps model runs per hour', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> };
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      asked.push(user);
      const m = /id: (\w+)/.exec(user);
      return new Response(
        JSON.stringify({
          model: 'fake/nemotron',
          choices: [
            {
              message: { content: JSON.stringify([{ id: m?.[1], rationale: 'It posts to /a.' }]) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await start('tok');
    const id = await workspace('http://lain.test');
    const first = (await recommend(id)).json() as RecommendationsDto;
    expect(first.model.used).toBe(true);
    expect(first.recommendations[0]?.rationale).toBe('It posts to /a.');
    // El código que se envía al modelo es el del sitio, no el repositorio entero.
    expect(asked[0]).toContain('await fetch(url)');

    for (let i = 0; i < 5; i++) await recommend(id);
    const calls = asked.length;
    const capped = (await recommend(id)).json() as RecommendationsDto;
    expect(asked.length).toBe(calls); // el 7.º no llama al modelo
    expect(capped.model.note).toMatch(/limit for this hour/);
    // Pero lo que valida el motor sigue ahí.
    expect(capped.recommendations).toHaveLength(1);
    expect(capped.recommendations[0]?.rationale).toBeNull();
  });

  it('two requests at once share one run instead of loading the engine twice', async () => {
    await start();
    const id = await workspace('http://lain.test');
    let checks = 0;
    const base = engine();
    app.lainClientFor = async () =>
      ({
        ...base,
        checkBinding: async (req: Parameters<LainAdapter['checkBinding']>[0]) => {
          checks++;
          await new Promise((r) => setTimeout(r, 50));
          return base.checkBinding(req);
        },
      }) as unknown as LainAdapter;
    const [a, b] = await Promise.all([recommend(id), recommend(id)]);
    expect(a.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    // Un solo sitio con dos candidatos: dos comprobaciones, no cuatro.
    expect(checks).toBe(2);
  });
});
