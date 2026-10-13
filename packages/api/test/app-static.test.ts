import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('web bundle serving', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-web-'));
    mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
    writeFileSync(
      join(dir, 'web', 'index.html'),
      '<!doctype html><html><body>parallax</body></html>',
    );
    writeFileSync(join(dir, 'web', 'assets', 'app.js'), 'console.log("parallax")');
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

  it('serves index.html at /', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('parallax');
  });

  it('serves static assets from /assets/*', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('parallax');
    expect(r.headers['content-type']).toContain('javascript');
  });

  it('SPA fallback serves index.html for unknown routes', async () => {
    const r = await app.inject({ method: 'GET', url: '/orgs/some-org' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('parallax');
  });

  it('rejects path traversal in assets', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/../../etc/passwd' });
    expect([200, 400, 404]).toContain(r.statusCode);
    expect(r.body).not.toContain('root:');
  });

  it('returns WebBundleNotBuilt when bundle dir is missing', async () => {
    await app.close();
    const emptyDir = mkdtempSync(join(tmpdir(), 'parallax-nobundle-'));
    try {
      const app2 = await buildApp({
        port: 0,
        databasePath: join(emptyDir, 'p.db'),
        lainAdapter: 'mock',
        mcpTransport: 'stdio',
        authTokens: [{ token: 't', orgId: 'o', scopes: ['read'] }],
        webBundlePath: join(emptyDir, 'no-such-dir'),
      });
      const r = await app2.inject({ method: 'GET', url: '/' });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('WebBundleNotBuilt');
      await app2.close();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
