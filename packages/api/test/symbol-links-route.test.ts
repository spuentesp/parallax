// GET /api/workspaces/:id/graph/symbol-links: archivos que cambian con un símbolo y
// repos que lo alcanzan. Fuera del proceso sólo es falso el motor (adaptador).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

describe('GET /graph/symbol-links', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  const asked: Array<{ name: string; args: Record<string, unknown> }> = [];
  let fail = false;

  async function workspace(lainUrl?: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    const id = (r.json() as { workspace: { id: string } }).workspace.id;
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/repos`,
      headers: H,
      payload: { uri: 'https://example.invalid/web.git', local: '/tmp/web' },
    });
    return id;
  }
  const get = (id: string, repo: string, headers = H) =>
    app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}/graph/symbol-links?repo=${repo}&symbol=Thing`,
      headers,
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-links-'));
    asked.length = 0;
    fail = false;
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
    });
    app.lainClientFor = async () =>
      ({
        ...createLainMock(),
        codeTool: async (name: string, args: Record<string, unknown>) => {
          asked.push({ name, args });
          if (fail) throw new Error('engine down');
          if (name === 'find_symbol') {
            return {
              text: '1. `0b374e8a-c683-53cf-96db-470c32ee9e6d` function src/thing.ts:9 anchor=0.49\n',
            };
          }
          if (name === 'get_coupling_radar') {
            return {
              text: "Files that co-change with 'Thing' (src/thing.ts) — top 3 partners:\n1. src/other.ts (changed together 2 times)\n",
            };
          }
          return {
            text: '{"answer_scope":"complete","by_repo":{},"total_count":0,"truncated":false}',
          };
        },
      }) as unknown as LainAdapter;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the co-change partners and the cross-repo reach of a symbol of this workspace', async () => {
    const id = await workspace('http://lain.test');
    const r = await get(id, 'web');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      source: 'lain',
      path: 'src/thing.ts',
      note: null,
      coChange: { status: 'found', total: 3, partners: [{ path: 'src/other.ts', times: 2 }] },
      crossRepo: { repositories: [], truncated: false },
    });
  });

  it('refuses a repo that is not part of the workspace, without asking the engine', async () => {
    const id = await workspace('http://lain.test');
    const r = await get(id, 'someone-elses-repo');
    expect(r.statusCode).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it('404 for an unknown workspace, "unconfigured" without a LAIN server, "error" when the engine fails', async () => {
    expect((await get('nope', 'web')).statusCode).toBe(404);
    const bare = await workspace();
    expect((await get(bare, 'web')).json()).toMatchObject({ source: 'unconfigured' });
    const id = await workspace('http://lain.test');
    fail = true;
    expect((await get(id, 'web')).json()).toMatchObject({ source: 'error', coChange: null });
  });

  it('requires a token', async () => {
    const id = await workspace('http://lain.test');
    expect((await get(id, 'web', {} as typeof H)).statusCode).toBe(401);
  });
});
