// G1 evidence panel flow: resolve_evidence → read_source on a real call-site.
// Corre contra el servidor lain en vivo y debe terminar con exit 0.
import { createLainClient } from '../src/lain-adapter/client.js';

const BASE = 'http://localhost:9997/mcp';

async function main(): Promise<void> {
  const c = await createLainClient({ lainUrl: BASE, apiVersion: '1', timeoutMs: 30000 });

  const svc = await c.getService({ snapshot: 'live', service: 'orders' });
  const billing = svc.consumers.find((x) => x.service === 'billing');
  if (!billing || billing.uses.length === 0) {
    throw new Error('fixture changed: billing does not consume orders');
  }
  console.log('billing uses on orders:', billing.uses.length);

  let shown = 0;
  for (const u of billing.uses.slice(0, 3)) {
    const anchor = u.site ?? u.caller;
    if (!anchor?.repo || !anchor.path || anchor.line === undefined) continue;
    const refs = [anchor.text, anchor.id].filter(
      (r): r is string => typeof r === 'string' && r.length > 0,
    );
    if (refs.length === 0) continue;

    console.log('\n--- use ---');
    console.log('  endpoint :', u.endpoint?.key);
    console.log('  binding  :', u.binding.kind, 'conf', u.binding.confidence);
    console.log('  fields   :', u.fields);

    const resolved = await c.resolveEvidence({ snapshot: 'live', refs });
    for (const item of resolved.items) {
      console.log('  evidence :', item.exists ? 'exists' : 'missing', item.ref);
      if (item.reason !== undefined) console.log('  reason   :', item.reason);
      if (typeof item.snippet === 'string') {
        for (const line of item.snippet.split('\n').slice(0, 4)) {
          console.log('  snippet  │', line.slice(0, 90));
        }
      }
    }

    const node = resolved.items.find((i) => i.exists)?.node;
    const repo = node?.ref.repo ?? anchor.repo;
    const path = node?.ref.path ?? anchor.path;
    const line = node?.ref.line ?? anchor.line;
    const start = Math.max(0, line - 3);
    const end = line + 3;

    const src = await c.readSource({ snapshot: 'live', repo, path, start, end });
    console.log(`  read_source ${src.path}:${src.start}-${src.end} (total ${src.total_lines})`);
    console.log('  ┌─', `${src.path}`.slice(0, 80));
    for (const textLine of src.text.split('\n').slice(0, 10)) {
      console.log('  │', textLine.slice(0, 90));
    }
    console.log('  └─');
    shown++;
  }
  if (shown === 0) throw new Error('no resolvable evidence found on billing uses');
  console.log(`\nOK: ${shown} evidence flow(s) resolved`);
}
main();
