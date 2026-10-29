// Un reinicio no deja un PR sin estado: al arrancar, la evaluación interrumpida se reanuda
// (INV 5) y el resultado pendiente se publica en GitHub. El estado sale del camino real de
// escritura (handlePullRequest escribe la fila de lo pendiente); "reiniciar" es abrir otra
// aplicación sobre la misma base de datos. GitHub es un servidor local.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { GitHubWriter, PENDING_STATUS } from '../src/github/status.js';
import { handlePullRequest } from '../src/routes/ci.js';
import { buildApp } from '../src/server.js';

const AUTH = { authorization: 'Bearer t' };

describe('a restart resumes interrupted PR evaluations and their GitHub reports', () => {
  let dir: string;
  let gh: Server;
  let posts: Array<{ url: string; body: { state?: string; description?: string } }>;
  let apiBase: string;
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  const config = (extra: object = {}) => ({
    port: 0,
    databasePath: join(dir, 'p.db'),
    lainAdapter: 'mock' as const,
    mcpTransport: 'stdio' as const,
    authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] as Array<'read' | 'write'> }],
    webBundlePath: join(dir, 'web'),
    githubApiBase: apiBase,
    githubWriteToken: 'write-token',
    githubWebhookSecret: 'whsec',
    publicUrl: 'https://parallax.example',
    ...extra,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-resume-'));
    posts = [];
    gh = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        posts.push({ url: req.url ?? '', body: text ? JSON.parse(text) : {} });
        res.statusCode = 201;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => gh.listen(0, '127.0.0.1', resolve));
    apiBase = `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    await new Promise<void>((resolve) => gh.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes the result of an evaluation that was interrupted before it finished', async () => {
    // Antes del reinicio: el PR llega, se muestra "analizando" y el servidor cae a mitad del trabajo.
    const app1 = await buildApp(config());
    apps.push(app1);
    const ws = await app1.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: AUTH,
      payload: { name: 'shop' },
    });
    const wsId = ws.json().workspace.id as string;
    await app1.db.insert(schema.repo).values({
      id: 'shop',
      workspaceId: wsId,
      uri: 'https://github.com/acme/shop.git',
      createdAt: Date.now(),
    });
    await app1.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/ci`,
      headers: AUTH,
      payload: { mode: 'on-open-and-update', baseBranch: null, reportComments: false },
    });
    const parked = new Proxy(app1.assessmentWorker, {
      get(target, prop) {
        if (prop === 'run') return async () => undefined; // el trabajo nunca termina
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const log = {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
    } as unknown as FastifyBaseLogger;
    await handlePullRequest(
      {
        db: app1.db,
        worker: parked,
        analyzerVersion: app1.lain.analyzerVersion,
        writer: new GitHubWriter({ token: 'write-token', apiBase }),
        publicUrl: null,
        log,
        retryDelaysMs: [],
      },
      {
        action: 'opened',
        owner: 'acme',
        repo: 'shop',
        number: 4,
        htmlUrl: 'https://github.com/acme/shop/pull/4',
        baseRef: 'main',
        headRef: 'feat',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        isFork: false,
        isDraft: false,
        baseChanged: false,
      },
    );
    expect(
      posts.filter((p) => p.url.includes('/statuses/')).map((p) => p.body.description),
    ).toEqual([PENDING_STATUS.description]);
    const [interrupted] = await app1.db.select().from(schema.assessment);
    expect(interrupted?.status).toBe('QUEUED');
    await app1.close();
    apps.pop();

    // Después: otra aplicación sobre la misma base de datos. Nadie llama a nada a mano.
    const app2 = await buildApp(config());
    apps.push(app2);
    await app2.ready();
    const deadline = Date.now() + 15_000;
    const finalPosts = () =>
      posts.filter(
        (p) => p.url.includes('/statuses/') && p.body.description !== PENDING_STATUS.description,
      );
    while (finalPosts().length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(finalPosts()).toHaveLength(1);
    expect(finalPosts()[0]?.url).toContain(`/statuses/${'b'.repeat(40)}`);
    expect(['success', 'failure', 'error']).toContain(finalPosts()[0]?.body.state);
    const [after] = await app2.db.select().from(schema.assessment);
    expect(['READY', 'PARTIAL', 'FAILED']).toContain(after?.status);
    const [report] = await app2.db.select().from(schema.prReport);
    // Se marca como publicado tras la respuesta de GitHub.
    const until = Date.now() + 5_000;
    let reportedAt: number | null = report?.reportedAt ?? null;
    while (reportedAt === null && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
      reportedAt = (await app2.db.select().from(schema.prReport))[0]?.reportedAt ?? null;
    }
    expect(reportedAt).not.toBeNull();
  });
});
