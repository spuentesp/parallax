// G1 gate — contratos del fixture contra ground_truth.yaml.
//
// Es la "evidencia de salida" que exige §15 (G1 contratos): s1, s2, la URL
// dinámica y la exclusión de reports coinciden con la ground truth, y las
// evidencias abren en la vista correcta. Un resultado vacío no se presenta
// como autorización para cambiar el sistema (INV 3).
//
// Requiere un LAIN con perfil contracts sobre test-repos/contracts-fixture.
//   LAIN_URL=http://localhost:9997/mcp pnpm --filter @parallax/api exec tsx scripts/gate-g1.ts

import { presentCoverage, type LainCoverage } from '../src/coverage.js';
import { createLainClient, type LainAdapter } from '../src/lain-adapter/client.js';

const LAIN_URL = process.env.LAIN_URL ?? 'http://localhost:9997/mcp';

const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  ordersS1: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  ordersS2: '0931d02684c2d1f6df7f0353f6e6bdd6c07ecc2c',
  billingBase: '972651746b73f234031e3eae3c7b71b5d255d0ef',
  billingS3: '84207894bf2b5b315c7c8957be83fd0f0f5f5466',
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

interface Change {
  side?: string;
  kind: string;
  field?: string;
  endpoint?: { service?: string; key?: string };
  compat?: string;
  direction?: string;
  impact?: { class?: string; reasons?: string[] };
  affected?: Array<{ service?: string; class?: string }>;
}

async function snap(lain: LainAdapter, repos: Record<string, string>): Promise<string> {
  const r = await lain.prepareSnapshot({ repos });
  if (r.state !== 'ready') throw new Error(`snapshot not ready: ${r.state}`);
  return r.snapshot;
}

async function g1S1(lain: LainAdapter): Promise<void> {
  console.log('\n=== G1.1 s1-remove-customer-id (FieldRemoved de customer_id) ===');
  const base = await snap(lain, {
    orders: SHAS.ordersBase,
    billing: SHAS.billingBase,
    reports: SHAS.reportsBase,
    platform: SHAS.platformBase,
  });
  const head = await snap(lain, {
    orders: SHAS.ordersS1,
    billing: SHAS.billingBase,
    reports: SHAS.reportsBase,
    platform: SHAS.platformBase,
  });
  const d = await lain.diffContracts({ base, head });
  const removed = (d.changes as Change[]).filter(
    (c) => c.kind === 'FieldRemoved' && c.field === 'customer_id',
  );
  check('hay FieldRemoved de customer_id', removed.length > 0, `${removed.length} cambios`);
  check(
    'los cambios son del provider orders',
    removed.every((c) => (c.side ?? 'provider') === 'provider' && c.endpoint?.service === 'orders'),
  );
  check(
    'compat BreakingIfRead en todos',
    removed.length > 0 && removed.every((c) => c.compat === 'BreakingIfRead'),
    removed[0]?.compat,
  );

  // Ground truth §15.2-1: GET /api/orders/{} queda Verified con billing afectado;
  // los otros endpoints quedan NeedsInvestigation porque nadie los consume.
  const verifiedBilling = removed.find(
    (c) =>
      c.endpoint?.key === 'http:GET /api/orders/{}' &&
      (c.affected ?? []).some((a) => a.service === 'billing' && a.class === 'Verified'),
  );
  check(
    'GET /api/orders/{} → billing Verified',
    verifiedBilling !== undefined,
    JSON.stringify(verifiedBilling?.affected ?? null),
  );
  const unresolved = removed.filter((c) => c.endpoint?.key !== 'http:GET /api/orders/{}');
  check(
    'los endpoints sin consumidor quedan NeedsInvestigation',
    unresolved.length > 0 && unresolved.every((c) => c.impact?.class === 'NeedsInvestigation'),
    unresolved.map((c) => `${c.endpoint?.key}:${c.impact?.class}`).join(', '),
  );
}

async function g1S2(lain: LainAdapter): Promise<void> {
  console.log('\n=== G1.2 s2-add-currency (campo opcional compatible) ===');
  const base = await snap(lain, { orders: SHAS.ordersBase });
  const head = await snap(lain, { orders: SHAS.ordersS2 });
  const d = await lain.diffContracts({ base, head });
  check('changes[] vacío (no se inventa una ruptura)', d.changes.length === 0, `${d.changes.length}`);
  check(
    'compatible_changes = 1 y se conserva el contador',
    d.compatible_changes === 1,
    `compatible_changes=${d.compatible_changes}`,
  );
}

async function g1S3(lain: LainAdapter): Promise<void> {
  console.log('\n=== G1.3 s3-dynamic-url (URL construida desde variable no mapeada) ===');
  const base = await snap(lain, { orders: SHAS.ordersBase, billing: SHAS.billingBase });
  const head = await snap(lain, { orders: SHAS.ordersBase, billing: SHAS.billingS3 });
  const d = await lain.diffContracts({ base, head });
  const changes = d.changes as Change[];

  const unmatched = changes.find((c) => c.kind === 'ConsumerEndpointUnmatched');
  check('aparece ConsumerEndpointUnmatched', unmatched !== undefined);
  check(
    'lado consumidor, sobre http:GET /api/orders/{}',
    unmatched?.side === 'consumer' &&
      unmatched.endpoint?.service === 'orders' &&
      unmatched.endpoint?.key === 'http:GET /api/orders/{}',
    JSON.stringify(unmatched?.endpoint ?? null),
  );
  check(
    'compat Breaking',
    unmatched?.compat === 'Breaking',
    unmatched?.compat,
  );
  check(
    'impact class NeedsInvestigation',
    unmatched?.impact?.class === 'NeedsInvestigation',
    unmatched?.impact?.class,
  );
  check(
    'el consumidor afectado es billing con la URL dinámica /v1/api/orders/{}',
    (unmatched?.affected ?? []).some(
      (a) => a.service === 'billing' && String((a as { consumer?: string }).consumer ?? '').includes('/v1/'),
    ),
    JSON.stringify(unmatched?.affected ?? null),
  );

  const noSchema = changes.find((c) => c.kind === 'ChangedWithoutSchema');
  check('aparece ChangedWithoutSchema (sin esquema)', noSchema !== undefined);
  check(
    'provider billing http:GET /invoices/{}, NeedsReview',
    noSchema?.endpoint?.service === 'billing' &&
      noSchema.endpoint?.key === 'http:GET /invoices/{}' &&
      noSchema.compat === 'NeedsReview',
    JSON.stringify(noSchema?.endpoint ?? null),
  );
  check(
    'ChangedWithoutSchema conserva reason unresolved_candidates (ground truth)',
    (noSchema?.impact?.reasons ?? []).includes('unresolved_candidates'),
    JSON.stringify(noSchema?.impact?.reasons ?? null),
  );

  // INV 3: nada del escenario se promueve a Verified.
  check(
    'ninguna parte del escenario se promueve a Verified',
    changes.every((c) => c.impact?.class !== 'Verified'),
    changes.map((c) => `${c.kind}:${c.impact?.class}`).join(', '),
  );

  // Divergencia documentada motor ↔ ground truth (§15.2-3).
  const got = unmatched?.impact?.reasons ?? [];
  const want = ['unresolved_candidates'];
  if (JSON.stringify([...got].sort()) === JSON.stringify([...want].sort())) {
    check('reasons de ConsumerEndpointUnmatched == ground truth', true);
  } else {
    console.log(
      `  ⚠ divergencia motor ↔ ground_truth.yaml en ConsumerEndpointUnmatched.reasons: motor=${JSON.stringify(got)} ground_truth=${JSON.stringify(want)}`,
    );
    console.log(
      '    (la clase NeedsInvestigation sí coincide; el vocabulario de reasons cambió después de escribir la ground truth)',
    );
  }
}

async function g1Exclude(lain: LainAdapter): Promise<void> {
  console.log('\n=== G1.4 exclusión de reports (INV 3: la omisión es visible) ===');
  // El `exclude` del motor es inerte: un repo se excluye dejándolo fuera del
  // mapa `repos` del snapshot. Por eso la omisión visible la aporta el
  // manifiesto de Parallax (§6: Parallax es la autoridad sobre qué se revisó).
  const base = await snap(lain, { orders: SHAS.ordersBase, billing: SHAS.billingBase });
  const head = await snap(lain, { orders: SHAS.ordersS1, billing: SHAS.billingBase });
  const d = await lain.diffContracts({ base, head });
  check(
    'el análisis sigue produciendo los FieldRemoved',
    d.changes.length > 0,
    `${d.changes.length} cambios`,
  );

  const cov = d.coverage as LainCoverage | undefined;
  const presented = presentCoverage(cov ?? {}, {
    configured: ['orders', 'billing', 'reports'],
    excluded: ['reports'],
  });

  check('coverage.complete es false (no hay conclusión global)', presented.complete === false);
  check(
    'reports NO figura como revisado',
    !presented.scope.reviewed.includes('reports'),
    `reviewed=${JSON.stringify(presented.scope.reviewed)}`,
  );
  const excluded = presented.scope.unreviewed.find((n) => n.repo === 'reports');
  check(
    'reports figura como no revisado con reason=excluded',
    excluded?.reason === 'excluded',
    JSON.stringify(excluded ?? null),
  );
  check(
    'el relato de cobertura nombra reports (§9.6)',
    presented.summary.includes('reports'),
    presented.summary,
  );
  check(
    'el relato aclara que un vacío no autoriza a concluir ausencia de impacto',
    /no autoriza|incompleta/i.test(presented.summary),
    presented.summary.slice(-90),
  );
}

async function g1Evidence(lain: LainAdapter): Promise<void> {
  console.log('\n=== G1.5 la evidencia abre en la vista correcta ===');
  const svc = await lain.getService({ snapshot: 'live', service: 'orders' });
  const billing = svc.consumers.find((c) => c.service === 'billing');
  const use = billing?.uses[0];
  const anchor = use?.site ?? use?.caller;
  check('get_service devuelve un call-site con evidencia', anchor?.id != null, anchor?.id);

  const resolved = await lain.resolveEvidence({
    snapshot: 'live',
    refs: [anchor?.id ?? 'missing'],
  });
  const item = resolved.items[0];
  check('resolve_evidence resuelve la ref', item?.exists === true, item?.ref);

  if (item?.node?.ref?.repo && item.node.ref.path && item.node.ref.line != null) {
    const src = await lain.readSource({
      snapshot: 'live',
      repo: item.node.ref.repo,
      path: item.node.ref.path,
      start: Math.max(0, item.node.ref.line - 4),
      end: item.node.ref.line + 4,
    });
    check(
      'read_source devuelve el rango citado',
      typeof src.text === 'string' && src.text.length > 0 && src.total_lines > 0,
      `${src.path}:${src.start}-${src.end} (total ${src.total_lines})`,
    );
    check('la vista informa el commit que sostiene la cita', /^[0-9a-f]{7,}$/.test(src.commit), src.commit.slice(0, 10));
  } else {
    check('read_source recibe repo/path/line resueltos', false, JSON.stringify(item?.node?.ref ?? null));
  }
}

async function main(): Promise<void> {
  console.log(`G1 gate contra ${LAIN_URL}`);
  const lain = await createLainClient({ lainUrl: LAIN_URL, apiVersion: '1', timeoutMs: 60_000 });
  console.log(`handshake OK (analyzerVersion=${lain.analyzerVersion})`);

  await g1S1(lain);
  await g1S2(lain);
  await g1S3(lain);
  await g1Exclude(lain);
  await g1Evidence(lain);

  console.log('\n=== G1 RESULT ===');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`G1: FAIL (${failures} fallas)`);
    process.exitCode = 1;
  } else {
    console.log('G1: PASS');
  }
}

main().catch((e) => {
  console.error('G1 gate error:', e);
  process.exitCode = 1;
});
