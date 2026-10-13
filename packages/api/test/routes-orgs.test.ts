import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';

describe('orgs routes', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-orgs-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = { authorization: 'Bearer t' };

  it('GET /orgs returns 200 with empty list', async () => {
    const r = await app.inject({ method: 'GET', url: '/orgs', headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ orgs: [] });
  });

  it('POST /orgs returns 501 with NotImplemented + doc', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: auth,
      payload: { name: 'acme' },
    });
    expect(r.statusCode).toBe(501);
    const body = r.json();
    expect(body.code).toBe('NotImplemented');
    expect(body.doc).toMatch(/^https:\/\//);
  });

  it('GET /orgs/:id returns 501 with NotImplemented', async () => {
    const r = await app.inject({ method: 'GET', url: '/orgs/abc', headers: auth });
    expect(r.statusCode).toBe(501);
    expect(r.json().code).toBe('NotImplemented');
  });
});
