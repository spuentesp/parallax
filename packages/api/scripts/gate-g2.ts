// G2 gate — informe reproducible persistido, idempotente e igual en web y MCP.
//
// Es la "evidencia de salida" de §15 (G2 producto): el análisis se deriva de
// get_service/diff_contracts sin ningún modelo configurado, sobrevive a un
// reinicio (INV 5), reutiliza el mismo trabajo ante la misma solicitud
// (INV 4) y sirve el mismo informe por HTTP y por MCP (P09). Una cobertura
// incompleta se declara, nunca se presenta como "sin impacto" (INV 3).
//
// Requiere un LAIN con perfil contracts sobre test-repos/contracts-fixture.
//   LAIN_URL=http://localhost:9997/mcp pnpm --filter @parallax/api exec tsx scripts/gate-g2.ts
//
// DATABASE_PATH por defecto /tmp/parallax-g2.db — deliberadamente distinto de
// /tmp/parallax.db que usa la app en :8080.

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createLainClient } from '../src/lain-adapter/client.js';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';
import { AssessmentWorker } from '../src/worker/assessment-worker.js';

const LAIN_URL = process.env.LAIN_URL ?? 'http://localhost:9997/mcp';
const DB_PATH = process.env.DATABASE_PATH ?? '/tmp/parallax-g2.db';
const ORG = 'ws_g2';

const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  ordersS1: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  ordersS2: '0931d02684c2d1f6df7f0353f6e6bdd6c07ecc2c',
  billingBase: '972651746b73f234031e3eae3c7b71b5d255d0ef',
  reportsBase: '06f27bd72248a3c8513bc58807d98de15c286b8c',
  platformBase: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c',
} as const;

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Report {
  id: string;
  status: string;
  inputDigest: string;
  findings: Array<Record<string, unknown>>;
  coverage: {
    complete?: boolean;
    summary?: string;
    missing?: string[];
    scope?: {
      reviewed?: string[];
      unreviewed?: Array<{ repo?: string; reason?: string }>;
    };
  } | null;
  explanation: { status?: string };
}

async function waitForReport(
  app: Awaited<ReturnType<typeof buildApp>>,
  id: string,
  timeoutMs = 120_000,
): Promise<Report> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await app.inject({
      method: 'GET',
      url: `/api/assessments/${id}`,
      headers: { authorization: 'Bearer g2' },
    });
    const report = (r.json() as { assessment: Report }).assessment;
    if (['READY', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(report.status)) return report;
    if (Date.now() > deadline) throw new Error(`assessment ${id} stuck in ${report.status}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

interface McpToolResult {
  assessment?: Report;
  created?: boolean;
  code?: string;
  message?: string;
}

async function main(): Promise<void> {
  console.log(`G2 gate contra ${LAIN_URL} (db=${DB_PATH})`);
  // DB temporal: no se toca /tmp/parallax.db de la app en :8080.
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
  mkdirSync(join(tmpdir()), { recursive: true });

  // Sin NEBIUS_TOKEN / API key: el informe estructural no depende de un modelo.
  const app = await buildApp({
    port: 0,
    databasePath: DB_PATH,
    lainAdapter: 'real',
    lainUrl: LAIN_URL,
    mcpTransport: 'http-sse',
    authTokens: [{ token: 'g2', orgId: ORG, scopes: ['read', 'write', 'publish'] }],
    webBundlePath: join(tmpdir(), 'parallax-g2-web'),
  });
  check('el arranque no requiere nebiusToken', app.config.nebiusToken === undefined);

  // Workspace con los 4 repos del fixture, fijados a sus SHAs base.
  await app.db
    .insert(schema.workspace)
    .values({ id: ORG, name: 'G2', description: 'gate', lainUrl: LAIN_URL, createdAt: Date.now() });
  for (const [name, sha] of Object.entries({
    orders: SHAS.ordersBase,
    billing: SHAS.billingBase,
    reports: SHAS.reportsBase,
    platform: SHAS.platformBase,
  })) {
    await app.db.insert(schema.repo).values({
      id: `repo_${name}`,
      workspaceId: ORG,
      uri: `contracts-fixture/${name}`,
      sha,
      local: null,
      createdAt: Date.now(),
    });
  }

  const auth = { authorization: 'Bearer g2' };
  const s1Body = { repo: 'orders', base: SHAS.ordersBase, head: SHAS.ordersS1, orgId: ORG };

  // ── 1. Idempotencia (INV 4) ─────────────────────────────────────
  console.log('\n=== G2.1 idempotencia: la misma solicitud no crea dos trabajos ===');
  const first = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: s1Body,
  });
  check('POST devuelve 201 y created:true', first.statusCode === 201 && first.json().created === true);
  const created = first.json() as { assessment: { id: string; inputDigest: string } };
  const id = created.assessment.id;
  check(
    'input_digest es un SHA-256 del manifiesto resuelto',
    /^sha256_[0-9a-f]{64}$/.test(created.assessment.inputDigest),
    created.assessment.inputDigest.slice(0, 23),
  );

  const second = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: s1Body,
  });
  const reused = second.json() as { assessment: { id: string }; created: boolean };
  check('la segunda llamada reutiliza el trabajo (created:false)', reused.created === false);
  check('el id es el mismo', reused.assessment.id === id, id);
  const digestRows = await app.db
    .select()
    .from(schema.assessment)
    .where(eq(schema.assessment.inputDigest, created.assessment.inputDigest));
  check('la base tiene exactamente una fila para el digest', digestRows.length === 1);

  // ── 2. Informe reproducible sin modelo (§15 G2) ─────────────────
  console.log('\n=== G2.2 s1 end-to-end sin modelo: FieldRemoved de customer_id ===');
  const report = await waitForReport(app, id);
  check(
    'el estado terminal es READY o PARTIAL (nunca FAILED)',
    report.status === 'READY' || report.status === 'PARTIAL',
    report.status,
  );
  const removed = report.findings.filter(
    (f) => f.kind === 'FieldRemoved' && f.field === 'customer_id',
  );
  check('el informe contiene el FieldRemoved de customer_id', removed.length > 0, `${removed.length} hallazgos`);
  check(
    'los hallazgos apuntan al provider orders',
    removed.length > 0 && removed.every((f) => (f.endpoint as { service?: string } | undefined)?.service === 'orders' || f.service === 'orders'),
  );
  check('el informe trae cobertura presentada', report.coverage != null);
  check(
    'la cobertura nombra los repos revisados',
    (report.coverage?.scope?.reviewed?.length ?? 0) >= 4,
    JSON.stringify(report.coverage?.scope?.reviewed ?? null),
  );
  check(
    'sin modelo, la explicación registra el fallo visible (P08)',
    report.explanation.status === 'failed:no_model_configured',
    report.explanation.status,
  );
  // Reproducibilidad: mismo manifiesto → misma identidad, sin re-ejecución.
  const third = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: s1Body,
  });
  const again = third.json() as { assessment: { id: string }; created: boolean };
  check('repetir la solicitud devuelve el mismo informe persistido', again.created === false && again.assessment.id === id);
  // Y el artefacto crudo del motor queda para auditar (§13).
  const raw = await app.db
    .select()
    .from(schema.assessment)
    .where(eq(schema.assessment.id, id));
  const engine = JSON.parse(raw[0]?.engineJson ?? '{}') as {
    analyzerVersion?: string;
    diff?: { changes?: unknown[] };
  };
  check(
    'engine_json conserva el output crudo del motor',
    engine.analyzerVersion != null && Array.isArray(engine.diff?.changes),
    `analyzerVersion=${engine.analyzerVersion} changes=${engine.diff?.changes?.length ?? 0}`,
  );

  // ── 3. Supervivencia a reinicio (INV 5) ─────────────────────────
  console.log('\n=== G2.3 reinicio: el informe se lee y recover() no duplica ===');
  const sqlite2 = new Database(DB_PATH);
  sqlite2.pragma('journal_mode = WAL');
  sqlite2.pragma('foreign_keys = ON');
  const db2 = drizzle(sqlite2, { schema });
  const worker2 = new AssessmentWorker(db2, { getLain: async () => createLainClient({ lainUrl: LAIN_URL, apiVersion: '1', timeoutMs: 60_000 }) });
  const survived = await worker2.get(id);
  check('el informe sigue legible tras el reinicio', survived != null);
  check(
    'el estado y los artefactos no se perdieron',
    survived?.status === report.status && survived?.engineJson != null && survived?.coverageJson != null,
    survived?.status,
  );
  const recovered = await worker2.recover();
  check('recover() no reanuda nada (todo terminal)', recovered.length === 0, JSON.stringify(recovered));
  const afterRecover = await worker2.get(id);
  check('el informe quedó intacto', afterRecover?.status === report.status && afterRecover?.engineJson === survived?.engineJson);

  // Un trabajo encolado a medias se REANUDA, no se falla (INV 5).
  const queued = await worker2.create({
    orgId: ORG,
    manifest: {
      base: { repos: { orders: SHAS.ordersBase, billing: SHAS.billingBase } },
      head: { repos: { orders: SHAS.ordersS2, billing: SHAS.billingBase } },
      configured: ['billing', 'orders'],
      excluded: [],
      configHash: null,
    },
  });
  check('worker2 crea un segundo trabajo distinto (s2)', queued.created === true, queued.assessment.id);
  const resumed = await worker2.recover();
  check('recover() reanuda el trabajo encolado', resumed.includes(queued.assessment.id), JSON.stringify(resumed));
  const resumedRec = await worker2.get(queued.assessment.id);
  check(
    'la reanudación termina en estado utilizable, no en FAILED',
    resumedRec?.status === 'READY' || resumedRec?.status === 'PARTIAL',
    resumedRec?.status,
  );
  const allRows = await db2.select().from(schema.assessment);
  check('no se crearon trabajos fantasma', allRows.length === 2, `${allRows.length} assessments`);
  const s1Rows = await db2
    .select()
    .from(schema.assessment)
    .where(eq(schema.assessment.id, id));
  check('el informe s1 sobrevive intacto tras la recuperación', s1Rows.length === 1 && s1Rows[0]?.status === report.status);
  sqlite2.close();

  // ── 4. Paridad web/MCP (P09) ────────────────────────────────────
  console.log('\n=== G2.4 paridad web/MCP: el mismo informe por ambos canales ===');
  const init = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gate-g2', version: '0' } },
    },
  });
  const session = String((init.headers as Record<string, unknown>)['mcp-session-id']);
  check('la sesión MCP se inicializa', session.length > 0);

  async function mcpCall(name: string, args: unknown): Promise<McpToolResult> {
    const r = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...auth,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': session,
      },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    });
    const line = r.body.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`no SSE data in MCP response: ${r.body.slice(0, 200)}`);
    const envelope = JSON.parse(line.slice('data: '.length)) as {
      result?: { content?: Array<{ text?: string }> };
    };
    return JSON.parse(envelope.result?.content?.[0]?.text ?? '{}') as McpToolResult;
  }

  const httpReport = (await app.inject({
    method: 'GET',
    url: `/api/assessments/${id}`,
    headers: auth,
  }).then((r) => r.json())) as { assessment: Report };

  const mcpGet = await mcpCall('parallax_get_assessment', { assessmentId: id });
  check('parallax_get_assessment devuelve el informe', mcpGet.assessment?.id === id);
  check(
    'identidad idéntica (id, digest, estado)',
    mcpGet.assessment?.id === httpReport.assessment.id &&
      mcpGet.assessment?.inputDigest === httpReport.assessment.inputDigest &&
      mcpGet.assessment?.status === httpReport.assessment.status,
  );
  check(
    'hallazgos idénticos',
    JSON.stringify(mcpGet.assessment?.findings) === JSON.stringify(httpReport.assessment.findings),
  );
  check(
    'cobertura idéntica',
    JSON.stringify(mcpGet.assessment?.coverage) === JSON.stringify(httpReport.assessment.coverage),
  );

  const mcpAssess = await mcpCall('parallax_assess_pr', s1Body);
  check(
    'parallax_assess_pr reutiliza el mismo trabajo (INV 4 por MCP)',
    mcpAssess.created === false && mcpAssess.assessment?.id === id,
  );

  // ── 5. Honestidad de la cobertura (INV 3) ───────────────────────
  console.log('\n=== G2.5 un repo excluido se nombra; nada se presenta como completo ===');
  const excludedPost = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: { ...s1Body, excludeRepos: ['reports'], idempotencyKey: 'g2-exclude-reports' },
  });
  check('la exclusión produce un trabajo nuevo (digest distinto)', excludedPost.statusCode === 201);
  const excludedId = (excludedPost.json() as { assessment: { id: string } }).assessment.id;
  const excludedReport = await waitForReport(app, excludedId);
  check(
    'coverage.complete es false',
    excludedReport.coverage?.complete === false,
    String(excludedReport.coverage?.complete),
  );
  check(
    'reports NO figura como revisado',
    !(excludedReport.coverage?.scope?.reviewed ?? []).includes('reports'),
    JSON.stringify(excludedReport.coverage?.scope?.reviewed ?? null),
  );
  const excludedNote = (excludedReport.coverage?.scope?.unreviewed ?? []).find(
    (n) => n.repo === 'reports',
  );
  check(
    'reports figura como no revisado con cause visible',
    excludedNote?.reason === 'excluded',
    JSON.stringify(excludedNote ?? null),
  );
  check(
    'el relato de cobertura nombra reports y no autoriza a concluir ausencia de impacto',
    (excludedReport.coverage?.summary ?? '').includes('reports') &&
      /no autoriza|incompleta/i.test(excludedReport.coverage?.summary ?? ''),
    excludedReport.coverage?.summary,
  );
  const excludedEvents = await app.inject({
    method: 'GET',
    url: `/api/assessments/${excludedId}/events`,
    headers: auth,
  });
  const eventLog = (excludedEvents.json() as { events: Array<{ type: string }> }).events;
  check('el log de eventos persistido cubre el ciclo completo', eventLog.length >= 4, `${eventLog.length} eventos`);

  // Mismo idempotency_key con otro cuerpo → 409 (§4).
  const conflict = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: { ...s1Body, excludeRepos: ['reports'], idempotencyKey: 'g2-exclude-reports' },
  });
  // Mismo cuerpo → reutiliza; cuerpo distinto con la misma key → 409.
  check(
    'misma key + mismo cuerpo reutiliza el trabajo',
    conflict.statusCode === 200 && (conflict.json() as { created: boolean }).created === false,
    `status=${conflict.statusCode}`,
  );
  const conflict2 = await app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: auth,
    payload: { ...s1Body, head: SHAS.ordersS2, idempotencyKey: 'g2-exclude-reports' },
  });
  check('misma key + cuerpo distinto → 409', conflict2.statusCode === 409, `status=${conflict2.statusCode}`);

  await app.close();

  console.log('\n=== G2 RESULT ===');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`G2: FAIL (${failures} fallas)`);
    process.exitCode = 1;
  } else {
    console.log('G2: PASS');
  }
}

main().catch((e) => {
  console.error('G2 gate error:', e);
  process.exitCode = 1;
});
