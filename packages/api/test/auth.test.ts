import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('auth plugin', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-auth-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 'rw', orgId: 'o1', scopes: ['read', 'write'] },
        { token: 'ro', orgId: 'o1', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exempts /api/health without a token', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
  });

  it('attaches authToken on a valid bearer', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/orgs',
      headers: { authorization: 'Bearer rw' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('rejects with 401 when Authorization is missing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/orgs' });
    expect(r.statusCode).toBe(401);
  });

  it('rejects with 401 when the token is unknown', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/orgs',
      headers: { authorization: 'Bearer nop' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects with 401 when the header is malformed', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/orgs',
      headers: { authorization: 'Basic xyz' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects with 403 when the token lacks the required scope', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'Bearer ro' },
      payload: { name: 'x' },
    });
    expect(r.statusCode).toBe(403);
  });
});
