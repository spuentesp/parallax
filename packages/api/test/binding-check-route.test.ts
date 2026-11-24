// POST /api/workspaces/:id/bindings/check: valida un vínculo propuesto con
// check_binding de LAIN. Fuera del proceso sólo es falso el motor (adaptador);
// el camino HTTP, la autenticación y la base de datos son los reales.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

describe('POST /bindings/check', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  const asked: unknown[] = [];
  let reply: () => unknown;

  async function workspace(lainUrl?: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: H,
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    return (r.json() as { workspace: { id: string } }).workspace.id;
  }
  const check = async (id: string, body: unknown, headers = H) =>
    app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/bindings/check`,
      headers,
      payload: body as object,
    });
  const body = {
    consumer: 'web:Function:src/a.ts:call:1',
    endpoint: { key: 'http:POST /a', service: 'api' },
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-binding-'));
    asked.length = 0;
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
        checkBinding: async (req: unknown) => {
          asked.push(req);
          return reply();
        },
      }) as unknown as LainAdapter;
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes the proposal to the engine and returns its verdict and the repos.yaml entry', async () => {
    reply = () => ({
      valid: true,
      reasons: [],
      method_match: true,
      template_match: 'exact',
      bindings_entry: '- consumer:\n    repo: web\n',
    });
    const id = await workspace('http://lain.test');
    const r = await check(id, body);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      source: 'lain',
      valid: true,
      reasons: [],
      methodMatch: true,
      templateMatch: 'exact',
      bindingsEntry: '- consumer:\n    repo: web\n',
    });
    // Contra la vista viva, con exactamente el consumidor y el endpoint propuestos.
    expect(asked).toEqual([{ snapshot: 'live', ...body }]);
  });

  it('a rejected link carries the engine reasons and no YAML', async () => {
    reply = () => ({
      valid: false,
      reasons: ['same_service', 'template_mismatch'],
      method_match: true,
      template_match: 'none',
    });
    const id = await workspace('http://lain.test');
    expect((await check(id, body)).json()).toMatchObject({
      source: 'lain',
      valid: false,
      reasons: ['same_service', 'template_mismatch'],
      bindingsEntry: null,
    });
  });

  it('is read-only: a read-only token may check (nothing is created)', async () => {
    reply = () => ({ valid: false, reasons: [], method_match: false, template_match: 'none' });
    const id = await workspace('http://lain.test');
    expect((await check(id, body, { authorization: 'Bearer ro' })).statusCode).toBe(200);
  });

  it('a workspace with no LAIN server says so; an engine failure is reported, not hidden', async () => {
    const bare = await workspace();
    expect((await check(bare, body)).json()).toMatchObject({
      source: 'unconfigured',
      valid: false,
    });
    reply = () => {
      throw new Error('engine down');
    };
    const id = await workspace('http://lain.test');
    expect((await check(id, body)).json()).toMatchObject({ source: 'error', valid: false });
  });

  it('rejects a malformed proposal and requires a token', async () => {
    reply = () => ({});
    const id = await workspace('http://lain.test');
    expect((await check(id, { consumer: 'x' })).statusCode).toBe(400);
    expect((await check(id, body, {} as typeof H)).statusCode).toBe(401);
  });
});
