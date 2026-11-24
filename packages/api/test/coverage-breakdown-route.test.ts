// GET /api/workspaces/:id/coverage/breakdown: el servicio de loose-ends, la
// autenticación y la base de datos son los reales; falso sólo el motor.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

const unresolved = (path: string, reason = 'no_match', candidates = true) => ({
  reason,
  method: 'POST',
  url_expr: `POST ${path}`,
  consumer: { id: `web:Function:${path}:call:1`, repo: 'web', path, line: 1 },
  candidates: candidates
    ? [{ endpoint: { key: 'http:POST /a', service: 'web' }, reason: 'pattern' }]
    : [],
});

const engine = (): LainAdapter =>
  ({
    ...createLainMock(),
    listUnresolved: async () => ({
      items: [
        unresolved('src/tests/a.test.ts'),
        unresolved('src/own.ts'),
        unresolved('src/dyn.ts', 'dynamic_topic'),
        unresolved('src/lone.ts', 'no_match', false),
      ],
      ambiguous: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listServices: async () => ({
      items: [],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    // el candidato está en el mismo servicio que el consumidor
    checkBinding: async () => ({
      valid: false,
      reasons: ['same_service'],
      method_match: true,
      template_match: 'none',
    }),
  }) as unknown as LainAdapter;

describe('GET /coverage/breakdown', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
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
  const get = (id: string, headers: Record<string, string> = H) =>
    app.inject({ method: 'GET', url: `/api/workspaces/${id}/coverage/breakdown`, headers });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-cov-'));
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
    app.lainClientFor = async () => engine();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('separates tests, calls inside a service, runtime targets and calls with no candidate', async () => {
    const id = await workspace('http://lain.test');
    const r = await get(id);
    expect(r.statusCode).toBe(200);
    const b = r.json() as {
      source: string;
      total: number;
      gaps: number;
      classes: Array<{ id: string; count: number }>;
    };
    expect(b.source).toBe('lain');
    expect(b.total).toBe(4);
    const counts = Object.fromEntries(b.classes.map((c) => [c.id, c.count]));
    expect(counts).toEqual({ test_or_tooling: 1, internal: 1, dynamic: 1, no_candidate: 1 });
    // De 4 cabos sólo 2 son huecos reales: el dinámico y el que no tiene candidato.
    expect(b.gaps).toBe(2);
  });

  it('is readable with a read-only token, needs a token, and says when there is no LAIN server', async () => {
    const id = await workspace('http://lain.test');
    expect((await get(id, { authorization: 'Bearer ro' })).statusCode).toBe(200);
    expect((await get(id, {})).statusCode).toBe(401);
    const bare = await workspace();
    expect((await get(bare)).json()).toMatchObject({ source: 'unconfigured', total: 0 });
  });
});
