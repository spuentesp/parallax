import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

describe('GET /coverage/ledger', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  let fail = false;

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
  const get = (id: string, headers: Record<string, string> = H) =>
    app.inject({ method: 'GET', url: `/api/workspaces/${id}/coverage/ledger`, headers });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ledger-'));
    fail = false;
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
    app.lainClientFor = async () =>
      ({
        ...createLainMock(),
        getCoverage: async () => {
          if (fail) throw new Error('down');
          return {
            complete: false,
            external: [{ host: 'collector.test', calls: 7 }],
            schemaless_endpoints: [{ key: 'http:GET /health', service: 'api' }],
            stale_bindings: 0,
          };
        },
      }) as unknown as LainAdapter;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the engine ledger: external hosts and schemaless endpoints', async () => {
    const id = await workspace('http://lain.test');
    expect((await get(id)).json()).toEqual({
      source: 'lain',
      complete: false,
      external: [{ host: 'collector.test', calls: 7 }],
      schemalessEndpoints: 1,
      staleBindings: 0,
    });
  });

  it('is read-only, needs a token, and reports no LAIN server or an engine failure plainly', async () => {
    const id = await workspace('http://lain.test');
    expect((await get(id, { authorization: 'Bearer ro' })).statusCode).toBe(200);
    expect((await get(id, {})).statusCode).toBe(401);
    expect((await get(await workspace())).json()).toMatchObject({ source: 'unconfigured' });
    fail = true;
    expect((await get(id)).json()).toMatchObject({ source: 'error', external: [] });
  });
});
