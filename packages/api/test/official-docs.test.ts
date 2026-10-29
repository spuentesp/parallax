// La lista de documentación oficial es de cada workspace y vive en la base de datos: se siembra
// con los valores por defecto, se amplía y se recorta por la API, y lo que cambia es lo que
// web_search usa en la siguiente pregunta. Todo por el camino real (rutas → tabla → consulta).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OFFICIAL_DOCS } from '../src/agent/web-search.js';
import { runMigrations } from '../src/db/migrate.js';
import { createOfficialDocsStore, InvalidOfficialDoc } from '../src/docs/official.js';
import { buildApp } from '../src/server.js';

describe('official docs store', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => db.close());

  it('seeds a workspace with the curated defaults on first read', () => {
    const store = createOfficialDocsStore(db);
    expect(store.forWorkspace('a')).toMatchObject({
      django: ['docs.djangoproject.com'],
      react: ['react.dev'],
    });
    expect(Object.keys(store.forWorkspace('a')).sort()).toEqual(
      Object.keys(DEFAULT_OFFICIAL_DOCS).sort(),
    );
  });

  it('a workspace edits its own list without touching another', () => {
    const store = createOfficialDocsStore(db);
    expect(store.add('a', 'billinglib', ['docs.corp.example.com'])).toBe(1);
    store.remove('a', 'react');
    expect(store.forWorkspace('a').billinglib).toEqual(['docs.corp.example.com']);
    expect(store.forWorkspace('a').react).toBeUndefined();
    expect(store.forWorkspace('b').billinglib).toBeUndefined();
    expect(store.forWorkspace('b').react).toEqual(['react.dev']);
  });

  it('adding the same domain twice is a no-op, and a domain can be removed alone', () => {
    const store = createOfficialDocsStore(db);
    expect(store.add('a', 'django', ['docs.djangoproject.com'])).toBe(0);
    store.add('a', 'django', ['django.example.org']);
    expect(store.remove('a', 'django', 'django.example.org')).toBe(1);
    expect(store.forWorkspace('a').django).toEqual(['docs.djangoproject.com']);
  });

  it('emptying the list on purpose does not bring the defaults back; reset does', () => {
    const store = createOfficialDocsStore(db);
    for (const word of Object.keys(DEFAULT_OFFICIAL_DOCS)) store.remove('a', word);
    expect(store.list('a')).toEqual([]);
    expect(store.forWorkspace('a')).toEqual({});
    store.reset('a');
    expect(store.forWorkspace('a').react).toEqual(['react.dev']);
  });

  it('rejects keywords and domains that are not what they claim to be', () => {
    const store = createOfficialDocsStore(db);
    expect(() => store.add('a', 'Bad Word!', ['x.example.com'])).toThrow(InvalidOfficialDoc);
    expect(() => store.add('a', 'okword', ['https://x.example.com/path'])).toThrow(
      InvalidOfficialDoc,
    );
    expect(() => store.add('a', 'okword', ['*.example.com'])).toThrow(InvalidOfficialDoc);
    expect(() => store.add('a', 'okword', [])).toThrow(InvalidOfficialDoc);
  });
});

describe('official docs through the API and web_search', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const R = { authorization: 'Bearer reader' };
  const W = { authorization: 'Bearer writer' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-official-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [
        { token: 'reader', orgId: 'o', scopes: ['read'] },
        { token: 'writer', orgId: 'o', scopes: ['read', 'write'] },
      ],
      webBundlePath: dir,
      nebiusToken: 'test-token',
      investigatorHandoff: 'off',
      tavilyApiKey: 'tvly-test',
      tavilyBaseUrl: 'http://tavily.test/search',
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (ws: string, headers = R) =>
    app.inject({ method: 'GET', url: `/api/workspaces/${ws}/official-docs`, headers });
  const post = (ws: string, payload: object, headers = W) =>
    app.inject({ method: 'POST', url: `/api/workspaces/${ws}/official-docs`, headers, payload });

  it('lists the seeded defaults for a read token; changing the list needs write scope', async () => {
    const list = (await get('ws1')).json();
    expect(list.count).toBeGreaterThan(30);
    expect(list.entries).toContainEqual({ word: 'django', domain: 'docs.djangoproject.com' });
    expect((await post('ws1', { word: 'x1', domains: ['a.example.com'] }, R)).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/api/workspaces/ws1/official-docs' })).statusCode,
    ).toBe(401);
  });

  it('adds, deduplicates, validates and deletes entries', async () => {
    expect(
      (await post('ws1', { word: 'acme', domains: ['docs.acme.example.com'] })).statusCode,
    ).toBe(201);
    expect(
      (await post('ws1', { word: 'acme', domains: ['docs.acme.example.com'] })).statusCode,
    ).toBe(200);
    expect((await post('ws1', { word: 'acme', domains: ['https://nope'] })).statusCode).toBe(400);
    expect((await get('ws1')).json().entries).toContainEqual({
      word: 'acme',
      domain: 'docs.acme.example.com',
    });
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/workspaces/ws1/official-docs/acme',
      headers: W,
    });
    expect(del.json()).toEqual({ removed: 1 });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/workspaces/ws1/official-docs/acme',
          headers: W,
        })
      ).statusCode,
    ).toBe(404);
    expect((await get('ws2')).json().entries).not.toContainEqual({
      word: 'acme',
      domain: 'docs.acme.example.com',
    });
  });

  it('a domain added through the API is what web_search restricts to on the next question', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let modelCalls = 0;
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (String(url).startsWith('http://tavily.test')) {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      modelCalls++;
      const call =
        modelCalls === 1
          ? { name: 'web_search', args: { query: 'acme retry policy' } }
          : {
              name: 'submit_answer',
              args: {
                answer: 'The web had nothing.',
                claims: [
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
                    id: `c${modelCalls}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
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
    await post('org_demo', { word: 'acme', domains: ['docs.acme.example.com'] });
    await app.inject({
      method: 'POST',
      url: '/api/query',
      headers: W,
      payload: { question: 'What does acme retry policy do?', orgId: 'org_demo' },
    });
    // La primera búsqueda se restringió al dominio que el workspace acababa de añadir.
    expect(bodies[0]).toMatchObject({
      include_domains: ['docs.acme.example.com'],
      include_domains_mode: 'restrict',
    });
  });
});
