import { createLainClient } from '../src/lain-adapter/client.js';
import { buildServiceTopology } from '../src/topology.js';

async function main(): Promise<void> {
  const targets = [
    ['SALEOR', 'http://localhost:9999/mcp'],
    ['BOUTIQUE', 'http://localhost:9998/mcp'],
  ] as const;
  for (const [name, url] of targets) {
    try {
      const c = await createLainClient({ lainUrl: url, apiVersion: '1', timeoutMs: 30000 });
      const t = await buildServiceTopology(c);
      console.log(`\n=== ${name} ===`);
      console.log('stats:', JSON.stringify(t.stats));
      console.log('nodes:', t.nodes.map((n) => n.label).join(', '));
      console.log('edges:');
      for (const e of t.edges) {
        console.log(`  ${e.source} -> ${e.target}  [${e.label}] (${(e.meta as { binding?: string }).binding})`);
      }
    } catch (e) {
      console.log(`\n=== ${name} === ERROR:`, e);
    }
  }
}
main();
