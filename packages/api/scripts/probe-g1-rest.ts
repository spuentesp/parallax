// G1 remainder: s3-dynamic-url, excluded reports, and evidence resolution.
import { createLainClient } from '../src/lain-adapter/client.js';

const BASE = 'http://localhost:9997/mcp';
const SHAS = {
  ordersBase: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
};

async function main(): Promise<void> {
  const c = await createLainClient({ lainUrl: BASE, apiVersion: '1', timeoutMs: 30000 });

  // s3: billing tag s3-dynamic-url has a dynamic URL → unresolved consumer
  const prepBase = await c.prepareSnapshot({ repos: { orders: SHAS.ordersBase } });
  console.log('s3 base snapshot:', prepBase.snapshot, prepBase.state);
  const tags = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
  }).then((r) => r.json()) as { result: { tools: Array<{ name: string }> } };
  console.log('tools exposed:', tags.result.tools.map((t) => t.name).join(', '));

  // list_unresolved is a contracts-profile tool
  const unresolved = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_unresolved', arguments: { snapshot: 'live' } } }),
  }).then((r) => r.json()) as any;
  const u = JSON.parse(unresolved.result.content[0].text);
  console.log('\nlist_unresolved data keys:', Object.keys(u.data ?? u));
  console.log(JSON.stringify(u.data ?? u).slice(0, 700));

  // get_coverage + a service with consumers, to get an evidence id
  const svc = await c.getService({ snapshot: 'live', service: 'orders' });
  console.log('\nget_service(orders) consumers:', svc.consumers.map((x) => x.service));
  const use = svc.consumers.find((x) => x.service === 'billing')?.uses[0];
  console.log('a billing use site:', JSON.stringify(use?.site?.id ?? use?.caller?.id));
  console.log('  path:', use?.caller?.path, 'line:', use?.caller?.line);
}
main();
