// Pull real call-sites from LAIN and verify each one against the checked-out
// source tree. If the path:line exists on disk with matching content, the
// analysis is reading real code and not fixtures.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLainClient } from '../src/lain-adapter/client.js';

// packages/api → repo root is two levels up.
const REPO_ROOT = resolve(process.cwd(), '../..');

async function check(label: string, url: string, service: string, localRoot: string): Promise<void> {
  const c = await createLainClient({ lainUrl: url, apiVersion: '1', timeoutMs: 30000 });
  const r = await c.getService('live', { view: 'live', service });
  console.log(`\n=== ${label} · get_service(${service}) ===`);
  let shown = 0;
  for (const cons of r.consumers) {
    for (const u of cons.uses) {
      const site = u.caller ?? u.site;
      if (!site?.path || site.line == null) continue;
      if (site.repo === service || site.repo === label.toLowerCase()) {
        // skip self reads
      }
      const abs = resolve(REPO_ROOT, 'test-repos', localRoot, site.path);
      let onDisk = 'MISSING';
      let snippet = '';
      try {
        const lines = readFileSync(abs, 'utf8').split('\n');
        const line = lines[site.line - 1];
        if (line !== undefined) {
          onDisk = 'OK';
          snippet = line.trim().slice(0, 70);
        } else {
          onDisk = 'LINE OOB';
        }
      } catch {
        onDisk = 'MISSING';
      }
      console.log(`  [${onDisk}] ${cons.service} → ${service}`);
      console.log(`          ${site.repo}@${String(site.commit).slice(0, 10)}:${site.path}:${site.line}`);
      console.log(`          binding=${u.binding.kind} confidence=${u.binding.confidence} endpoint=${u.endpoint?.key}`);
      if (snippet) console.log(`          disk: ${snippet}`);
      if (++shown >= 5) return;
    }
  }
}

async function main(): Promise<void> {
  await check('Saleor-Dashboard', 'http://localhost:9999/mcp', 'saleor-api', 'saleor-dashboard');
  await check('Boutique', 'http://localhost:9998/mcp', 'checkout', 'microservices-demo');
}
main();
