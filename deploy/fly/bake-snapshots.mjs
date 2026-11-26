// Bake one cluster's pinned-commit snapshot into its Lain data_dir at image build time.
//   node bake-snapshots.mjs <lain-mcp-url> <repos-json>
// Every PR analysis snapshots the whole workspace: the PR repo at base/head and every other repo at its pinned
// commit. Building the pinned NemoClaw entry from cold takes ~150 s and GBs of memory, longer than the API's snapshot
// wait. Preparing the pinned snapshot here leaves those per-repo cache entries (keyed repo + sha + analyzer version)
// in the image, so at runtime only the PR repo's two commits are indexed.
const [url, reposJson] = process.argv.slice(2);
const repos = JSON.parse(reposJson);
const DEADLINE_MS = 30 * 60_000;

let id = 0;
async function call(name, args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? text;
  const body = JSON.parse(line);
  if (body.error) throw new Error(`${name}: JSON-RPC ${body.error.code} ${body.error.message}`);
  const out = JSON.parse(body.result?.content?.[0]?.text ?? 'null');
  if (body.result?.isError || !out?.data) throw new Error(`${name}: ${JSON.stringify(out).slice(0, 500)}`);
  return out.data; // the state is at data.state, not at the top level
}

const t0 = Date.now();
let snap = await call('prepare_snapshot', { repos, wait_ms: 30_000 });
while (snap.state !== 'ready' && snap.state !== 'failed') {
  if (Date.now() - t0 > DEADLINE_MS) throw new Error(`snapshot ${snap.snapshot} still ${snap.state} after 30 min`);
  await new Promise((r) => setTimeout(r, 5_000));
  snap = await call('get_snapshot', { snapshot: snap.snapshot, wait_ms: 30_000 });
}
// get_snapshot reports `ready` but does not save it: the record on disk keeps the state the last prepare left
// (`indexing` when the build outlived its wait), and Lain re-queues every job of such a record at each boot.
// prepare_snapshot again is idempotent and writes the `ready` record. bake.sh checks the file.
if (snap.state === 'ready') snap = await call('prepare_snapshot', { repos, wait_ms: 30_000 });
const states = (snap.repos ?? []).map((r) => `${r.repo}@${r.commit.slice(0, 8)}=${r.state}`).join(' ');
console.log(`snapshot ${snap.snapshot}: ${snap.state} in ${Math.round((Date.now() - t0) / 1000)}s (${states})`);
if (snap.state !== 'ready') process.exit(1);
