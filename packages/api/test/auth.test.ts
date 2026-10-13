import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import authPlugin from '../src/plugins/auth.js';

const cfg: AppConfig = {
  port: 8080,
  databasePath: ':memory:',
  lainAdapter: 'mock',
  mcpTransport: 'stdio',
  authTokens: [
    { token: 'rw', orgId: 'o1', scopes: ['read', 'write'] },
    { token: 'ro', orgId: 'o1', scopes: ['read'] },
  ],
  webBundlePath: '/tmp',
};

async function makeApp() {
  const app = Fastify();
  app.decorate('config', cfg);
  await app.register(authPlugin);
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/protected', { config: { scopes: ['read'] } }, async (req) => ({
    orgId: req.authToken?.orgId,
  }));
  app.get('/write', { config: { scopes: ['write'] } }, async () => ({ ok: true }));
  return app;
}

describe('auth plugin', () => {
  it('exempts /health without a token', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('attaches authToken on a valid bearer (Review Focus #1 happy path)', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer rw' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().orgId).toBe('o1');
    await app.close();
  });

  it('rejects with 401 when Authorization is missing', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/protected' });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('rejects with 401 when the token is unknown', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer nop' },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('rejects with 401 when the header is malformed (Review Focus #1)', async () => {
    const app = await makeApp();
    const r1 = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic xyz' },
    });
    expect(r1.statusCode).toBe(401);
    const r2 = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' },
    });
    expect(r2.statusCode).toBe(401);
    await app.close();
  });

  it('rejects with 403 when the token lacks the required scope', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/write',
      headers: { authorization: 'Bearer ro' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
