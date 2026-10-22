// Self-contained release gate: every graph fact comes from committed source
// scanned by the released binary. No graph/database state is hand-inserted.
// LAIN_BIN=/path/to/lain-0.11.0 pnpm gate:graphql
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runAdvisor } from '../src/advisor/index.js';
import { fetchAllContracts, fetchAllUnresolved } from '../src/advisor/correlate.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildEndpointTopology, serviceNodeId } from '../src/topology.js';
import { waitForIndexedRepos } from './lain-readiness.js';

const binary = process.env.LAIN_BIN ? resolve(process.env.LAIN_BIN) : 'lain';
const root = mkdtempSync(join(tmpdir(), 'parallax-graphql-'));
const repoNames = ['saleor', 'saleor-dashboard', 'storefront'];
const configPath = join(root, 'repos.yaml');
const logPath = join(root, 'server.log');
let child: ChildProcess | undefined;

async function stop(): Promise<void> {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child?.kill('SIGKILL'), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
    child = undefined;
  }
}

async function start(providesGraphql: boolean, binding?: string): Promise<LainAdapter> {
  await stop();
  const config = [
    'share: false',
    `data_dir: ${JSON.stringify(join(root, 'data'))}`,
    'repos:',
    ...repoNames.flatMap((id) => [
      `  - id: ${id}`,
      '    source:',
      '      type: workspace_dir',
      `      path: ${JSON.stringify(join(root, id))}`,
    ]),
    'services:',
    '  - name: saleor-api',
    '    repo: saleor',
    '  - name: saleor-dashboard',
    '    repo: saleor-dashboard',
    `    provides_graphql: ${providesGraphql}`,
    '  - name: saleor-storefront',
    '    repo: storefront',
    // Keep the engine-generated list item verbatim under bindings.
    ...(binding ? ['bindings:', binding] : []),
  ].join('\n');
  writeFileSync(configPath, `${config}\n`);
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((done, reject) =>
    listener.close((error) => (error ? reject(error) : done())),
  );
  child = spawn(
    binary,
    ['server', '--config', configPath, '--transport', 'http', '--port', String(port)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LAIN_TOOL_PROFILE: 'core' },
    },
  );
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const logs: Buffer[] = [];
  child.stdout?.on('data', (data: Buffer) => logs.push(data));
  child.stderr?.on('data', (data: Buffer) => logs.push(data));
  const deadline = Date.now() + 60_000;
  const url = `http://127.0.0.1:${port}/mcp`;
  while (true) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || Date.now() >= deadline) {
      writeFileSync(logPath, Buffer.concat(logs));
      throw new Error(`LAIN did not start: ${readFileSync(logPath, 'utf8').slice(-4000)}`);
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        signal: AbortSignal.timeout(1_000),
      });
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  const lain = await createLainClient({ lainUrl: url, apiVersion: '1', maxRetries: 0 });
  assert.equal(lain.analyzerVersion, '0.11.0');
  await waitForIndexedRepos(lain, repoNames, 60_000);
  return lain;
}

async function main(): Promise<void> {
  const schema = 'type Query { product: Product }\ntype Product { id: ID! }\n';
  for (const name of repoNames) {
    const repo = join(root, name);
    mkdirSync(repo);
    writeFileSync(
      join(repo, name === 'storefront' ? 'Product.graphql' : 'schema.graphql'),
      name === 'storefront' ? 'query Product { product { id } }\n' : schema,
    );
    if (name === 'saleor-dashboard') {
      writeFileSync(join(repo, 'Product.graphql'), 'query DashboardProduct { product { id } }\n');
    }
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', [
      '-C',
      repo,
      '-c',
      'user.name=Release gate',
      '-c',
      'user.email=gate@localhost',
      'commit',
      '-qm',
      'GraphQL source fixture',
    ]);
  }
  let lain = await start(true);
  const contracts = await fetchAllContracts(lain, { snapshot: 'live' });
  assert.equal(contracts.filter((c) => c.endpoint.key === 'graphql:query:product').length, 2);
  const unresolved = await fetchAllUnresolved(lain, { snapshot: 'live', repo: 'storefront' });
  assert.equal(unresolved.filter((c) => c.reason === 'graphql_no_op').length, 1);
  console.log('PASS: copied SDL creates ambiguous providers before configuration');

  const advisor = await runAdvisor(
    lain,
    repoNames.map((id) => ({ id, root: join(root, id) })),
  );
  assert.ok(advisor.proposals.providesGraphql.some((p) => p.repo === 'saleor-dashboard'));
  const binding = advisor.proposals.bindings.find(
    (p) => p.consumer.repo === 'storefront' && p.status === 'applicable',
  );
  assert.ok(binding?.bindingsEntry, 'the advisor must return an engine-validated binding');
  lain = await start(true, binding.bindingsEntry);
  const confirmed = await lain.getService({ snapshot: 'live', service: 'saleor-api' });
  assert.ok(
    confirmed.consumers.some(
      (c) =>
        c.service === 'saleor-storefront' && c.uses.some((u) => /confirmed/i.test(u.binding.kind)),
    ),
    'the verbatim binding must round-trip as Confirmed',
  );
  console.log('PASS: advisor binding YAML round-trips through the real config write path');

  lain = await start(false);
  const fixed = await fetchAllContracts(lain, { snapshot: 'live' });
  assert.equal(fixed.filter((c) => c.endpoint.key === 'graphql:query:product').length, 1);
  assert.equal(
    (await fetchAllUnresolved(lain, { snapshot: 'live', repo: 'storefront' })).length,
    0,
  );
  const topology = await buildEndpointTopology(lain);
  assert.ok(
    topology.edges.some(
      (e) =>
        e.kind === 'consumes' &&
        e.source === serviceNodeId('saleor-storefront') &&
        topology.edges.some(
          (p) =>
            p.source === e.target &&
            p.kind === 'servedBy' &&
            p.target === serviceNodeId('saleor-api'),
        ),
    ),
  );
  console.log(
    'PASS: provides_graphql:false auto-binds storefront and creates the Parallax dependency',
  );
  console.log('GRAPHQL RELEASE: PASS');
}

try {
  await main();
} catch (error) {
  console.error('GRAPHQL RELEASE: FAIL', error);
  process.exitCode = 1;
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
