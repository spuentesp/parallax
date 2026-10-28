// Flujo G2 completo contra el adaptador mock: creación idempotente, informe
// persistido leíble por HTTP, eventos y exclusiones visibles (INV 3/4/5).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  ordersS1: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  billing: '972651746b73f234031e3eae3c7b71b5d255d0ef',
  reports: '06f27bd72248a3c8513bc58807d98de15c286b8c',
};

describe('assessment routes (G2 flow)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-assess-routes-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'org_demo', scopes: ['read', 'write', 'publish'] }],
      webBundlePath: join(dir, 'web'),
    });
    await app.db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
    for (const [name, sha] of Object.entries({
      orders: SHAS.ordersBase,
      billing: SHAS.billing,
      reports: SHAS.reports,
    })) {
      await app.db.insert(schema.repo).values({
        id: `repo_${name}`,
        workspaceId: 'org_demo',
        uri: `fixture/${name}`,
        sha,
        local: null,
        createdAt: Date.now(),
      });
    }
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = { authorization: 'Bearer t' };
  const body = { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' };

  async function waitForTerminal(id: string) {
    // El POST encola el runner en segundo plano; esperamos el estado terminal.
    await app.assessmentWorker.run(id);
    const r = await app.inject({ method: 'GET', url: `/api/assessments/${id}`, headers: auth });
    return r.json() as {
      assessment: {
        id: string;
        status: string;
        findings: Array<Record<string, unknown>>;
        coverage: Record<string, unknown>;
        explanation: { status: string };
      };
    };
  }

  it('POST creates 201 with the resolved workspace manifest; second POST is idempotent', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const created = first.json() as {
      assessment: { id: string; inputDigest: string };
      created: boolean;
    };
    expect(created.created).toBe(true);
    expect(created.assessment.inputDigest).toMatch(/^sha256_[0-9a-f]{64}$/);

    const second = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    const reused = second.json() as { assessment: { id: string }; created: boolean };
    expect(reused.created).toBe(false);
    expect(reused.assessment.id).toBe(created.assessment.id);

    const rows = await app.db.select().from(schema.assessment);
    expect(rows).toHaveLength(1);
    // El manifiesto fija TODOS los repos del workspace en ambas vistas (§5).
    const manifest = JSON.parse(rows[0]?.manifestJson ?? '{}') as {
      base: { repos: Record<string, string> };
      head: { repos: Record<string, string> };
      configured: string[];
    };
    expect(manifest.base.repos).toEqual({
      billing: SHAS.billing,
      reports: SHAS.reports,
      orders: SHAS.ordersBase,
    });
    expect(manifest.head.repos).toEqual({
      billing: SHAS.billing,
      reports: SHAS.reports,
      orders: SHAS.ordersS1,
    });
    expect(manifest.configured).toEqual(['billing', 'orders', 'reports']);
  });

  it('GET serves the persisted report: findings, coverage and visible explanation failure', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: body,
    });
    const id = (created.json() as { assessment: { id: string } }).assessment.id;

    const report = await waitForTerminal(id);
    expect(['READY', 'PARTIAL']).toContain(report.assessment.status);
    expect(
      report.assessment.findings.some(
        (f) => f.kind === 'FieldRemoved' && f.field === 'customer_id',
      ),
    ).toBe(true);
    const coverage = report.assessment.coverage as {
      complete?: boolean;
      scope?: { unreviewed?: Array<{ repo?: string }> };
      missing?: string[];
    };
    expect(coverage.complete).toBe(false);
    // INV 3: el motor no revisó reports y el informe lo dice.
    expect(coverage.scope?.unreviewed?.some((n) => n.repo === 'reports')).toBe(true);
    // G2 sin modelo (P08): la explicación registra un fallo visible, no un
    // silencio que finja explicar; el informe estructural sigue completo.
    expect(report.assessment.explanation.status).toBe('failed:no_model_configured');
  });

  it('GET /events returns the persisted event log', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: body,
    });
    const id = (created.json() as { assessment: { id: string } }).assessment.id;
    await waitForTerminal(id);

    const events = await app.inject({
      method: 'GET',
      url: `/api/assessments/${id}/events`,
      headers: auth,
    });
    expect(events.statusCode).toBe(200);
    const log = (events.json() as { events: Array<{ type: string; seq: number }> }).events;
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log[0]?.type).toBe('created');
    expect(log.some((e) => e.type === 'transition')).toBe(true);
    // Los eventos se persisten con seq monótono.
    const seqs = log.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('same idempotency_key with a different body is rejected with 409 (§4)', async () => {
    const withKey = { ...body, idempotencyKey: 'key-123' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: withKey,
    });
    expect(first.statusCode).toBe(201);

    const same = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: withKey,
    });
    expect(same.statusCode).toBe(200);
    expect((same.json() as { created: boolean }).created).toBe(false);

    const different = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: { ...withKey, head: '0931d02684c2d1f6df7f0353f6e6bdd6c07ecc2c' },
    });
    expect(different.statusCode).toBe(409);
    expect((different.json() as { detail: string }).detail).toContain('idempotency_key');
  });

  it('an excluded repo is named in the coverage and never counted as reviewed (INV 3)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: { ...body, excludeRepos: ['billing'] },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { assessment: { id: string } }).assessment.id;

    const report = await waitForTerminal(id);
    const coverage = report.assessment.coverage as {
      complete?: boolean;
      summary?: string;
      scope?: { reviewed?: string[]; unreviewed?: Array<{ repo?: string; reason?: string }> };
    };
    expect(coverage.complete).toBe(false);
    expect(coverage.scope?.reviewed).not.toContain('billing');
    const excluded = coverage.scope?.unreviewed?.find((n) => n.repo === 'billing');
    expect(excluded?.reason).toBe('excluded');
    expect(coverage.summary).toContain('billing');
    // Un vacío no autoriza a concluir ausencia de impacto.
    expect(coverage.summary).toMatch(/no autoriza|incompleta/i);
  });

  it('unknown workspace yields 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: { ...body, orgId: 'ws_missing' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('branch names are rejected: only resolved SHAs are identity (§5)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: { ...body, head: 'feature-branch' },
    });
    expect(r.statusCode).toBe(400);
  });
});
