import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('stub routes (assessments, proposals, publications)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-stubs-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write', 'publish'] }],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = { authorization: 'Bearer t' };

  it('POST /publications is refused: dry run, nothing is ever sent', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/publications',
      headers: auth,
      payload: { assessmentId: 'a_1', target: 'github:org/repo#1' },
    });
    expect(r.statusCode).toBe(501);
    expect(r.json().code).toBe('NotImplemented');
    expect(r.body).toMatch(/dry run/i);
    expect(r.body).toMatch(/nothing is ever sent to GitHub/i);
  });

  it('POST /assessments with invalid body returns 400 (Problem Details)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it('GET /assessments/:id returns 404 for an unknown assessment', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/assessments/a_1', headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it('GET /assessments/:id/events returns 404 for an unknown assessment', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/assessments/a_1/events',
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it('POST /proposals returns 501', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: auth,
      payload: { question: 'add a BFF', orgId: 'o' },
    });
    expect(r.statusCode).toBe(501);
  });

  it('GET /proposals/:id returns 501', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/proposals/p_1', headers: auth });
    expect(r.statusCode).toBe(501);
  });

  it('POST /publications returns 501', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/publications',
      headers: auth,
      payload: { assessmentId: 'a_1', target: 'orders' },
    });
    expect(r.statusCode).toBe(501);
  });
});
