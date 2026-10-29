import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('GET /api/whoami', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-whoami-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 'rw', orgId: 'org_a', scopes: ['read', 'write'] },
        { token: 'ro', orgId: 'org_a', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const who = (token?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/whoami',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });

  it('reports org and scopes, and read-only when write is missing', async () => {
    expect((await who('rw')).json()).toEqual({
      orgId: 'org_a',
      scopes: ['read', 'write'],
      readOnly: false,
    });
    expect((await who('ro')).json()).toEqual({ orgId: 'org_a', scopes: ['read'], readOnly: true });
  });

  it('401s without a token or with a wrong one', async () => {
    expect((await who()).statusCode).toBe(401);
    expect((await who('nope')).statusCode).toBe(401);
  });
});
