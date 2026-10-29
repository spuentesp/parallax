// De punta a punta: el veredicto se escribe por POST /loose-ends/assess (camino
// real: recolectar → agrupar → lotes al modelo → validar → guardar) y se lee por
// GET. Fuera del proceso sólo hay dos cosas falsas: el motor (adaptador) y la
// red del modelo (fetch).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import type { LooseEndsReport } from '../src/loose-ends/service.js';
import { buildApp } from '../src/server.js';

type Item = { reason: string; path: string; line: number };

function engine(items: Item[], snippets: Record<string, string> = {}) {
  const base = createLainMock();
  return {
    ...base,
    listUnresolved: async () => ({
      items: items.map((i) => ({
        reason: i.reason,
        method: 'GET',
        url_expr: `GET ${i.path}`,
        consumer: { repo: 'web', path: i.path, line: i.line },
        candidates: [],
      })),
      ambiguous: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listServices: async () => ({
      items: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    getCodeSnippet: async (req: { path: string }) => ({
      text: snippets[req.path] ?? `// code of ${req.path}\nfetch(url)`,
    }),
  } as unknown as LainAdapter;
}

interface Sent {
  model?: string;
  max_tokens?: number;
  chat_template_kwargs?: { enable_thinking?: boolean };
  messages: Array<{ role: string; content: string }>;
}

/** Responde a cada lote con `answer(ids)`; devuelve lo que se envió. */
function stubModel(answer: (cases: Array<{ id: string; site: string }>) => unknown[] | Error) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Sent;
    sent.push(body);
    const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
    const cases = [...user.matchAll(/id: (\w+)\nsite: (\S+)/g)].map((m) => ({
      id: m[1] as string,
      site: (m[2] as string).replace(/^web:/, ''),
    }));
    const r = answer(cases);
    if (r instanceof Error) return new Response('boom', { status: 500 });
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [{ message: { content: JSON.stringify(r) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 77 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  return sent;
}
const verdictFor = (c: { id: string; site: string }, over: object = {}) => ({
  id: c.id,
  category: 'external_call',
  reason: 'calls an external service',
  evidence: c.site,
  ...over,
});

describe('loose ends', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;
  const H = { authorization: 'Bearer t' };
  let current: LainAdapter;

  async function start(nebiusToken: string | null = 'tok') {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
      ...(nebiusToken ? { nebiusToken } : {}),
    });
    app.lainClientFor = async () => current;
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'ws', lainUrl: 'http://lain.test' },
    });
    wsId = (r.json() as { workspace: { id: string } }).workspace.id;
  }
  const get = async (refresh = false) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/workspaces/${wsId}/loose-ends${refresh ? '?refresh=1' : ''}`,
        headers: H,
      })
    ).json() as LooseEndsReport;
  const assess = async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/loose-ends/assess`,
      headers: H,
    });
    await app.looseEnds.idle(wsId);
    return r;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-loose-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('before any model run: tests/tooling are classified by path, the rest waits, nothing is invented', async () => {
    current = engine([
      { reason: 'no_match', path: 'e2e/lib/docker.ts', line: 7 },
      { reason: 'no_match', path: 'src/graphql/authFetch.ts', line: 138 },
    ]);
    await start();
    const r = await get();
    expect(r.source).toBe('lain');
    expect(r.summary).toMatchObject({ total: 2, pendingCases: 1 });
    expect(r.summary.byCategory.test_or_tooling).toBe(1);
    const e2e = r.items.find((i) => i.path === 'e2e/lib/docker.ts');
    expect(e2e?.assessment).toMatchObject({ category: 'test_or_tooling', source: 'rule' });
    expect(r.items.find((i) => i.path === 'src/graphql/authFetch.ts')?.assessment).toBeNull();
  });

  it("rules decide what the path or the engine's own reason already says, with no model call", async () => {
    current = engine([
      { reason: 'dynamic_topic', path: 'saleor/checkout/tasks.py', line: 206 },
      { reason: 'no_match', path: 'scripts/x.mjs', line: 5 },
    ]);
    await start();
    const sent = stubModel(() => []);
    const r = await get();
    expect(r.summary.pendingCases).toBe(0);
    expect(r.items.find((i) => i.path.endsWith('tasks.py'))?.assessment).toMatchObject({
      category: 'dynamic_target',
      source: 'rule',
    });
    await assess();
    expect(sent).toHaveLength(0); // nada que juzgar: ni una llamada al modelo
  });

  it('assessing writes verdicts that the next read returns, labelled as a model assessment', async () => {
    current = engine([{ reason: 'no_match', path: 'src/graphql/authFetch.ts', line: 138 }]);
    await start();
    stubModel((cases) => cases.map((c) => verdictFor(c)));
    expect((await assess()).statusCode).toBe(202);
    const r = await get();
    const a = r.items[0]?.assessment;
    expect(a).toMatchObject({
      category: 'external_call',
      source: 'model',
      evidence: 'src/graphql/authFetch.ts:138',
    });
    expect(a?.model).toBeTruthy();
    expect(r.summary.pendingCases).toBe(0);
    expect(r.run.state).toBe('done');
  });

  it('batches: 25 cases are 5 model calls of 5, not 25; sites of one file and reason are one case', async () => {
    const items: Item[] = Array.from({ length: 25 }, (_, i) => ({
      reason: 'no_match',
      path: `src/f${i}.ts`,
      line: 1,
    }));
    // Tres sitios más en el MISMO archivo y motivo: un solo caso.
    items.push(
      { reason: 'no_match', path: 'src/f0.ts', line: 50 },
      { reason: 'no_match', path: 'src/f0.ts', line: 60 },
    );
    current = engine(items);
    await start();
    const sent = stubModel((cases) => cases.map((c) => verdictFor(c)));
    await assess();
    expect(sent).toHaveLength(5); // 25 casos / 5 por lote
    const r = await get();
    expect(r.summary.total).toBe(27);
    expect(r.summary.pendingCases).toBe(0);
    // Los 3 sitios de f0.ts comparten veredicto.
    expect(
      r.items
        .filter((i) => i.path === 'src/f0.ts')
        .every((i) => i.assessment?.category === 'external_call'),
    ).toBe(true);
  });

  it('sends the code snippet and the engine facts, and tells the model what it may and may not do', async () => {
    current = engine([{ reason: 'no_match', path: 'saleor/tasks.py', line: 206 }], {
      'saleor/tasks.py': 'topic = f"orders.{kind}"\nbus.read(topic)',
    });
    await start();
    const sent = stubModel((cases) =>
      cases.map((c) => verdictFor(c, { category: 'dynamic_target' })),
    );
    await assess();
    const system = sent[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = sent[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(system).toMatch(/Prefer this over guessing/);
    expect(system).toMatch(/Never invent endpoints/);
    expect(user).toMatch(/engine reason: no_match/);
    expect(user).toContain('topic = f"orders.{kind}"');
    // Los casos de tests no cuestan modelo: sólo esto se envió.
    expect(sent).toHaveLength(1);
  });

  it('a verdict that cites some other location is not believed and not saved: the case stays pending', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }]);
    await start();
    stubModel((cases) => cases.map((c) => verdictFor(c, { evidence: 'src/zzz.ts:1' })));
    await assess();
    const r = await get();
    expect(r.items[0]?.assessment).toBeNull();
    expect(r.summary.pendingCases).toBe(1);
  });

  it('a genuine "unclear" from the model IS saved (it is an answer)', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }]);
    await start();
    const sent = stubModel((cases) =>
      cases.map((c) => verdictFor(c, { category: 'unclear', reason: 'snippet too short' })),
    );
    await assess();
    await assess();
    expect(sent).toHaveLength(1);
    expect((await get()).items[0]?.assessment).toMatchObject({
      category: 'unclear',
      reason: 'snippet too short',
      source: 'model',
    });
  });

  it('does not ask again for what it already judged; asks again when the code changed', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }], {
      'src/a.ts': 'fetch(cdn)',
    });
    await start();
    const sent = stubModel((cases) => cases.map((c) => verdictFor(c)));
    await assess();
    await assess();
    expect(sent).toHaveLength(1);
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }], {
      'src/a.ts': 'fetch(internalApi)',
    });
    await get(true);
    await assess();
    expect(sent).toHaveLength(2);
  });

  it('a failing model batch does not lose the other batches and the run says it failed', async () => {
    const items: Item[] = Array.from({ length: 15 }, (_, i) => ({
      reason: 'no_match',
      path: `src/f${i}.ts`,
      line: 1,
    }));
    current = engine(items);
    await start();
    let call = 0;
    stubModel((cases) => (++call === 1 ? new Error('boom') : cases.map((c) => verdictFor(c))));
    await assess();
    const r = await get();
    expect(r.run.state).toBe('failed');
    expect(r.run.error).toBeTruthy();
    expect(r.summary.pendingCases).toBe(5); // el lote que falló sigue pendiente
    expect(r.summary.byCategory.external_call).toBe(10);
  });

  it('a reply cut off mid-array still yields the verdicts that arrived; the rest are retried once, smaller', async () => {
    const items: Item[] = Array.from({ length: 4 }, (_, i) => ({
      reason: 'no_match',
      path: `src/f${i}.ts`,
      line: 1,
    }));
    current = engine(items);
    await start();
    let call = 0;
    const sent = stubModel((cases) => {
      call++;
      if (call === 1) {
        // Respuesta cortada: sólo llegaron los dos primeros objetos.
        return [verdictFor(cases[0] as never), verdictFor(cases[1] as never)];
      }
      return cases.map((c) => verdictFor(c, { category: 'not_a_call' }));
    });
    await assess();
    expect(sent).toHaveLength(2);
    // El reintento sólo lleva los casos que faltaron.
    const second = sent[1]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect((second.match(/### Case/g) ?? []).length).toBe(2);
    const r = await get();
    expect(r.summary.byCategory.external_call).toBe(2);
    expect(r.summary.byCategory.not_a_call).toBe(2);
    expect(r.summary.pendingCases).toBe(0);
  });

  it('a case still unanswered after the retry stays pending — a failure is never cached as an answer', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 1 }]);
    await start();
    const sent = stubModel(() => []);
    await assess();
    expect(sent).toHaveLength(2); // pedido + un reintento
    expect((await get()).items[0]?.assessment).toBeNull();
    // La siguiente ejecución vuelve a intentarlo.
    await assess();
    expect(sent).toHaveLength(4);
  });

  it('without a model the assessment says so (409) and the path rules still work', async () => {
    current = engine([{ reason: 'no_match', path: 'e2e/x.ts', line: 1 }]);
    await start(null);
    const r = await assess();
    expect(r.statusCode).toBe(409);
    expect((await get()).summary.byCategory.test_or_tooling).toBe(1);
  });

  it('a workspace with no LAIN is "unconfigured", not an empty success', async () => {
    current = engine([]);
    await start();
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'bare' },
    });
    const bare = (r2.json() as { workspace: { id: string } }).workspace.id;
    const res = (
      await app.inject({ method: 'GET', url: `/api/workspaces/${bare}/loose-ends`, headers: H })
    ).json() as LooseEndsReport;
    expect(res.source).toBe('unconfigured');
  });

  it('an engine failure is reported as an error', async () => {
    current = {
      ...engine([]),
      listUnresolved: async () => {
        throw new Error('lain down');
      },
    } as unknown as LainAdapter;
    await start();
    const r = await get();
    expect(r.source).toBe('error');
    expect(r.error).toMatch(/lain down/);
  });

  it('classification can be started 4 times per hour per workspace, then 429 with Retry-After', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }]);
    await start();
    stubModel((cases) => cases.map((c) => verdictFor(c)));
    for (let i = 0; i < 4; i++) expect((await assess()).statusCode).toBe(202);
    const r = await assess();
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBeTruthy();
  });

  it('asks with the reasoning OFF, the stronger model and a tight token ceiling: no hidden thinking to pay for', async () => {
    current = engine([{ reason: 'no_match', path: 'src/a.ts', line: 3 }]);
    await start();
    const sent = stubModel((cases) => cases.map((c) => verdictFor(c)));
    await assess();
    expect(sent[0]?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(sent[0]?.model).toMatch(/super/i);
    expect(sent[0]?.max_tokens).toBeLessThanOrEqual(1536);
  });

  it('reports what the run cost: model calls, tokens, time', async () => {
    current = engine(
      Array.from({ length: 7 }, (_, i) => ({ reason: 'no_match', path: `src/f${i}.ts`, line: 1 })),
    );
    await start();
    stubModel((cases) => cases.map((c) => verdictFor(c)));
    await assess();
    const r = await get();
    expect(r.run.usage).toMatchObject({ modelCalls: 2, completionTokens: 154 });
    expect(r.run.usage?.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('loose ends — a run cannot spend without limit', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-loose-budget-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const many = (n: number) =>
    engine(
      Array.from({ length: n }, (_, i) => ({ reason: 'no_match', path: `src/f${i}.ts`, line: 1 })),
    );
  const answer = async (messages: Array<{ role: string; content: string | null }>) => {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const cases = [...user.matchAll(/id: (\w+)\nsite: (\S+)/g)].map((m) => ({
      id: m[1] as string,
      site: (m[2] as string).replace(/^web:/, ''),
    }));
    return {
      content: JSON.stringify(cases.map((c) => verdictFor(c))),
      usage: { promptTokens: 1, completionTokens: 10, reasoningTokens: 0 },
    };
  };

  it('stops at the cap on model calls, keeps what it already judged, and says why', async () => {
    const { createLooseEndsService } = await import('../src/loose-ends/service.js');
    const { createLooseEndStore } = await import('../src/loose-ends/store.js');
    let calls = 0;
    const svc = createLooseEndsService({
      store: createLooseEndStore(app.db),
      getAdapter: async () => many(30),
      model: () => ({
        name: 'm',
        complete: async (messages) => {
          calls++;
          return answer(messages);
        },
      }),
      maxModelCalls: 2,
    });
    await svc.assess('w');
    await svc.idle('w');
    expect(calls).toBe(2);
    const r = await svc.list('w');
    expect(r.run.state).toBe('failed');
    expect(r.run.error).toMatch(/budget: 2 model calls/);
    expect(r.summary.pendingCases).toBe(20); // 30 casos, 10 juzgados
  });

  it('stops at the wall-clock cap', async () => {
    const { createLooseEndsService } = await import('../src/loose-ends/service.js');
    const { createLooseEndStore } = await import('../src/loose-ends/store.js');
    let t = 0;
    let calls = 0;
    const svc = createLooseEndsService({
      store: createLooseEndStore(app.db),
      getAdapter: async () => many(30),
      // Cada lectura del reloj avanza 40 s: tras el primer lote el techo de 60 s ya pasó.
      now: () => (t += 40_000),
      model: () => ({
        name: 'm',
        complete: async (messages) => {
          calls++;
          return answer(messages);
        },
      }),
      maxRunMs: 60_000,
    });
    await svc.assess('w');
    await svc.idle('w');
    expect(calls).toBeLessThan(6);
    expect((await svc.list('w')).run.error).toMatch(/budget: 60 s/);
  });
});
