import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

// Respuestas literales de `query_graph` de LAIN 0.16.0 sobre Saleor, una por repo.
const LIVE = JSON.parse(
  readFileSync(new URL('./fixtures/lain-query-graph-0.16-saleor.json', import.meta.url), 'utf8'),
) as Record<string, { group: unknown; nodes: unknown }>;

type Sent = { repo_id?: string; query: { explain?: boolean; ops: Array<{ op: string }> } };

describe('POST /api/workspaces/:id/graph-query', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sent: Sent[];
  let failRepos: Set<string>;
  let rejectWith: string | null;
  const H = { authorization: 'Bearer t' };

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
  const post = (
    id: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = H,
  ) => app.inject({ method: 'POST', url: `/api/workspaces/${id}/graph-query`, headers, payload });
  const GROUP = [
    { op: 'find', type: 'Function', name: { glob: 'graphql-call:*' } },
    { op: 'connect', edge: 'Binds', direction: 'outgoing', depth: 1 },
    { op: 'group', by: 'service' },
    { op: 'sort', by: 'count', direction: 'desc' },
    { op: 'limit', count: 10 },
  ];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-gq-'));
    sent = [];
    failRepos = new Set();
    rejectWith = null;
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
    });
    // El motor es el borde: se inyecta un cliente que contesta con salidas reales de 0.16.0.
    app.lainClientFor = async () =>
      ({
        ...createLainMock(),
        getCoverage: async () => ({
          complete: false,
          repos: Object.keys(LIVE).map((repo) => ({ repo, state: 'indexed' })),
        }),
        queryGraph: async (req: Sent) => {
          sent.push(req);
          if (rejectWith) throw new Error(rejectWith);
          const repo = req.repo_id ?? '';
          if (failRepos.has(repo)) throw new Error('lain call failed: timeout');
          const hasGroup = req.query.ops.some((o) => o.op === 'group');
          return (LIVE[repo] as { group: unknown; nodes: unknown })[hasGroup ? 'group' : 'nodes'];
        },
      }) as unknown as LainAdapter;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('asks the engine once per repo with explain on, and merges the answers', async () => {
    const id = await workspace('http://x/mcp');
    const res = await post(id, { ops: GROUP });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups).toEqual([
      {
        key: 'saleor-api',
        count: 636 + 573 + 63,
        byRepo: { saleor: 636, 'saleor-dashboard': 573, storefront: 63 },
      },
    ]);
    expect(body.scope).toEqual({
      analyzed: ['saleor', 'saleor-dashboard', 'storefront'],
      failed: [],
    });
    expect(sent.map((s) => s.repo_id).sort()).toEqual(['saleor', 'saleor-dashboard', 'storefront']);
    for (const s of sent) {
      expect(s.query.explain).toBe(true);
      // sort y limit finales se aplican después de juntar; el motor recibe un limit de tope.
      expect(s.query.ops.map((o) => o.op)).toEqual(['find', 'connect', 'group', 'limit']);
    }
    expect(body.steps.map((s: { op: string }) => s.op)).toEqual(['find', 'connect', 'group']);
  });

  it('limits to the repos asked for', async () => {
    const id = await workspace('http://x/mcp');
    const res = await post(id, { ops: GROUP, repos: ['storefront'] });
    expect(res.json().groups[0].byRepo).toEqual({ storefront: 63 });
    expect(sent.map((s) => s.repo_id)).toEqual(['storefront']);
  });

  it('keeps going when one repo fails and says so in the scope', async () => {
    const id = await workspace('http://x/mcp');
    failRepos.add('saleor-dashboard');
    const body = (await post(id, { ops: GROUP })).json();
    expect(body.scope.analyzed).toEqual(['saleor', 'storefront']);
    expect(body.scope.failed).toEqual([
      { repo: 'saleor-dashboard', error: 'lain call failed: timeout' },
    ]);
    expect(body.groups[0].count).toBe(636 + 63);
  });

  it("returns the engine's own message as a 400 when every repo rejects the query", async () => {
    const id = await workspace('http://x/mcp');
    rejectWith = 'lain rejected query_graph: Invalid argument: unknown field `bogus`';
    const res = await post(id, {
      ops: [
        { op: 'find', type: 'X' },
        { op: 'filter', bogus: 1 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('unknown field `bogus`');
  });

  it('returns 502 when repos fail for different reasons', async () => {
    const id = await workspace('http://x/mcp');
    let n = 0;
    app.lainClientFor = async () =>
      ({
        ...createLainMock(),
        getCoverage: async () => ({ complete: false, repos: [{ repo: 'a' }, { repo: 'b' }] }),
        queryGraph: async () => {
          throw new Error(`down ${n++}`);
        },
      }) as unknown as LainAdapter;
    const res = await post(id, { ops: [{ op: 'find', type: 'X' }] });
    expect(res.statusCode).toBe(502);
  });

  it('rejects a bad pipeline before touching the engine', async () => {
    const id = await workspace('http://x/mcp');
    for (const payload of [
      { ops: [{ op: 'limit', count: 3 }] },
      { ops: [{ op: 'drop_everything' }] },
      { ops: [{ op: 'find' }, { op: 'limit', count: 99999 }] },
      {},
    ]) {
      expect((await post(id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(sent).toEqual([]);
  });

  it('is read-only access: a read token works, no token does not, and other statuses are exact', async () => {
    const id = await workspace('http://x/mcp');
    expect((await post(id, { ops: GROUP }, { authorization: 'Bearer ro' })).statusCode).toBe(200);
    expect((await post(id, { ops: GROUP }, {})).statusCode).toBe(401);
    expect((await post('nope', { ops: GROUP })).statusCode).toBe(404);
    const bare = await workspace();
    expect((await post(bare, { ops: GROUP })).statusCode).toBe(409);
  });
});
