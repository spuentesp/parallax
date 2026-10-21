// Release acceptance against the real Saleor checkouts. Run after applying
// the advisor's provides_graphql:false proposal to saleor-dashboard.
// LAIN_URL=http://localhost:9999/mcp pnpm --filter @parallax/api exec tsx scripts/gate-saleor.ts
import assert from 'node:assert/strict';
import { fetchAllContracts, fetchAllUnresolved } from '../src/advisor/correlate.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import { buildEndpointTopology, serviceNodeId } from '../src/topology.js';
import { waitForIndexedRepos } from './lain-readiness.js';

async function main(): Promise<void> {
  const started = Date.now();
  const lain = await createLainClient({
    lainUrl: process.env.LAIN_URL ?? 'http://localhost:9999/mcp',
    apiVersion: '1',
    timeoutMs: 120_000,
  });
  console.log(`Saleor release gate (analyzer=${lain.analyzerVersion})`);
  await waitForIndexedRepos(lain, ['saleor', 'saleor-dashboard', 'storefront']);
  console.log(`All repos reviewed after ${Date.now() - started} ms (gate elapsed)`);
  const contracts = await fetchAllContracts(lain, { snapshot: 'live' });
  const product = contracts.filter((c) => c.endpoint.key === 'graphql:query:product');
  assert.equal(product.length, 1, 'product must have exactly one provider service');
  assert.equal(product[0]?.endpoint.service, 'saleor-api');
  assert.ok((product[0]?.bound_consumers ?? 0) > 0, 'product must have real bound consumers');
  assert.ok(
    !contracts.some(
      (c) => c.endpoint.service === 'saleor-dashboard' && c.endpoint.key.startsWith('graphql:'),
    ),
    'SDL copies in the dashboard must not mint providers',
  );
  console.log('PASS: provides_graphql:false removes the copied providers');

  const unresolved = await fetchAllUnresolved(lain, { snapshot: 'live', repo: 'storefront' });
  assert.equal(
    unresolved.filter((c) => c.reason === 'graphql_no_op').length,
    0,
    'storefront GraphQL operations must resolve after applying the proposal',
  );
  console.log(
    `PASS: storefront has no graphql_no_op (${unresolved.length} other unresolved calls remain)`,
  );

  const service = await lain.getService({ snapshot: 'live', service: 'saleor-api' });
  const consumer = service.consumers.find((c) => c.service === 'saleor-storefront');
  assert.ok(consumer && consumer.uses.length > 0, 'storefront must consume saleor-api');
  const use = consumer.uses.find((u) => u.endpoint?.key === 'graphql:query:product');
  assert.ok(use, 'storefront must consume product');
  const consumerId = use.site?.id ?? use.caller?.id;
  assert.ok(consumerId, 'the product consumer must have an evidence anchor');
  const verdict = await lain.checkBinding({
    snapshot: 'live',
    consumer: consumerId,
    endpoint: { service: 'saleor-api', key: 'graphql:query:product' },
  });
  assert.equal(verdict.valid, true, 'confirming an inferred GraphQL binding must be idempotent');
  assert.ok(verdict.bindings_entry?.includes('graphql:query:product'));
  console.log('PASS: check_binding accepts GraphQL and returns the binding YAML');

  const topology = await buildEndpointTopology(lain);
  const consumes = topology.edges.filter(
    (e) => e.kind === 'consumes' && e.source === serviceNodeId('saleor-storefront'),
  );
  assert.ok(
    consumes.some((e) =>
      topology.edges.some(
        (p) =>
          p.kind === 'servedBy' &&
          p.source === e.target &&
          p.target === serviceNodeId('saleor-api'),
      ),
    ),
    'the product topology must connect storefront → endpoint → saleor-api',
  );
  console.log('PASS: Parallax topology contains the storefront → saleor-api dependency');
  console.log('SALEOR: PASS');
}

main().catch((error) => {
  console.error('SALEOR: FAIL', error);
  process.exitCode = 1;
});
