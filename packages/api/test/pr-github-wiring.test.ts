// El selector de PRs y la evaluación de un PR leen de GitHub con el MISMO lector: misma base de
// API y mismo token. Antes `POST /api/assessments` y `/api/pr/resolve` creaban un lector anónimo:
// un PR privado salía en el selector y fallaba con 404 al evaluarlo. GitHub se sustituye por un
// servidor local en el borde HTTP; todo lo demás es el camino real.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const AUTH = { authorization: 'Bearer t' };
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

describe('GitHub reads for PR evaluation use the configured read token and API base', () => {
  let dir: string;
  let gh: Server;
  let seen: Array<{ path: string; auth: string | null }>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-prwire-'));
    seen = [];
    gh = createServer((req, res) => {
      seen.push({
        path: req.url ?? '',
        auth: (req.headers.authorization as string | undefined) ?? null,
      });
      res.setHeader('content-type', 'application/json');
      // Un repo privado: sin token, GitHub contesta 404.
      if (req.headers.authorization !== 'Bearer read-token') {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      if (req.url?.includes('/files')) {
        res.end(
          JSON.stringify([
            { filename: 'src/a.py', status: 'modified', additions: 3, deletions: 1 },
          ]),
        );
        return;
      }
      res.end(
        JSON.stringify({
          number: 4,
          html_url: 'https://github.com/acme/shop/pull/4',
          title: 'change',
          state: 'open',
          user: { login: 'dev' },
          base: { ref: 'main', sha: BASE },
          head: { ref: 'feat', sha: HEAD },
        }),
      );
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
      githubApiBase: `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`,
      githubReadToken: 'read-token',
    });
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('/api/pr/resolve resolves a private PR with the read token, through the configured base', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/pr/resolve',
      headers: AUTH,
      payload: { url: 'https://github.com/acme/shop/pull/4' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pr).toMatchObject({ baseSha: BASE, headSha: HEAD, changedFiles: 1 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.auth === 'Bearer read-token')).toBe(true);
  });

  it('POST /api/assessments with a PR URL resolves it the same way and queues the evaluation', async () => {
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    const wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: AUTH,
      payload: { prUrl: 'https://github.com/acme/shop/pull/4', orgId: wsId },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().pr).toMatchObject({ baseSha: BASE, headSha: HEAD });
    expect(seen.every((s) => s.auth === 'Bearer read-token')).toBe(true);
    await app.assessmentWorker.drain();
  });

  it('MCP assesses a private PR URL using the configured GitHub reader', async () => {
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    const wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
    const headers = {
      ...AUTH,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });
    const session = init.headers['mcp-session-id'] as string;
    const result = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...headers, 'mcp-session-id': session },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'parallax_assess_pr',
          arguments: { prUrl: 'https://github.com/acme/shop/pull/4', orgId: wsId },
        },
      },
    });
    const line = result.body.split('\n').find((s) => s.startsWith('data: '));
    const envelope = JSON.parse(line?.slice(6) ?? '{}');
    expect(envelope.result?.isError).not.toBe(true);
    const payload = JSON.parse(envelope.result.content[0].text);
    expect(payload.assessment.manifestJson).toContain('"number":4');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.auth === 'Bearer read-token')).toBe(true);
    await app.assessmentWorker.drain();
  });
});
