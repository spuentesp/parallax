// Report what Parallax sees in a LAIN workspace (the NVIDIA clones are the
// usual corpus: NeMo-Agent-Toolkit + -UI + -Examples, and OpenShell +
// NeMo-Fabric + NemoClaw). It reads the live server through the real adapter
// — no mock, no hand-inserted state.
//
//   LAIN_URL=http://127.0.0.1:9972/mcp pnpm --filter @parallax/api exec tsx scripts/probe-nvidia.ts
import { fetchAllContracts, fetchAllUnresolved } from '../src/advisor/correlate.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import { buildEndpointTopology, contractKind } from '../src/topology.js';

async function main(): Promise<void> {
  const url = process.env.LAIN_URL ?? 'http://127.0.0.1:9972/mcp';
  const lain = await createLainClient({ lainUrl: url, apiVersion: '1', timeoutMs: 120_000 });
  console.log(`analyzer=${lain.analyzerVersion} url=${url}`);

  const services = await lain.listServices({ snapshot: 'live' });
  console.log(`\n-- services (${services.items.length}) --`);
  for (const s of services.items) {
    console.log(`  ${s.service}  repo=${s.repo ?? '?'}  endpoints=${s.endpoints ?? 0}`);
  }
  console.log(`  scope: reviewed=${services.scope.reviewed.length} unreviewed=${services.scope.unreviewed.length}`);
  for (const r of services.scope.unreviewed) console.log(`  UNREVIEWED: ${r}`);

  const contracts = await fetchAllContracts(lain, { snapshot: 'live' });
  const byKind = new Map<string, { providers: number; bound: number }>();
  for (const c of contracts) {
    const kind = contractKind(c.endpoint.key);
    const row = byKind.get(kind) ?? { providers: 0, bound: 0 };
    row.providers += 1;
    row.bound += c.bound_consumers ?? 0;
    byKind.set(kind, row);
  }
  console.log(`\n-- contracts (${contracts.length}) --`);
  for (const [kind, row] of [...byKind].sort()) {
    console.log(`  ${kind.padEnd(10)} providers=${row.providers} bound_consumers=${row.bound}`);
  }
  const bound = contracts.filter((c) => (c.bound_consumers ?? 0) > 0);
  console.log(`  contracts with at least one bound consumer: ${bound.length}`);
  for (const c of bound.slice(0, 40)) {
    console.log(`    ${c.endpoint.service}  ${c.endpoint.key}  (${c.bound_consumers})`);
  }

  const unresolved = await fetchAllUnresolved(lain, { snapshot: 'live' });
  const byReason = new Map<string, number>();
  for (const u of unresolved) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
  console.log(`\n-- unresolved (${unresolved.length}) --`);
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  const topology = await buildEndpointTopology(lain);
  console.log(`\n-- topology --`);
  console.log(`  stats: ${JSON.stringify(topology.stats)}`);
  const chains = topology.edges.filter((e) => e.kind === 'consumes');
  console.log(`  consumes edges: ${chains.length}`);
  for (const e of chains.slice(0, 40)) {
    const target = topology.nodes.find((n) => n.id === e.target);
    console.log(`    ${e.source} -> ${target?.label ?? e.target}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
