import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('web bundle serving', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-app-'));
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html><title>parallax</title>');
    writeFileSync(join(dir, 'web', 'app.js'), 'console.log("parallax")');
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read'] }],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the bundle at /app/index.html', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/index.html' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('parallax');
  });

  it('rejects path traversal attempts (Review Focus #5)', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/../etc/passwd' });
    // The router normalizes /app/../etc/passwd to /etc/passwd, which is
    // rejected by auth (401) or by the not-found handler (404). Any of
    // these is correct: the request does not leak file contents.
    expect([400, 401, 404]).toContain(r.statusCode);
    expect(r.body).not.toContain('root:');
  });

  it('serves index.html for the SPA fallback under /app/', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/some/spa/route' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('parallax');
  });

  it('returns WebBundleNotBuilt when the dir is missing (dev mode)', async () => {
    await app.close();
    const otherDir = mkdtempSync(join(tmpdir(), 'parallax-nobundle-'));
    try {
      const app2 = await buildApp({
        port: 0,
        databasePath: join(otherDir, 'p.db'),
        lainAdapter: 'mock',
        mcpTransport: 'stdio',
        authTokens: [{ token: 't', orgId: 'o', scopes: ['read'] }],
        webBundlePath: join(otherDir, 'no-such-dir'),
      });
      const r = await app2.inject({ method: 'GET', url: '/app/index.html' });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('WebBundleNotBuilt');
      expect(r.json().doc).toMatch(/^https:\/\//);
      await app2.close();
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
