// Advisor gate — señales del §4 en los checkouts de Saleor, correlación con
// el motor vivo, propuestas y YAML del §6.
//
// Es la evidencia de salida del config advisor: el escaneo ve los puntos
// ciegos de LAIN (SDL copiado, ops gitignored, env, wrappers, codegen), la
// correlación explica los 63 graphql_no_op del storefront con archivos
// concretos, provides_graphql apunta al dashboard y NUNCA al provider real,
// y cada binding presentado como aplicable viene de un check_binding
// valid:true con su bindings_entry verbatim. Nada se aplica: el advisor
// propone, el operador aplica.
//
// Requiere un LAIN con perfil contracts sobre test-repos/repos-saleor.yaml.
//   LAIN_URL=http://localhost:9999/mcp pnpm --filter @parallax/api exec tsx scripts/gate-advisor.ts

import { join } from 'node:path';
import { waitForIndexedRepos } from './lain-readiness.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import { runAdvisor, type AdvisorReport } from '../src/advisor/index.js';

const LAIN_URL = process.env.LAIN_URL ?? 'http://localhost:9999/mcp';
const REPOS_ROOT = process.env.TEST_REPOS ?? join(process.cwd(), '..', '..', 'test-repos');

const REPOS = [
  { id: 'saleor', root: join(REPOS_ROOT, 'saleor') },
  { id: 'saleor-dashboard', root: join(REPOS_ROOT, 'saleor-dashboard') },
  { id: 'storefront', root: join(REPOS_ROOT, 'storefront') },
] as const;

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

function filesOf(
  report: AdvisorReport,
  kind: keyof typeof report.signalsByKind,
  repo?: string,
): string[] {
  return report.findings
    .filter((s) => s.kind === kind && (!repo || s.repo === repo))
    .map((s) => s.file);
}

async function main(): Promise<void> {
  console.log(`Advisor gate contra ${LAIN_URL}`);
  const engine = await createLainClient({ lainUrl: LAIN_URL, apiVersion: '1', timeoutMs: 120_000 });
  console.log(`handshake OK (analyzerVersion=${engine.analyzerVersion})`);

  await waitForIndexedRepos(engine, REPOS.map((r) => r.id));
  const report = await runAdvisor(engine, [...REPOS], 'live');

  console.log('\n=== A.1 señales del §4 en los checkouts (sin respetar .gitignore) ===');
  const sfOps = report.findings.filter(
    (s) => s.kind === 'graphql_operations' && s.repo === 'storefront',
  );
  const sfOpFiles = new Set(sfOps.map((s) => s.file));
  check(
    'storefront: 32+ operaciones GraphQL completas',
    sfOpFiles.size >= 32,
    `${sfOpFiles.size} documentos, ${sfOps.length} operaciones`,
  );

  const fragments = filesOf(report, 'fragment_only_document', 'storefront');
  check(
    'storefront: documentos de sólo fragmentos (consumidores invisibles para LAIN)',
    fragments.length >= 2 && fragments.some((f) => f.includes('OrderDetailsFragment')),
    fragments.join(', '),
  );

  const sdl = filesOf(report, 'sdl_copy', 'saleor-dashboard');
  check(
    'dashboard: copias de SDL que envenenan el key space del provider',
    sdl.length >= 3 &&
      sdl.includes('schema.graphql') &&
      sdl.includes('schema-main.graphql') &&
      sdl.includes('schema-staging.graphql'),
    sdl.join(', '),
  );

  const env = report.findings.find(
    (s) =>
      s.kind === 'env_base_url' &&
      s.envVar === 'NEXT_PUBLIC_SALEOR_API_URL' &&
      s.file === 'src/lib/saleor/client.ts',
  );
  check(
    'env var usada como base URL detectada con archivo y línea',
    env !== undefined && (env.line ?? 0) > 0,
    env ? `${env.file}:${env.line}` : 'NEXT_PUBLIC_SALEOR_API_URL no vista en src/lib/saleor/client.ts',
  );

  const wrapper = report.findings.find(
    (s) =>
      s.kind === 'wrapped_fetcher' &&
      s.repo === 'storefront' &&
      (s.detail ?? '').includes('fetchWithTimeout'),
  );
  check(
    'fetcher envuelto (fetchWithTimeout) corroborando consumo HTTP',
    wrapper !== undefined,
    wrapper ? `${wrapper.file}:${wrapper.line}` : 'no encontrado',
  );

  const codegen = filesOf(report, 'codegen_config');
  check(
    'codegen configs que ligan operaciones ↔ esquema',
    codegen.length >= 3 &&
      codegen.some((f) => f.includes('codegen')) &&
      codegen.some((f) => f.includes('graphql.config')),
    codegen.join(', '),
  );

  const generated = report.findings.filter(
    (s) => s.kind === 'gitignored_generated' && (s.detail ?? '').includes('src/checkout/graphql/generated'),
  );
  check(
    'directorio de codegen gitignored reportado como ciego del walker',
    generated.length >= 1,
    generated[0]?.detail ?? 'no encontrado',
  );

  console.log('\n=== A.2 correlación con el motor (paginada al agotamiento) ===');
  const sfReasons = report.correlation.byRepoReason.storefront ?? {};
  const sf = report.correlation.graphqlNoOp.byRepo.storefront ?? { total: 0, matched: 0, keys: 0 };
  check(
    'list_unresolved agotado: 78 ítems del storefront',
    (sfReasons.graphql_no_op ?? 0) + (sfReasons.no_match ?? 0) + (sfReasons.no_route_in_service ?? 0) === 78,
    `storefront=${JSON.stringify(sfReasons)}; total todas las repos=${report.correlation.unresolvedTotal} (todas las páginas)`,
  );
  check(
    '63 graphql_no_op del storefront en la correlación',
    sfReasons.graphql_no_op === 63 && sf.total === 63,
    `por repo=${String(sf.total)}`,
  );
  check(
    'el resto de razones explicadas (no_match / no_route_in_service)',
    (sfReasons.no_match ?? 0) >= 1 && (sfReasons.no_route_in_service ?? 0) >= 1,
    `no_match=${String(sfReasons.no_match)} no_route_in_service=${String(sfReasons.no_route_in_service)}`,
  );
  check(
    'los 63 graphql_no_op del storefront correlacionan con señales escaneadas',
    sf.matched === sf.total && sf.total === 63,
    `correlacionados=${sf.matched}/${sf.total}, llaves=${sf.keys}`,
  );
  check(
    'las (op, field) del storefront tienen proveedor en el índice',
    sf.keys >= 27,
    `${sf.keys} llaves distintas`,
  );
  const dupProduct = report.correlation.providerGroups.find((p) => p.key === 'graphql:query:product');
  check(
    'graphql:query:product tiene dos grupos de proveedores (saleor + copias del dashboard)',
    dupProduct !== undefined &&
      dupProduct.groups.length === 2 &&
      dupProduct.groups.some((x) => x.service === 'saleor-api' && x.boundConsumers > 0) &&
      dupProduct.groups.some((x) => x.service === 'saleor-dashboard'),
    JSON.stringify(
      dupProduct?.groups.map((x) => ({
        service: x.service,
        bound: x.boundConsumers,
        files: x.providers.map((p) => p.path),
      })),
    ),
  );
  check(
    'las llaves duplicadas explican el disparador graphql_no_op',
    report.correlation.duplicatedKeys.length > 10,
    `${report.correlation.duplicatedKeys.length} llaves con >1 proveedor`,
  );

  console.log('\n=== A.3 propuestas ===');
  const pg = report.proposals.providesGraphql;
  check(
    'provides_graphql: false apunta a saleor-dashboard',
    pg.some(
      (p) => p.repo === 'saleor-dashboard' && p.service === 'saleor-dashboard' && p.provides_graphql === false,
    ),
    pg.map((p) => `${p.service}(${p.repo})`).join(', ') || 'ninguna',
  );
  check('provides_graphql: false NO aplica al provider real (saleor)', !pg.some((p) => p.repo === 'saleor'));
  const pgDash = pg.find((p) => p.repo === 'saleor-dashboard');
  check(
    'la propuesta lleva evidencia: copias SDL + señales de consumo',
    (pgDash?.evidence.sdlCopies.length ?? 0) >= 3 && (pgDash?.evidence.consumption.length ?? 0) >= 1,
    `sdl=${JSON.stringify(pgDash?.evidence.sdlCopies)} consumo=${JSON.stringify(pgDash?.evidence.consumption.slice(0, 3))}`,
  );

  console.log('\n=== A.4 bindings validados contra check_binding ===');
  const cap = report.capability;
  console.log(`  sondeo de capacidad: ${cap.graphqlBindings} — ${cap.detail}`);
  const bindings = report.proposals.bindings;
  const applicable = bindings.filter((b) => b.status === 'applicable');
  check(
    'todo binding presentado como aplicable viene de valid:true con bindings_entry verbatim',
    applicable.every(
      (b) => b.verdict?.valid === true && typeof b.bindingsEntry === 'string' && b.bindingsEntry.startsWith('- consumer:'),
    ),
    `${applicable.length} aplicables de ${bindings.length} candidatos`,
  );
  if (cap.graphqlBindings !== 'supported') {
    check(
      'degradación: sin soporte GraphQL, ningún binding se presenta como aplicable',
      applicable.length === 0 && bindings.every((b) => b.status === 'blocked' || b.status === 'rejected'),
      `motivo: ${cap.detail.slice(0, 120)}`,
    );
  } else {
    check(
      'con soporte GraphQL, los bindings válidos usan el entry del motor sin reescribir',
      applicable.length > 0,
      `${applicable.length} entradas listas para aplicar`,
    );
  }

  console.log('\n=== A.5 el YAML del §6 ===');
  const yaml = report.yaml;
  check('el YAML declara services:', yaml.includes('services:'));
  check(
    'entry de provides_graphql: false para saleor-dashboard',
    /- name: saleor-dashboard\n\s+repo: saleor-dashboard\n\s+provides_graphql: false/.test(yaml),
  );
  check(
    'NINGÚN provides_graphql para el provider real',
    !/- name: saleor-api[\s\S]*?provides_graphql/.test(yaml),
  );
  if (applicable.length === 0) {
    check(
      'sin bindings aplicables, el YAML no emite la sección bindings:',
      !/^bindings:/m.test(yaml),
    );
    check('el YAML explica por qué no hay bindings (motor sin soporte)', yaml.includes('# bindings:'));
  } else {
    check('el YAML emite bindings: con entradas del motor', /^bindings:$/m.test(yaml));
    for (const b of applicable) {
      check(
        `entry verbatim de ${b.consumer.repo}:${b.consumer.path}#${b.consumer.symbol}`,
        yaml.includes(b.bindingsEntry ?? ' missing '),
      );
    }
  }

  console.log('\n=== A.6 el hueco explicado sin aplicar nada ===');
  check(
    'el informe no presenta nada como resuelto que el motor no confirme',
    applicable.every((b) => b.verdict?.valid === true),
    `applicableBindings=${report.proposals.applicableBindings}, capability=${cap.graphqlBindings}`,
  );
  check(
    'las notas del informe nombran el motivo del hueco',
    report.notes.some((n) => n.includes('graphql_no_op') || n.includes('duplicad')),
    report.notes.join(' | ').slice(0, 200),
  );

  console.log('\n=== YAML EMITIDO ===');
  console.log(yaml);

  console.log('\n=== ADVISOR RESULT ===');
  console.log(`señales: ${Object.entries(report.signalsByKind).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`advisor gate: FAIL (${failures} fallas)`);
    process.exitCode = 1;
  } else {
    console.log('advisor gate: PASS');
  }
}

main().catch((e) => {
  console.error('advisor gate error:', e);
  process.exitCode = 1;
});
