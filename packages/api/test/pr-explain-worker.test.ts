// El assessment real (worker + plugin + LAIN mock) debe poner los hallazgos del
// motor en el contexto del modelo. Sólo la llamada de red al modelo se simula.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  ordersS1: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  billing: '972651746b73f234031e3eae3c7b71b5d255d0ef',
  reports: '06f27bd72248a3c8513bc58807d98de15c286b8c',
};

interface Seen {
  system: string;
  user: string;
  tools: string[];
}

// Modelo simulado en el borde de red: lee los hallazgos F1…Fn del mensaje del
// usuario y entrega una explicación para cada uno (o para los que pida `only`).
function stubModel(seen: Seen[], only?: (id: string) => boolean): void {
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string } }>;
    };
    const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
    seen.push({
      system: body.messages.find((m) => m.role === 'system')?.content ?? '',
      user,
      tools: body.tools.map((t) => t.function.name),
    });
    const ids = [...user.matchAll(/^(F\d+) {2}/gm)].map((m) => m[1] as string);
    const findings = ids
      .filter((id) => (only ? only(id) : true))
      .map((id) => ({ id, explanation: `explained ${id}` }));
    return new Response(
      JSON.stringify({
        model: 'fake/nemotron',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'submit_answer',
                    arguments: JSON.stringify({ summary: 'overview', findings }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

describe('assessment explain step in PR mode', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-pr-explain-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 't', orgId: 'org_demo', scopes: ['read', 'write', 'publish'] },
        { token: 'r', orgId: 'org_demo', scopes: ['read'] },
      ],
      webBundlePath: join(dir, 'web'),
      nebiusToken: 'test-token',
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
    vi.unstubAllGlobals();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function assess() {
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: { authorization: 'Bearer t' },
      payload: { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' },
    });
    const id = (created.json() as { assessment: { id: string } }).assessment.id;
    await app.assessmentWorker.run(id);
    const [row] = await app.db.select().from(schema.assessment).where(eq(schema.assessment.id, id));
    const [ex] = await app.db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, id));
    return {
      engine: JSON.parse(row?.engineJson ?? '{}') as {
        diff: { changes: Array<{ kind: string; impact?: { class?: string } }> };
      },
      ex,
      payload: JSON.parse(ex?.payload ?? '{}') as {
        narrative: string;
        pr: { findings: Array<{ engine_class: string | null }>; unaddressed: string[] };
      },
    };
  }

  it('hands the model the engine findings, with their classes, instead of a bare question', async () => {
    const seen: Seen[] = [];
    stubModel(seen);
    const { engine } = await assess();
    expect(engine.diff.changes.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.system).toContain('pull-request explainer');
    expect(seen[0]?.tools).toContain('submit_answer');
    for (const [i, change] of engine.diff.changes.entries()) {
      expect(seen[0]?.user).toContain(`F${i + 1}  ${change.kind}`);
      expect(seen[0]?.user).toContain(`engine class: ${change.impact?.class ?? 'unclassified'}`);
    }
    expect(seen[0]?.user).toContain('Coverage:');
  });

  it('persists a per-finding explanation whose classes are the engine classes', async () => {
    stubModel([]);
    const { engine, ex, payload } = await assess();
    expect(ex?.status).toBe('available');
    expect(payload.pr.findings).toHaveLength(engine.diff.changes.length);
    expect(payload.pr.findings.map((f) => f.engine_class)).toEqual(
      engine.diff.changes.map((c) => c.impact?.class ?? null),
    );
    expect(payload.pr.unaddressed).toEqual([]);
    expect(payload.narrative).toContain('Findings (engine classifications are authoritative):');
  });

  it('serves the explanation text and the unexplained findings in the report, not just a status', async () => {
    stubModel([], (id) => id !== 'F1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: { authorization: 'Bearer t' },
      payload: { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' },
    });
    const id = (created.json() as { assessment: { id: string } }).assessment.id;
    await app.assessmentWorker.run(id);
    const report = (
      await app.inject({
        method: 'GET',
        url: `/api/assessments/${id}`,
        headers: { authorization: 'Bearer t' },
      })
    ).json() as {
      assessment: {
        explanation: { status: string; narrative?: string | null; unaddressed?: string[] };
      };
    };
    expect(report.assessment.explanation.status).toBe('failed:findings_unaddressed');
    expect(report.assessment.explanation.narrative).toContain('NOT EXPLAINED by the model.');
    expect(report.assessment.explanation.unaddressed).toEqual(['F1']);

    // La vista previa del comentario del PR lleva el mismo texto.
    const preview = (
      await app.inject({
        method: 'GET',
        url: `/api/assessments/${id}/comment-preview`,
        headers: { authorization: 'Bearer t' },
      })
    ).json() as { markdown?: string; body?: string };
    expect(JSON.stringify(preview)).toContain('NOT EXPLAINED by the model.');
  });

  it('records a visible failed status when the model leaves a finding unexplained', async () => {
    stubModel([], (id) => id !== 'F1');
    const { ex, payload } = await assess();
    expect(ex?.status).toBe('failed:findings_unaddressed');
    expect(payload.pr.unaddressed).toEqual(['F1']);
    // El informe estructural del motor no se ve afectado por el fallo del modelo.
    expect(payload.narrative).toContain('NOT EXPLAINED by the model.');
  });

  describe('POST /api/assessments/:id/reexplain', () => {
    async function finishedAssessment(): Promise<string> {
      const created = await app.inject({
        method: 'POST',
        url: '/api/assessments',
        headers: { authorization: 'Bearer t' },
        payload: { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: 'org_demo' },
      });
      const id = (created.json() as { assessment: { id: string } }).assessment.id;
      await app.assessmentWorker.run(id);
      return id;
    }
    async function report(id: string) {
      return (
        await app.inject({
          method: 'GET',
          url: `/api/assessments/${id}`,
          headers: { authorization: 'Bearer t' },
        })
      ).json() as {
        assessment: {
          status: string;
          explanation: { status: string; revision: number | null; narrative?: string | null };
        };
      };
    }

    it('stores a new revision that the report serves, and leaves the status alone', async () => {
      stubModel([], (id) => id !== 'F1'); // first run: F1 unexplained
      const id = await finishedAssessment();
      const before = await report(id);
      expect(before.assessment.explanation.revision).toBe(0);
      expect(before.assessment.explanation.narrative).toContain('NOT EXPLAINED by the model.');

      vi.unstubAllGlobals();
      const seen: Seen[] = [];
      stubModel(seen); // second run: every finding explained
      const res = await app.inject({
        method: 'POST',
        url: `/api/assessments/${id}/reexplain`,
        headers: { authorization: 'Bearer t' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ revision: 1, status: 'available' });
      expect(seen).toHaveLength(1);

      const after = await report(id);
      expect(after.assessment.status).toBe(before.assessment.status);
      expect(after.assessment.explanation.revision).toBe(1);
      expect(after.assessment.explanation.status).toBe('available');
      expect(after.assessment.explanation.narrative).not.toContain('NOT EXPLAINED by the model.');

      const steps = await app.db
        .select()
        .from(schema.jobStep)
        .where(eq(schema.jobStep.assessmentId, id));
      expect(steps.filter((s) => s.step === 'reexplain').map((s) => s.state)).toEqual(['done']);
    });

    it('keeps the previous revision and reports the cause when the model fails', async () => {
      stubModel([]);
      const id = await finishedAssessment();
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 503 }));
      const res = await app.inject({
        method: 'POST',
        url: `/api/assessments/${id}/reexplain`,
        headers: { authorization: 'Bearer t' },
      });
      expect(res.statusCode).toBe(502);
      // The cause travels with the status, so a failure can be diagnosed from the response.
      expect((res.json() as { detail: string }).detail).toMatch(/^failed:[a-z_]+: .+/);
      const after = await report(id);
      expect(after.assessment.explanation.revision).toBe(0);
      expect(after.assessment.explanation.status).toBe('available');
      const steps = await app.db
        .select()
        .from(schema.jobStep)
        .where(eq(schema.jobStep.assessmentId, id));
      expect(steps.filter((s) => s.step === 'reexplain').map((s) => s.state)).toEqual(['failed']);
    });

    it('needs the write scope and an existing assessment', async () => {
      const readOnly = await app.inject({
        method: 'POST',
        url: '/api/assessments/a_missing/reexplain',
        headers: { authorization: 'Bearer r' },
      });
      expect(readOnly.statusCode).toBe(403);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/assessments/a_missing/reexplain',
        headers: { authorization: 'Bearer t' },
      });
      expect(missing.statusCode).toBe(404);
    });
  });
});
