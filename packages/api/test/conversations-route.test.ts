// Memoria de conversación de punta a punta: el turno se escribe por /api/query y
// se lee por /api/conversations (camino real); el modelo se intercepta en el borde
// de red y se mira QUÉ mensajes recibe el segundo turno.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationStore,
  MAX_CONVERSATIONS_PER_OWNER,
  MAX_TURNS_PER_CONVERSATION,
  ownerOf,
} from '../src/conversation/store.js';
import { buildApp } from '../src/server.js';

interface Sent {
  messages: Array<{ role: string; content: string | null }>;
}

// Cada turno del modelo entrega con submit_answer (una relación verificable) en
// su primera ronda; guarda lo que recibió.
function stubModel(claim = { consumer: 'billing', provider: 'orders', polarity: 'present' }) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Sent;
    sent.push(body);
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: `c${sent.length}`,
                  type: 'function',
                  function: {
                    name: 'submit_answer',
                    arguments: JSON.stringify({
                      answer: `answer number ${sent.length}`,
                      claims: [{ kind: 'relation', ...claim }],
                    }),
                  },
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
  return sent;
}

describe('conversation memory', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const A = { authorization: 'Bearer token-a' };
  const B = { authorization: 'Bearer token-b' };

  async function start(nebiusToken: string | null = 'test-token') {
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [
        { token: 'token-a', orgId: 'o', scopes: ['read'] },
        { token: 'token-b', orgId: 'o', scopes: ['read'] },
      ],
      webBundlePath: dir,
      ...(nebiusToken ? { nebiusToken } : {}),
      // Estas pruebas fijan la coreografía del investigador, no el relevo.
      investigatorHandoff: 'off',
    });
  }
  const ask = (headers: typeof A, payload: object) =>
    app.inject({ method: 'POST', url: '/api/query', headers, payload });
  const q = (question: string, extra: object = {}) => ({ question, orgId: 'org_demo', ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-conv-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves a turn and reads it back with the engine verdicts as shown', async () => {
    stubModel();
    await start();
    const r = await ask(A, q('Who consumes orders?'));
    const conv = r.json().conversation as { id: string; seq: number };
    expect(conv.seq).toBe(1);

    const list = (
      await app.inject({
        method: 'GET',
        url: '/api/conversations?workspaceId=org_demo',
        headers: A,
      })
    ).json();
    expect(list.conversations).toEqual([
      expect.objectContaining({
        id: conv.id,
        title: 'Who consumes orders?',
        workspaceId: 'org_demo',
        turns: 1,
      }),
    ]);

    const got = (
      await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}`, headers: A })
    ).json();
    expect(got.turns).toHaveLength(1);
    expect(got.turns[0]).toMatchObject({
      seq: 1,
      question: 'Who consumes orders?',
      answer: 'answer number 2',
      status: 'available',
      model: 'fake/nemotron',
    });
    expect(got.turns[0].claims[0]).toMatchObject({ verdict: 'verified' });
    expect(got.turns[0].claims[0].reason).toMatch(/engine records/);
  });

  it('a follow-up carries the thread and the engine-adjudicated facts, not just the new question', async () => {
    const sent = stubModel();
    await start();
    const first = (await ask(A, q('Who consumes orders?'))).json().conversation as { id: string };
    const second = await ask(A, q('And what about reports?', { conversationId: first.id }));
    expect(second.json().conversation).toEqual({ id: first.id, seq: 2 });

    // El segundo turno (el modelo se llama más de una vez por turno: se busca la
    // primera petición que ya lleva la pregunta nueva): system, pregunta y
    // respuesta anteriores, y la pregunta nueva.
    const msgs =
      sent.find((s) =>
        s.messages.some((m) => String(m.content).includes('Question: And what about reports?')),
      )?.messages ?? [];
    expect(msgs[0]?.role).toBe('system');
    expect(msgs.slice(1, 3)).toEqual([
      { role: 'user', content: 'Who consumes orders?' },
      // El modelo se llama dos veces por turno (la primera entrega sin leer se devuelve),
      // así que la respuesta aceptada del primer turno es la segunda.
      { role: 'assistant', content: 'answer number 2' },
    ]);
    const last = msgs.find(
      (m) => m.role === 'user' && String(m.content).includes('Question: And what about reports?'),
    );
    expect(String(last?.content)).toContain('billing → orders: engine verified');
    expect(String(last?.content)).toMatch(/context only/);
    // El primer turno no llevaba historia.
    expect(sent[0]?.messages.filter((m) => m.role !== 'system')).toHaveLength(1);
  });

  it('without a conversationId every question starts its own thread', async () => {
    stubModel();
    await start();
    const a = (await ask(A, q('one'))).json().conversation as { id: string };
    const b = (await ask(A, q('two'))).json().conversation as { id: string };
    expect(a.id).not.toBe(b.id);
    const list = (
      await app.inject({ method: 'GET', url: '/api/conversations', headers: A })
    ).json();
    expect(list.conversations).toHaveLength(2);
  });

  it('another token cannot read, continue or delete a conversation: for it, it does not exist', async () => {
    stubModel();
    await start();
    const conv = (await ask(A, q('private question'))).json().conversation as { id: string };

    expect(
      (await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}`, headers: B }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/conversations/${conv.id}`, headers: B }))
        .statusCode,
    ).toBe(404);
    expect((await ask(B, q('hijack', { conversationId: conv.id }))).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/conversations', headers: B })).json()
        .conversations,
    ).toEqual([]);
    // Y sigue intacta para su dueño.
    const mine = (
      await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}`, headers: A })
    ).json();
    expect(mine.turns).toHaveLength(1);
  });

  it('the owner can delete a conversation, and it is gone', async () => {
    stubModel();
    await start();
    const conv = (await ask(A, q('x'))).json().conversation as { id: string };
    expect(
      (
        await app.inject({ method: 'DELETE', url: `/api/conversations/${conv.id}`, headers: A })
      ).json(),
    ).toEqual({ deleted: true });
    expect(
      (await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}`, headers: A }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/conversations/${conv.id}`, headers: A }))
        .statusCode,
    ).toBe(404);
  });

  it('a conversation belongs to one workspace: continuing it from another is a 404', async () => {
    stubModel();
    await start();
    const conv = (await ask(A, q('x'))).json().conversation as { id: string };
    const r = await ask(A, { question: 'y', orgId: 'another_ws', conversationId: conv.id });
    expect(r.statusCode).toBe(404);
  });

  it('stores a hash of the token, never the token', async () => {
    stubModel();
    await start();
    await ask(A, q('x'));
    const rows = createConversationStore(app.db);
    const list = await rows.list(ownerOf('token-a'));
    expect(list).toHaveLength(1);
    const raw = app.db.all<{ owner: string }>(sql`SELECT owner FROM conversation`);
    expect(raw.map((r) => r.owner)).toEqual([ownerOf('token-a')]);
    expect(JSON.stringify(raw)).not.toContain('token-a');
  });

  it('refuses to continue a full conversation before spending a model call', async () => {
    const sent = stubModel();
    await start();
    const store = createConversationStore(app.db);
    const conv = await store.start(ownerOf('token-a'), 'org_demo', 'seed');
    for (let i = 0; i < MAX_TURNS_PER_CONVERSATION; i++) {
      await store.append(conv.id, {
        question: `q${i}`,
        answer: 'a',
        status: 'available',
        claims: [],
        focus: null,
        model: null,
      });
    }
    const r = await ask(A, q('one more', { conversationId: conv.id }));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('ConversationFull');
    expect(sent).toHaveLength(0);
  });

  it('without a model nothing is saved: there is no answer to remember', async () => {
    await start(null);
    const r = await ask(A, q('anything'));
    expect(r.json()).toMatchObject({
      explanation_status: 'failed:no_model_configured',
      conversation: null,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/conversations', headers: A })).json()
        .conversations,
    ).toEqual([]);
  });

  it('the store numbers turns in order, keeps the newest 100 conversations per owner, and cascades deletes', async () => {
    await start();
    const store = createConversationStore(app.db);
    const owner = ownerOf('someone');
    const first = await store.start(owner, 'w', 'first');
    await store.append(first.id, {
      question: 'q1',
      answer: 'a',
      status: 'available',
      claims: [],
      focus: null,
      model: null,
    });
    expect(
      await store.append(first.id, {
        question: 'q2',
        answer: 'a',
        status: 'available',
        claims: [],
        focus: null,
        model: null,
      }),
    ).toBe(2);
    expect(await store.turnCount(first.id)).toBe(2);
    for (let i = 0; i < MAX_CONVERSATIONS_PER_OWNER; i++) await store.start(owner, 'w', `c${i}`);
    expect(await store.get(owner, first.id)).toBeNull(); // la más antigua se descartó
    expect((await store.list(owner)).length).toBe(MAX_CONVERSATIONS_PER_OWNER);
    const orphans = app.db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM turn WHERE conversation_id = ${first.id}`,
    );
    expect(orphans[0]?.n).toBe(0);
  });
});
