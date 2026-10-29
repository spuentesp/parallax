// La búsqueda web (Tavily) es una fuente más, subordinada a los hechos de LAIN: sin clave
// no existe, sale limpia de nombres internos, va primero a la documentación oficial, y lo
// que el modelo ve se indexa y se cita con el mismo verificador de citas de documentación.
// Sólo el borde del proceso es falso: el transporte HTTP. Todo lo demás es el camino real.

import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Claim, verifyClaims } from '../src/agent/claims.js';
import { createDispatcher } from '../src/agent/dispatcher.js';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import {
  createTavilySearch,
  isOfficial,
  officialDomainsFor,
  scrubQuery,
  WEB_REPO,
} from '../src/agent/web-search.js';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { findDocSections, indexWebPages } from '../src/docs/index.js';
import { createLainMock } from '../src/lain-adapter/mock.js';

const WS = 'ws';
const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const DJANGO = {
  title: 'QuerySet API reference | Django documentation',
  url: 'https://docs.djangoproject.com/en/5.0/ref/models/querysets/',
  content:
    'select_for_update() returns a queryset that will lock rows until the end of the transaction, generating a SELECT ... FOR UPDATE SQL statement on supported databases.',
  score: 0.9,
  published_date: '2024-05-01',
};
const BLOG = {
  title: 'Locking rows, a blog post',
  url: 'https://random-blog.example.com/locks',
  content: 'You can lock rows in many ways.',
  score: 0.95,
};

/** El borde del proceso: un Tavily de mentira que guarda lo que recibe. */
function fakeTavily(results: object[], status = 200) {
  const requests: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      auth: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ results }), { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe('Tavily client', () => {
  it('posts the query with the bearer key, prefers the given official domains, orders official first', async () => {
    const { fetchImpl, requests } = fakeTavily([BLOG, DJANGO]);
    const search = createTavilySearch({ apiKey: 'tvly-k', fetch: fetchImpl });
    const pages = await search('select_for_update', { domains: ['docs.djangoproject.com'] });
    expect(requests[0]).toMatchObject({
      url: 'https://api.tavily.com/search',
      auth: 'Bearer tvly-k',
      body: {
        query: 'select_for_update',
        include_domains: ['docs.djangoproject.com'],
        include_domains_mode: 'prefer',
      },
    });
    // Tavily puso el blog antes (mejor score), pero lo oficial va primero.
    expect(pages.map((p) => p.official)).toEqual([true, false]);
    expect(pages[0]?.publishedDate).toBe('2024-05-01');
  });

  it('fails loudly on an HTTP error instead of returning nothing', async () => {
    const { fetchImpl } = fakeTavily([], 401);
    await expect(createTavilySearch({ apiKey: 'bad', fetch: fetchImpl })('q q q')).rejects.toThrow(
      /HTTP 401/,
    );
  });

  it('maps library words to official domains and recognises official URLs', () => {
    expect(officialDomainsFor('How does Django handle select_for_update with Celery?')).toEqual([
      'docs.djangoproject.com',
      'docs.celeryq.dev',
    ]);
    expect(officialDomainsFor('something nobody documents')).toEqual([]);
    expect(isOfficial('https://docs.djangoproject.com/en/5.0/')).toBe(true);
    expect(isOfficial('https://react.dev/learn')).toBe(true);
    expect(isOfficial('https://evil-react.dev.example.com/')).toBe(false);
  });
});

describe('query scrubber', () => {
  it('removes workspace-internal names, paths, ids, emails and URLs; keeps the public topic', () => {
    const q = scrubQuery(
      'How does billing-api use Django select_for_update in saleor/payment/gateway.py? ask ana@corp.com 3f2b8c1e-1111-4222-8333-444455556666 https://internal.corp/x',
      ['billing-api', 'saleor'],
    );
    expect(q).toBe('How does use Django select_for_update in ask');
    expect(q).not.toMatch(/billing|saleor|gateway|corp|3f2b8c1e/);
  });

  it('returns null when nothing public is left', () => {
    expect(scrubQuery('billing-api', ['billing-api'])).toBeNull();
    expect(scrubQuery('src/a/b.ts', [])).toBeNull();
  });
});

describe('web_search in the dispatcher', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => db.close());

  const wire = (results: object[]) => {
    const tav = fakeTavily(results);
    const search = createTavilySearch({ apiKey: 'k', fetch: tav.fetchImpl });
    const d = createDispatcher({
      lain: createLainMock(),
      view: 'live',
      web: {
        search,
        domainsFor: (q: string) => officialDomainsFor(q),
        ingest: (pages) => indexWebPages(db, WS, WEB_REPO, pages),
      },
    });
    return { d, ...tav };
  };

  it('is absent without a search backend: not offered, and refused if the model asks anyway', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    expect(d.toolSpecs().map((s) => s.function.name)).not.toContain('web_search');
    const r = await d.execute(call('w', 'web_search', { query: 'django select_for_update' }));
    expect(r).toMatchObject({ ok: false, code: 'unknown_tool' });
  });

  it('is offered when configured, and the key comes only from the config reader', () => {
    const { d } = wire([]);
    expect(d.toolSpecs().map((s) => s.function.name)).toContain('web_search');
    const env = { PARALLAX_TOKENS: '[{"token":"t","orgId":"o","scopes":["read"]}]' };
    expect(loadConfig({ ...env, TAVILY_TOKEN: 'tvly-x' }).tavilyApiKey).toBe('tvly-x');
    expect(loadConfig({ ...env, TAVILY_TOKEN: '  ' }).tavilyApiKey).toBeUndefined();
  });

  it('strips catalog names from the outgoing query and restricts to the official domain', async () => {
    const { d, requests } = wire([DJANGO]);
    const r = await d.execute(
      call('w', 'web_search', { query: 'how does billing use Django select_for_update' }),
    );
    expect(r.ok).toBe(true);
    const sent = requests[0]?.body;
    expect(String(sent?.query)).not.toMatch(/billing/i);
    expect(sent).toMatchObject({
      include_domains: ['docs.djangoproject.com'],
      include_domains_mode: 'restrict',
    });
  });

  it('does not call the web when the query is only internal names', async () => {
    const { d, requests } = wire([DJANGO]);
    const r = await d.execute(call('w', 'web_search', { query: 'billing' }));
    expect(r.ok).toBe(true);
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(r.ok && r.data)).toMatch(/Nothing left to search/);
  });

  it('widens to the whole web once when the official filter finds nothing', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return new Response(JSON.stringify({ results: body.include_domains ? [] : [BLOG] }));
    }) as typeof fetch;
    const d = createDispatcher({
      lain: createLainMock(),
      view: 'live',
      web: {
        search: createTavilySearch({ apiKey: 'k', fetch: fetchImpl }),
        domainsFor: (q: string) => officialDomainsFor(q),
        ingest: (pages) => indexWebPages(db, WS, WEB_REPO, pages),
      },
    });
    const r = await d.execute(call('w', 'web_search', { query: 'django exotic thing' }));
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.include_domains).toBeUndefined();
    expect(JSON.stringify(r.ok && r.data)).toContain('[third-party]');
  });

  it('is capped at two calls per investigation', async () => {
    const { d } = wire([DJANGO]);
    expect((await d.execute(call('1', 'web_search', { query: 'django one' }))).ok).toBe(true);
    expect((await d.execute(call('2', 'web_search', { query: 'django two' }))).ok).toBe(true);
    expect(await d.execute(call('3', 'web_search', { query: 'django three' }))).toMatchObject({
      ok: false,
      code: 'tool_cap',
    });
  });

  it('a Tavily failure is a typed error the model sees, not an empty result', async () => {
    const { fetchImpl } = fakeTavily([], 500);
    const d = createDispatcher({
      lain: createLainMock(),
      view: 'live',
      web: {
        search: createTavilySearch({ apiKey: 'k', fetch: fetchImpl }),
        domainsFor: (q: string) => officialDomainsFor(q),
        ingest: () => undefined,
      },
    });
    const r = await d.execute(call('w', 'web_search', { query: 'django something' }));
    expect(r).toMatchObject({ ok: false, code: 'engine_error' });
    expect(!r.ok && r.message).toMatch(/web search web_search failed.*HTTP 500/);
  });
});

describe('citing what the web said (write → read)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => db.close());

  const deps = () => ({
    lain: createLainMock(),
    view: 'live' as const,
    resolveService: async () => null,
    validateRefs: async () => ({ accepted: [], receipts: [], rejected: [] }),
    hasRepo: async () => true,
    docSection: (repo: string, path: string, section: string) =>
      findDocSections(db, WS, repo, path, section),
  });
  const quote = (over: object = {}) =>
    Claim.parse({
      kind: 'doc_quote',
      repo: WEB_REPO,
      path: DJANGO.url,
      section: DJANGO.title,
      quote: 'lock rows until the end of the transaction',
      text: 'Django documents that select_for_update locks rows until the transaction ends',
      ...over,
    });

  async function searchThroughDispatcher(): Promise<void> {
    const tav = fakeTavily([DJANGO]);
    const d = createDispatcher({
      lain: createLainMock(),
      view: 'live',
      web: {
        search: createTavilySearch({ apiKey: 'k', fetch: tav.fetchImpl }),
        domainsFor: (q: string) => officialDomainsFor(q),
        ingest: (pages) => indexWebPages(db, WS, WEB_REPO, pages),
      },
    });
    expect(
      (await d.execute(call('w', 'web_search', { query: 'django select_for_update' }))).ok,
    ).toBe(true);
  }

  it('a quote from a result the model was shown verifies', async () => {
    await searchThroughDispatcher();
    const [r] = await verifyClaims([quote()], deps());
    expect(r?.verdict).toBe('verified');
  });

  it('an abbreviated title still verifies: a web page is one section, the phrase decides', async () => {
    await searchThroughDispatcher();
    const [r] = await verifyClaims([quote({ section: 'QuerySet API reference' })], deps());
    expect(r?.verdict).toBe('verified');
  });

  it('a quote that is not in the shown text is contradicted', async () => {
    await searchThroughDispatcher();
    const [r] = await verifyClaims([quote({ quote: 'rows are locked forever' })], deps());
    expect(r?.verdict).toBe('contradicted');
  });

  it('a URL the web never returned is contradicted: citations cannot be invented', async () => {
    await searchThroughDispatcher();
    const [r] = await verifyClaims(
      [quote({ path: 'https://docs.djangoproject.com/en/5.0/made-up/' })],
      deps(),
    );
    expect(r?.verdict).toBe('contradicted');
    expect(r?.reason).toMatch(/not a documentation file/);
  });
});

describe('investigator with web search', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => db.close());

  const resp = (toolCalls: ToolCall[], content: string | null = null): NemotronResponse => ({
    content,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: { promptTokens: 10, completionTokens: 5 },
    model: 'fake',
    latencyMs: 1,
  });
  class Scripted implements ChatCompleter {
    readonly seen: ChatMessage[][] = [];
    constructor(private readonly script: NemotronResponse[]) {}
    async complete(messages: ChatMessage[]): Promise<NemotronResponse> {
      this.seen.push(structuredClone(messages));
      const next = this.script.shift();
      if (!next) throw new Error('script exhausted');
      return next;
    }
  }

  const web = () => {
    const tav = fakeTavily([DJANGO]);
    return {
      search: createTavilySearch({ apiKey: 'k', fetch: tav.fetchImpl }),
      domainsFor: (q: string) => officialDomainsFor(q),
      ingest: (pages: Array<{ url: string; title: string; content: string }>) =>
        indexWebPages(db, WS, WEB_REPO, pages),
    };
  };
  const docsSection = (repo: string, path: string, section: string) =>
    findDocSections(db, WS, repo, path, section);

  it('searches, cites the result, and the stage is observable with a verified web claim', async () => {
    const model = new Scripted([
      resp([call('w', 'web_search', { query: 'django select_for_update' })]),
      resp([
        call('s', 'submit_answer', {
          answer: 'Per the Django docs, select_for_update locks rows until the transaction ends.',
          claims: [
            {
              kind: 'doc_quote',
              repo: WEB_REPO,
              path: DJANGO.url,
              section: DJANGO.title,
              quote: 'lock rows until the end of the transaction',
              text: 'select_for_update locks rows for the transaction',
            },
          ],
        }),
      ]),
    ]);
    const result = await investigate({
      question: 'What does select_for_update do in Django?',
      lain: createLainMock(),
      model,
      web: web(),
      docsSection,
    });
    expect(result.toolCallLog.map((t) => t.tool)).toContain('web_search');
    expect(result.toolCallLog.find((t) => t.tool === 'web_search')?.ok).toBe(true);
    expect(result.claims[0]?.verdict).toBe('verified');
    // El modelo vio el resultado Y las instrucciones de las tres voces.
    const toolMsg = JSON.stringify(model.seen[1]);
    expect(toolMsg).toContain('[official]');
    expect(toolMsg).toContain('only for what the engine or the code showed');
  });

  it('bounces once an answer that invokes official docs without ever searching the web', async () => {
    const model = new Scripted([
      resp([call('l', 'list_services', {})]),
      resp([
        call('s1', 'submit_answer', {
          answer: 'According to the official documentation, select_for_update locks rows.',
        }),
      ]),
      resp([call('w', 'web_search', { query: 'django select_for_update' })]),
      resp([call('s2', 'submit_answer', { answer: 'Per the Django docs it locks rows.' })]),
    ]);
    const result = await investigate({
      question: 'What does select_for_update do in Django?',
      lain: createLainMock(),
      model,
      web: web(),
      docsSection,
    });
    expect(JSON.stringify(model.seen[2])).toContain('web_search was never called');
    expect(result.toolCallLog.some((t) => t.tool === 'web_search' && t.ok)).toBe(true);
  });

  it('bounces once an answer that searched the web but cites nothing from it', async () => {
    const model = new Scripted([
      resp([call('w', 'web_search', { query: 'django select_for_update' })]),
      resp([call('s1', 'submit_answer', { answer: 'select_for_update locks rows.' })]),
      resp([
        call('s2', 'submit_answer', {
          answer: 'Per the Django docs, select_for_update locks rows until the transaction ends.',
          claims: [
            {
              kind: 'doc_quote',
              repo: WEB_REPO,
              path: DJANGO.url,
              section: DJANGO.title,
              quote: 'lock rows until the end of the transaction',
              text: 'select_for_update locks rows',
            },
          ],
        }),
      ]),
    ]);
    const result = await investigate({
      question: 'What does select_for_update do in Django?',
      lain: createLainMock(),
      model,
      web: web(),
      docsSection,
    });
    expect(JSON.stringify(model.seen[2])).toContain('cites nothing from it');
    expect(result.claims.find((c) => c.claim.kind === 'doc_quote')?.verdict).toBe('verified');
  });

  it('without a web backend the same words are not policed and the tool is never offered', async () => {
    const model = new Scripted([
      resp([call('l', 'list_services', {})]),
      resp([
        call('s1', 'submit_answer', { answer: 'According to the official documentation, X.' }),
      ]),
    ]);
    await investigate({ question: 'q', lain: createLainMock(), model });
    expect(JSON.stringify(model.seen)).not.toContain('web_search was never called');
  });
});

describe('result cleanup inside official domains', () => {
  const page = (url: string, over: object = {}) => ({
    title: url,
    url,
    content: 'some text about the topic',
    score: 0.8,
    published_date: null,
    ...over,
  });

  it('drops translations, rendered source, downloads and #fragment duplicates; ranks stale versions and release notes last', async () => {
    const { fetchImpl } = fakeTavily([
      page('https://docs.djangoproject.com/pt-br/2.2/_modules/django/db/models/query', {
        score: 0.99,
      }),
      page('https://docs.djangoproject.com/fr/5.0/ref/models/querysets/', { score: 0.98 }),
      page('https://docs.celeryq.dev/_/downloads/kombu/en/v5.2.1/pdf', { score: 0.97 }),
      page('https://docs.djangoproject.com/en/6.1/releases/1.4/', { score: 0.95 }),
      page('https://docs.djangoproject.com/en/2.0/ref/databases/', { score: 0.94 }),
      page('https://docs.djangoproject.com/en/6.1/ref/databases/', { score: 0.7 }),
      page('https://docs.djangoproject.com/en/6.1/ref/models/querysets/#select-for-update', {
        score: 0.8,
        content: 'a longer snippet about select_for_update and the transaction',
      }),
      page('https://docs.djangoproject.com/en/6.1/ref/models/querysets/', { score: 0.8 }),
    ]);
    const pages = await createTavilySearch({ apiKey: 'k', fetch: fetchImpl })('q', { limit: 8 });
    expect(pages.map((p) => p.url)).toEqual([
      'https://docs.djangoproject.com/en/6.1/ref/models/querysets/',
      'https://docs.djangoproject.com/en/6.1/ref/databases/',
      'https://docs.djangoproject.com/en/6.1/releases/1.4/',
    ]);
    // La misma página por #ancla se fundió en una, la de más texto.
    expect(pages[0]?.content).toContain('longer snippet');
  });

  it('the same page in two versions keeps the current one', async () => {
    const { fetchImpl } = fakeTavily([
      page('https://docs.example-lib.dev/en/v1.2.0/guide/retry', { score: 0.9 }),
      page('https://docs.example-lib.dev/en/stable/guide/retry', { score: 0.8 }),
    ]);
    const pages = await createTavilySearch({ apiKey: 'k', fetch: fetchImpl })('q');
    expect(pages.map((p) => p.url)).toEqual(['https://docs.example-lib.dev/en/stable/guide/retry']);
  });

  it('uses advanced depth only when restricted to official domains, and over-requests to have room after cleanup', async () => {
    const { fetchImpl, requests } = fakeTavily([DJANGO]);
    const search = createTavilySearch({ apiKey: 'k', fetch: fetchImpl });
    await search('django x', { domains: ['docs.djangoproject.com'], mode: 'restrict', limit: 4 });
    await search('something open');
    expect(requests[0]?.body).toMatchObject({ search_depth: 'advanced', max_results: 8 });
    expect(requests[1]?.body).toMatchObject({ search_depth: 'basic' });
    expect(requests[1]?.body.include_domains).toBeUndefined();
  });
});

describe('relay mode: the writer attributes what the worker searched', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => db.close());

  it('the writer is told about the web results and is bounced once if its answer cites none', async () => {
    const seen: ChatMessage[][] = [];
    const resp = (toolCalls: ToolCall[]): NemotronResponse => ({
      content: null,
      toolCalls,
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1 },
      model: 'fake',
      latencyMs: 1,
    });
    const quoteClaim = {
      kind: 'doc_quote',
      repo: WEB_REPO,
      path: DJANGO.url,
      section: DJANGO.title,
      quote: 'lock rows until the end of the transaction',
      text: 'select_for_update locks rows',
    };
    // planner (plan) -> worker (search, draft) -> writer (uncited, then cited)
    const script = [
      resp([call('p', 'submit_plan', { goal: 'explain select_for_update', steps: [] })]),
      resp([call('w', 'web_search', { query: 'django select_for_update' })]),
      resp([call('d', 'submit_answer', { answer: 'draft: it locks rows' })]),
      resp([call('w1', 'submit_answer', { answer: 'It locks rows.' })]),
      resp([
        call('w2', 'submit_answer', {
          answer: 'Per the Django docs it locks rows.',
          claims: [quoteClaim],
        }),
      ]),
    ];
    const model: ChatCompleter = {
      async complete(messages) {
        seen.push(structuredClone(messages));
        const next = script.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
    };
    const tav = fakeTavily([DJANGO]);
    const result = await investigate({
      question: 'What does select_for_update do in Django?',
      lain: createLainMock(),
      model,
      handoff: true,
      web: {
        search: createTavilySearch({ apiKey: 'k', fetch: tav.fetchImpl }),
        domainsFor: (q: string) => officialDomainsFor(q),
        ingest: (pages) => indexWebPages(db, WS, WEB_REPO, pages),
      },
      docsSection: (repo, path, section) => findDocSections(db, WS, repo, path, section),
    });
    // El escritor recibió la instrucción de atribuir la web, y la respuesta sin cita volvió una vez.
    expect(JSON.stringify(seen[3])).toContain('The worker searched the web');
    expect(JSON.stringify(seen[4])).toContain('cites nothing from it');
    expect(result.answer).toBe('Per the Django docs it locks rows.');
    expect(result.claims.find((c) => c.claim.kind === 'doc_quote')?.verdict).toBe('verified');
  });
});
