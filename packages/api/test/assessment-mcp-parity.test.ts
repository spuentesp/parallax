// P09 — la misma evaluación se consulta por HTTP y por MCP y el informe
// coincide: identidad, hallazgos y cobertura salen del mismo servicio.

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
};

describe('web/MCP parity (P09)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let session: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-parity-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 't', orgId: 'org_demo', scopes: ['read', 'write', 'publish'] }],
      webBundlePath: join(dir, 'web'),
    });
    await app.db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
    for (const [name, sha] of Object.entries({ orders: SHAS.ordersBase, billing: SHAS.billing })) {
      await app.db.insert(schema.repo).values({
        id: `repo_${name}`,
        workspaceId: 'org_demo',
        uri: `fixture/${name}`,
        sha,
        local: null,
        createdAt: Date.now(),
      });
    }

    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: authHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'parity', version: '0' },
        },
      },
    });
    session = String((init.headers as Record<string, unknown>)['mcp-session-id']);
    expect(session).toBeTruthy();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const authHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer t',
  };

  async function mcp(payload: Record<string, unknown>): Promise<{ statusCode: number; body: string }> {
    const r = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: session ? { ...authHeaders, 'mcp-session-id': session } : authHeaders,
      payload: payload as never,
    });
    return { statusCode: r.statusCode, body: r.body };
  }

  function parseSse(body: string): Record<string, unknown> {
    const line = body.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`no data line in SSE body: ${body.slice(0, 200)}`);
    return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
  }

  async function mcpCall(name: string, args: unknown): Promise<unknown> {
    const r = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    expect(r.statusCode).toBe(200);
    const envelope = parseSse(r.body) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
      error?: unknown;
    };
    expect(envelope.error).toBeUndefined();
    const text = envelope.result?.content?.[0]?.text;
    expect(text).toBeTruthy();
    return JSON.parse(text ?? '{}');
  }

  it('parallax_get_assessment returns the same report as GET /api/assessments/:id', async () => {
    const body = { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' };
    const created = await app.inject({ method: 'POST', url: '/api/assessments', headers: authHeaders, payload: body });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { assessment: { id: string } }).assessment.id;
    await app.assessmentWorker.run(id);

    const http = await app.inject({ method: 'GET', url: `/api/assessments/${id}`, headers: authHeaders });
    expect(http.statusCode).toBe(200);
    const httpReport = (http.json() as { assessment: Record<string, unknown> }).assessment;

    const viaMcp = (await mcpCall('parallax_get_assessment', { assessmentId: id })) as {
      assessment: Record<string, unknown>;
    };

    // Misma identidad, mismos hallazgos, misma cobertura (P09).
    expect(viaMcp.assessment.id).toBe(httpReport.id);
    expect(viaMcp.assessment.inputDigest).toBe(httpReport.inputDigest);
    expect(viaMcp.assessment.status).toBe(httpReport.status);
    expect(JSON.stringify(viaMcp.assessment.findings)).toBe(JSON.stringify(httpReport.findings));
    expect(JSON.stringify(viaMcp.assessment.coverage)).toBe(JSON.stringify(httpReport.coverage));
    expect(JSON.stringify(viaMcp.assessment.manifest)).toBe(JSON.stringify(httpReport.manifest));
    expect(JSON.stringify(viaMcp.assessment.explanation)).toBe(JSON.stringify(httpReport.explanation));
  });

  it('parallax_assess_pr reuses the same assessment as POST /api/assessments (INV 4)', async () => {
    const body = { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' };
    const created = await app.inject({ method: 'POST', url: '/api/assessments', headers: authHeaders, payload: body });
    const id = (created.json() as { assessment: { id: string } }).assessment.id;

    const viaMcp = (await mcpCall('parallax_assess_pr', body)) as {
      assessment: { id: string };
      created: boolean;
    };
    expect(viaMcp.created).toBe(false);
    expect(viaMcp.assessment.id).toBe(id);
  });

  it('parallax_assess_pr creates a new assessment through the same service', async () => {
    const viaMcp = (await mcpCall('parallax_assess_pr', {
      repo: 'orders',
      base: SHAS.ordersBase,
      head: '0931d02684c2d1f6df7f0353f6e6bdd6c07ecc2c',
      orgId: 'org_demo',
    })) as { assessment: { id: string; status: string }; created: boolean };
    expect(viaMcp.created).toBe(true);
    expect(viaMcp.assessment.status).toBe('QUEUED');

    const http = await app.inject({
      method: 'GET',
      url: `/api/assessments/${viaMcp.assessment.id}`,
      headers: authHeaders,
    });
    expect(http.statusCode).toBe(200);
  });

  it('parallax_get_assessment reports NotFound for an unknown id', async () => {
    const result = (await mcpCall('parallax_get_assessment', { assessmentId: 'a_missing' })) as {
      code?: string;
    };
    expect(result.code).toBe('NotFound');
  });
});
