import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

describe('GET /coverage/ledger', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  let fail = false;
  let live: unknown = null;

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
    live = null;
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
          if (live) return live as never;
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
      repos: [],
      gaps: {
        unresolvedConsumers: 0,
        ambiguous: 0,
        unresolvedRefs: 0,
        urlDefaults: 0,
        blindSpotSites: 0,
      },
    });
  });

  it("shows only the workspace's own repos when one engine backs several workspaces", async () => {
    const mk = (repo: string) => ({
      repo,
      state: 'indexed',
      sensors: {},
      languages: {},
      skips: [],
      unresolved: [],
    });
    live = { complete: false, repos: [mk('OpenShell'), mk('NemoClaw'), mk('NeMo-Agent-Toolkit')] };
    const id = await workspace('http://lain.test');
    await app.db.insert(schema.repo).values([
      {
        id: `${id}-a`,
        workspaceId: id,
        uri: 'https://github.com/NVIDIA/OpenShell.git',
        sha: 'a',
        local: null,
        createdAt: 1,
      },
      {
        id: `${id}-b`,
        workspaceId: id,
        uri: 'https://github.com/NVIDIA/NemoClaw.git',
        sha: 'b',
        local: null,
        createdAt: 1,
      },
    ] as never);
    const body = (await get(id)).json();
    expect(body.repos.map((r: { repo: string }) => r.repo)).toEqual(['OpenShell', 'NemoClaw']);
  });

  it('passes the per-repo ledger of a live 0.16 answer through', async () => {
    live = JSON.parse(
      readFileSync(new URL('./fixtures/lain-coverage-0.16-saleor.json', import.meta.url), 'utf8'),
    );
    const body = (await get(await workspace('http://lain.test'))).json();
    expect(body.repos.map((r: { repo: string }) => r.repo)).toEqual([
      'saleor',
      'saleor-dashboard',
      'storefront',
    ]);
    expect(body.repos[0].blindSpots[0]).toMatchObject({ reason: 'OrmDynamicQuery', count: 1760 });
    expect(body.gaps.unresolvedConsumers).toBe(32);
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
