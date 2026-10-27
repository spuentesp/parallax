// Evaluación de la explicación de PRs sobre un fixture con diff conocido. Cada
// corrida usa una base de datos nueva (la identidad del assessment es el digest
// del manifiesto: reusar la base devolvería el informe anterior) y el flujo
// real: crear assessment -> snapshot -> analyze -> explain (modelo real).
//
//   pnpm --filter @parallax/api exec tsx --env-file-if-exists=../../.env \
//     scripts/eval-pr.ts [--runs N] <worker-model> [<worker-model> ...]
//
// La verdad sale de engine_json (lo que el motor reportó), no de memoria.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { fetchAllContracts } from '../src/advisor/correlate.js';
import { loadConfig } from '../src/config.js';
import * as schema from '../src/db/schema.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import { buildApp } from '../src/server.js';
import { type EngineChange, normalizeText, routeOf, type Score, scoreExplanation } from './eval-pr-score.js';
import { type PrFixture, startPrFixture } from './pr-fixture.js';

const ORG = 'ws_pr_eval';
const TOKEN = 'pr-eval';

async function runOnce(fixture: PrFixture, workerModel: string): Promise<Score & { ms: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-pr-eval-'));
  const t0 = Date.now();
  const app = await buildApp({
    ...loadConfig({ ...process.env, NEMOTRON_WORKER_MODEL: workerModel }),
    port: 0,
    databasePath: join(dir, 'p.db'),
    lainAdapter: 'real',
    lainUrl: fixture.lainUrl,
    mcpTransport: 'http-sse',
    authTokens: [{ token: TOKEN, orgId: ORG, scopes: ['read', 'write', 'publish'] }],
    webBundlePath: dir,
  });
  try {
    await app.db.insert(schema.workspace).values({
      id: ORG,
      name: 'PR eval',
      description: 'fixture',
      lainUrl: fixture.lainUrl,
      createdAt: Date.now(),
    });
    for (const [name, sha, local] of [
      ['orders', fixture.orders.base, fixture.orders.path],
      ['billing', fixture.billing.sha, fixture.billing.path],
    ] as const) {
      await app.db.insert(schema.repo).values({
        id: `repo_${name}`,
        workspaceId: ORG,
        uri: `fixture/${name}`,
        sha,
        local,
        createdAt: Date.now(),
      });
    }
    const auth = { authorization: `Bearer ${TOKEN}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: auth,
      payload: { repo: 'orders', base: fixture.orders.base, head: fixture.orders.head, orgId: ORG },
    });
    if (created.statusCode >= 300) throw new Error(`create failed: ${created.body}`);
    const id = (created.json() as { assessment: { id: string } }).assessment.id;

    const deadline = Date.now() + 240_000;
    for (;;) {
      const r = await app.inject({ method: 'GET', url: `/api/assessments/${id}`, headers: auth });
      const status = (r.json() as { assessment: { status: string } }).assessment.status;
      if (['READY', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(status)) break;
      if (Date.now() > deadline) throw new Error(`assessment stuck in ${status}`);
      await new Promise((r2) => setTimeout(r2, 300));
    }

    const [row] = await app.db.select().from(schema.assessment).where(eq(schema.assessment.id, id));
    const [ex] = await app.db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, id));
    if (!row?.engineJson) throw new Error('assessment has no engine_json');
    const engine = JSON.parse(row.engineJson) as { diff?: { changes?: EngineChange[] } };
    const coverage = row.coverageJson
      ? (JSON.parse(row.coverageJson) as { complete?: boolean; missing?: string[] })
      : {};
    const payload = ex?.payload
      ? (JSON.parse(ex.payload) as {
          narrative?: string | null;
          conflicting_claims?: unknown[];
          tool_calls?: unknown[];
          pr?: { findings: Array<{ explanation: string | null }> } | null;
        })
      : {};

    const lain = await createLainClient({ lainUrl: fixture.lainUrl, apiVersion: '1' });
    const knownRoutes = new Set<string>();
    for (const snap of [row.baseId, row.headId]) {
      if (!snap) continue;
      for (const c of await fetchAllContracts(lain, { snapshot: snap as never })) {
        const route = routeOf(c.endpoint.key);
        if (route) knownRoutes.add(`${route.method} ${route.path}`);
      }
    }
    const changes = engine.diff?.changes ?? [];
    for (const c of changes) {
      const route = c.endpoint?.key ? routeOf(c.endpoint.key) : null;
      if (route) knownRoutes.add(`${route.method} ${normalizeText(route.path)}`);
    }

    // En modo PR la narrativa la compone el backend (nombra todos los hallazgos y
    // la cobertura): las rutas inventadas se buscan sólo en lo que escribió el
    // modelo, y "explicado" sale del registro por hallazgo.
    const composed = payload.narrative ?? '';
    if (process.env.PR_EVAL_PRINT) console.log(`citations: accepted=${(payload as { citations?: { accepted: unknown[] } }).citations?.accepted.length ?? 0} rejected=${JSON.stringify((payload as { citations?: { rejected: unknown[] } }).citations?.rejected ?? [])}\ncoverageJson=${row.coverageJson}\n--- narrative ---\n${composed}\n--- end ---`);
    const modelWritten = payload.pr
      ? [
          composed.split('\n\nFindings (engine')[0] ?? '',
          ...payload.pr.findings.map((f) => f.explanation ?? ''),
        ].join('\n')
      : composed;
    const score = scoreExplanation({
      changes,
      narrative: modelWritten,
      ...(payload.pr ? { explained: payload.pr.findings.map((f) => f.explanation !== null) } : {}),
      status: ex?.status ?? 'missing',
      knownRoutes,
      coverageIncomplete: coverage.complete === false || (coverage.missing?.length ?? 0) > 0,
      classConflicts: payload.conflicting_claims?.length ?? 0,
      toolCalls: payload.tool_calls?.length ?? 0,
    });
    return { ...score, ms: Date.now() - t0 };
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let runs = 1;
  const models: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--runs') runs = Number(args[++i]);
    else models.push(a);
  }
  if (models.length === 0) throw new Error('pass at least one worker model id');

  const fixture = await startPrFixture();
  const results: Array<Score & { ms: number; model: string }> = [];
  try {
    console.log(`PR eval on the fixture (orders ${fixture.orders.base.slice(0, 7)}..${fixture.orders.head.slice(0, 7)}), ${runs} run(s)/model`);
    for (const model of models) {
      for (let r = 0; r < runs; r++) {
        const s = await runOnce(fixture, model);
        results.push({ ...s, model });
        console.log(
          `${s.pass ? 'PASS' : 'FAIL'} ${model.split('/').pop()} [${s.status}] findings ${s.addressed}/${s.findings} tools=${s.toolCalls} ${(s.ms / 1000).toFixed(0)}s` +
            (s.missing.length ? ` missing=[${s.missing.join('; ')}]` : '') +
            (s.invented.length ? ` invented=[${s.invented.join(', ')}]` : '') +
            (s.verifiedConsumerNamed === false ? ' verified-consumer-not-named' : '') +
            (s.coverageGapStated === false ? ' coverage-gap-not-stated' : '') +
            (s.classConflicts ? ` class-conflicts=${s.classConflicts}` : ''),
        );
      }
    }
  } finally {
    await fixture.stop();
  }

  console.log('\n=== summary ===');
  for (const m of models) {
    const rs = results.filter((r) => r.model === m);
    const addressed = rs.reduce((n, r) => n + r.addressed, 0);
    const total = rs.reduce((n, r) => n + r.findings, 0);
    console.log(
      `${m}: ${rs.filter((r) => r.pass).length}/${rs.length} pass, findings addressed ${addressed}/${total}, ${rs.filter((r) => r.invented.length).length} with invented routes, avg ${(rs.reduce((n, r) => n + r.toolCalls, 0) / rs.length).toFixed(1)} tool calls`,
    );
  }
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error('eval error:', e);
  process.exitCode = 1;
});
