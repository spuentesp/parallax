// E2E API tests — full HTTP requests against a running API.
// These verify the complete request/response cycle including auth,
// routing, error handling, and response shapes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('E2E API', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-e2e-'));
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(
      join(dir, 'web', 'index.html'),
      '<!doctype html><html><body>parallax</body></html>',
    );
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [
        { token: 'rw', orgId: 'org_demo', scopes: ['read', 'write', 'publish'] },
        { token: 'ro', orgId: 'org_demo', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = { authorization: 'Bearer rw' };
  const roAuth = { authorization: 'Bearer ro' };

  // ── Health & Metadata ──────────────────────────────────────────
  describe('health', () => {
    it('returns OK with metadata', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/health' });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.status).toBe('ok');
      expect(body.lainAdapter).toBe('mock');
      expect(body.apiVersion).toBe('1');
      expect(typeof body.analyzerVersion).toBe('string');
    });
    it('is public (no auth required)', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/health' });
      expect(r.statusCode).toBe(200);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────
  describe('auth', () => {
    it('rejects without token', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/orgs' });
      expect(r.statusCode).toBe(401);
    });
    it('rejects invalid token', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/orgs',
        headers: { authorization: 'Bearer invalid' },
      });
      expect(r.statusCode).toBe(401);
    });
    it('accepts valid token', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/orgs', headers: auth });
      expect(r.statusCode).toBe(200);
    });
    it('rejects insufficient scope', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/orgs',
        headers: roAuth,
        payload: { name: 'x' },
      });
      expect(r.statusCode).toBe(403);
    });
    it('rejects malformed header', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/orgs',
        headers: { authorization: 'Basic xyz' },
      });
      expect(r.statusCode).toBe(401);
    });
  });

  // ── Orgs ───────────────────────────────────────────────────────
  describe('orgs', () => {
    it('list returns empty array', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/orgs', headers: auth });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ orgs: [] });
    });
    it('create returns 501 with NotImplemented', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/orgs',
        headers: auth,
        payload: { name: 'x' },
      });
      expect(r.statusCode).toBe(501);
      expect(r.json().code).toBe('NotImplemented');
    });
    it('get by id returns 501', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/orgs/abc', headers: auth });
      expect(r.statusCode).toBe(501);
    });
  });

  // ── Assessments ────────────────────────────────────────────────
  describe('assessments', () => {
    it('create returns 501', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/assessments',
        headers: auth,
        payload: { prUrl: 'https://github.com/org/repo/pull/1', orgId: 'org_demo' },
      });
      expect(r.statusCode).toBe(501);
    });
    it('invalid body returns 400', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/assessments',
        headers: auth,
        payload: {},
      });
      expect(r.statusCode).toBe(400);
    });
    it('get returns 501', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/assessments/a_1', headers: auth });
      expect(r.statusCode).toBe(501);
    });
    it('events returns 501', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/assessments/a_1/events',
        headers: auth,
      });
      expect(r.statusCode).toBe(501);
    });
  });

  // ── Query Agent ────────────────────────────────────────────────
  describe('query agent', () => {
    it('returns fallback without Nemotron', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/query',
        headers: auth,
        payload: { question: 'test', orgId: 'org_demo' },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.answer).toBeTruthy();
      expect(body.topology).toBeDefined();
    });
    it('validates body', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/query', headers: auth, payload: {} });
      expect(r.statusCode).toBe(400);
    });
  });

  // ── MCP HTTP/SSE ───────────────────────────────────────────────
  describe('MCP', () => {
    it('initialize returns server info', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer rw',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'e2e', version: '0' },
          },
        },
      });
      expect([200, 201]).toContain(r.statusCode);
      expect(r.headers['mcp-session-id']).toBeTruthy();
    });
  });

  // ── Web Bundle ─────────────────────────────────────────────────
  describe('web bundle', () => {
    it('serves index.html at /', async () => {
      const r = await app.inject({ method: 'GET', url: '/' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<!doctype html>');
    });
    it('SPA fallback serves index for non-API routes', async () => {
      const r = await app.inject({ method: 'GET', url: '/orgs/org_demo' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<!doctype html>');
    });
    it('rejects path traversal', async () => {
      const r = await app.inject({ method: 'GET', url: '/assets/../../etc/passwd' });
      expect([200, 400, 401, 404]).toContain(r.statusCode);
      expect(r.body).not.toContain('root:');
    });
  });
});
