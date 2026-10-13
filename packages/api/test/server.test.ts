import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';
import type { AppConfig } from '../src/config.js';

describe('buildApp', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-srv-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCfg(): AppConfig {
    return {
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    };
  }

  it('boots all plugins and answers /health', async () => {
    const app = await buildApp(makeCfg());
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    expect(r.json().lainAdapter).toBe('mock');
    expect(r.json().apiVersion).toBe('1');
    expect(typeof r.json().analyzerVersion).toBe('string');
    await app.close();
  });

  it('rejects a protected route without a bearer token', async () => {
    const app = await buildApp(makeCfg());
    const r = await app.inject({ method: 'GET', url: '/orgs' });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
