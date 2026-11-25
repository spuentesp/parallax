// Prepares the Lain snapshot of the pinned commits of one cluster and waits for it, as long as it takes.
// The Parallax adapter itself only waits about a minute for a snapshot, and indexing a large repository
// (NemoClaw alone is 6,600 files) takes minutes; the result stays on disk, so a later analysis of a pull
// request only has to index the repository the pull request changes.
//
//   node warm-snapshots.mjs /repos/repos-a.yaml http://127.0.0.1:9999/mcp
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [config, url] = process.argv.slice(2);
if (!config || !url) {
  console.error('usage: warm-snapshots.mjs <repos.yaml> <lain mcp url>');
  process.exit(2);
}

// The repository ids come from the Lain config; each is a checkout under /repos, pinned at HEAD.
const ids = [...readFileSync(config, 'utf8').matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
const repos = Object.fromEntries(
  ids.map((id) => [id, execFileSync('git', ['-C', `/repos/${id}`, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()]),
);

let rpcId = 0;
async function call(name, args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  const message = JSON.parse(line ? line.slice(6) : text);
  // The payload is a JSON document inside content[0].text, wrapped as { data: { state, snapshot, ... } }.
  const payload = JSON.parse(message.result?.content?.[0]?.text ?? 'null');
  return payload?.data ?? payload;
}

const started = Date.now();
const seconds = () => Math.round((Date.now() - started) / 1000);
console.log(`warming ${JSON.stringify(repos)}`);
try {
  let snap = await call('prepare_snapshot', { repos, wait_ms: 60000 });
  while (snap?.state !== 'ready' && snap?.state !== 'failed' && seconds() < 1200) {
    console.log(`  ${seconds()}s: ${snap?.state}`);
    await new Promise((r) => setTimeout(r, 5000));
    snap = await call('get_snapshot', { snapshot: snap.snapshot });
  }
  console.log(`snapshot ${snap?.snapshot}: ${snap?.state} after ${seconds()}s`);
  process.exit(snap?.state === 'ready' ? 0 : 1);
} catch (e) {
  console.error(`warm-up failed after ${seconds()}s: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
