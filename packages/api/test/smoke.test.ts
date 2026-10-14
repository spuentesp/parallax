import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

function parseSse(body: string): Record<string, unknown> {
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`no data line in SSE body: ${body.slice(0, 200)}`);
  return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
}

describe('smoke', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-smoke-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write', 'publish'] }],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('api: /health is ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
  });

  it('api: /orgs returns 200 [] with a valid bearer', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/orgs',
      headers: { authorization: 'Bearer t' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().orgs).toEqual([]);
  });

  it('mcp http-sse: /mcp tools/list returns the four product tools', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer t',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '0' },
        },
      },
    });
    const session = init.headers['mcp-session-id'];
    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer t',
        'mcp-session-id': String(session),
      },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    const body = parseSse(list.body) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = body.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining([
        'parallax_explore',
        'parallax_assess_pr',
        'parallax_get_assessment',
        'parallax_get_evidence',
      ]),
    );
  });

  it('db: seven tables exist after a clean boot', async () => {
    // The db plugin runs the migration. Check that all seven are there.
    const { tableNames } = await import('../src/db/migrate.js');
    // Access the underlying sqlite handle through the Drizzle client.
    // Drizzle's better-sqlite3 client stores the Database on `.session.client`.
    const db = app.db as unknown as {
      session: { client: Parameters<typeof tableNames>[0] };
    };
    const names = tableNames(db.session.client);
    expect(names).toEqual(
      expect.arrayContaining([
        'workspace',
        'assessment',
        'explanation',
        'evidence',
        'job_step',
        'event',
        'publication',
      ]),
    );
  });
});
