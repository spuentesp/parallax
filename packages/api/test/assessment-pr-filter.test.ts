// GET /api/assessments?pr=owner/repo#N returns only the reports of that pull request, as light rows.
// The Jira panel used to download up to 8 full reports (~300 KB each) to find one PR. The state
// here comes from the real write path (POST /api/assessments); GitHub is faked at the HTTP edge.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const AUTH = { authorization: 'Bearer t' };

// Distinct base/head SHAs per pull request, so each one is its own assessment.
const sha = (n: number, side: 'a' | 'b') => (side === 'a' ? 'a' : 'b').repeat(39) + String(n);

describe('listing assessments by pull request', () => {
  let dir: string;
  let gh: Server;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  const assess = async (number: number) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: AUTH,
      payload: { prUrl: `https://github.com/Acme/Shop/pull/${number}`, orgId: wsId },
    });
    expect(r.statusCode).toBe(201);
    return r.json().assessment.id as string;
  };
  const list = (qs: string) =>
    app.inject({ method: 'GET', url: `/api/assessments${qs}`, headers: AUTH });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-prfilter-'));
    gh = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('/files')) {
        res.end(JSON.stringify([{ filename: 'src/a.py', status: 'modified' }]));
        return;
      }
      const number = Number(/\/pulls\/(\d+)/.exec(req.url ?? '')?.[1] ?? 0);
      res.end(
        JSON.stringify({
          number,
          html_url: `https://github.com/Acme/Shop/pull/${number}`,
          title: 'change',
          state: 'open',
          user: { login: 'dev' },
          base: { ref: 'main', sha: sha(number, 'a') },
          head: { ref: 'feat', sha: sha(number, 'b') },
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
    });
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    wsId = ws.json().workspace.id as string;
    await app.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/Acme/Shop.git',
      createdAt: Date.now(),
    });
  });

  afterEach(async () => {
    await app.assessmentWorker.drain();
    await app.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the reports of the requested pull request', async () => {
    const id4 = await assess(4);
    const id5 = await assess(5);

    const all = (await list('')).json().assessments as Array<{ id: string }>;
    expect(all.map((a) => a.id).sort()).toEqual([id4, id5].sort());

    const only4 = (await list('?pr=Acme/Shop%234')).json().assessments as Array<{
      id: string;
      pr: { owner: string; repo: string; number: number };
    }>;
    expect(only4.map((a) => a.id)).toEqual([id4]);
    expect(only4[0]?.pr).toEqual({ owner: 'Acme', repo: 'Shop', number: 4 });
  });

  it('matches owner and repo without regard to case', async () => {
    const id4 = await assess(4);
    const rows = (await list('?pr=acme/shop%234')).json().assessments as Array<{ id: string }>;
    expect(rows.map((a) => a.id)).toEqual([id4]);
  });

  it('returns an empty list for a pull request that was never assessed', async () => {
    await assess(4);
    const r = await list('?pr=Acme/Shop%23999');
    expect(r.statusCode).toBe(200);
    expect(r.json().assessments).toEqual([]);
  });

  it('refuses a malformed pr filter instead of returning everything', async () => {
    await assess(4);
    for (const bad of ['4', 'Acme/Shop', 'Acme/Shop#x', 'https://github.com/Acme/Shop/pull/4']) {
      const r = await list(`?pr=${encodeURIComponent(bad)}`);
      expect(r.statusCode, bad).toBe(400);
    }
  });
});
