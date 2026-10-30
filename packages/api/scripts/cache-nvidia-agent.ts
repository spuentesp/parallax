// Cache real Nemotron agent responses against the NVIDIA LAIN workspaces
// (OpenShell/NeMo-Fabric/NemoClaw on port 9971, NeMo-Agent-Toolkit on port 9972).
//
//   pnpm --filter @parallax/api exec tsx --env-file=/home/sebastian/repos/work/parallax/.env scripts/cache-nvidia-agent.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigate } from '../src/agent/investigator.js';
import { investigatorModel } from '../src/agent/model.js';
import { loadConfig } from '../src/config.js';
import { createLainClient } from '../src/lain-adapter/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, '../test/fixtures/nvidia-agent-cache.json');

interface CachedCase {
  id: string;
  wsId: string;
  lainUrl: string;
  question: string;
}

const TEST_CASES: CachedCase[] = [
  {
    id: 'deep_call_stack',
    wsId: 'ws_cluster_a',
    lainUrl: process.env.LAIN_CLUSTER_A_URL || 'http://127.0.0.1:9971/mcp',
    question:
      'Show the call stack between a very deep dependency: from the ORM table to the client that consumes the endpoint',
  },
  {
    id: 'openshell_consumers',
    wsId: 'ws_cluster_a',
    lainUrl: process.env.LAIN_CLUSTER_A_URL || 'http://127.0.0.1:9971/mcp',
    question:
      'Which services consume the OpenShell gateway gRPC API, and from which repos?',
  },
  {
    id: 'nat_runtime',
    wsId: 'ws_cluster_b',
    lainUrl: process.env.LAIN_CLUSTER_B_URL || 'http://127.0.0.1:9972/mcp',
    question:
      'Who dials the nat agent runtime HTTP & WebSocket endpoints?',
  },
];

async function main() {
  console.log('🤖 Running Nemotron test suite against live NVIDIA LAIN workspaces...\n');

  const config = loadConfig(process.env);
  const model = investigatorModel(config);
  if (!model) {
    throw new Error('NEBIUS_TOKEN is not set or invalid in environment');
  }

  const results: Record<string, unknown> = {};

  for (const tc of TEST_CASES) {
    console.log(`\n================================================================`);
    console.log(`▶ Case [${tc.id}] on ${tc.wsId} (${tc.lainUrl})`);
    console.log(`  Question: "${tc.question}"`);
    console.log(`================================================================`);

    let lainClient;
    try {
      lainClient = await createLainClient({
        lainUrl: tc.lainUrl,
        apiVersion: '1',
        timeoutMs: 60_000,
      });
    } catch (err) {
      console.warn(`  ⚠️ Could not connect to LAIN at ${tc.lainUrl}:`, err instanceof Error ? err.message : err);
      continue;
    }

    const t0 = Date.now();
    const res = await investigate({
      question: tc.question,
      lain: lainClient,
      model: model.provider,
      view: 'live',
      budget: { maxToolCalls: 12, maxModelMs: 120_000 },
    });
    const totalMs = Date.now() - t0;

    console.log(`\n  Status:     ${res.explanationStatus}`);
    console.log(`  Duration:   ${(totalMs / 1000).toFixed(1)}s (model ms: ${res.budget.modelMsUsed}ms)`);
    console.log(`  Tool Calls: ${res.toolCallLog.length} (${res.toolCallLog.filter((t) => t.ok).length} ok)`);
    console.log(`  Claims:     ${res.claims.length} (${res.claims.filter((c) => c.verdict === 'verified').length} verified)`);
    console.log(`  Citations:  ${res.citations.accepted.length} accepted, ${res.citations.rejected.length} rejected`);
    console.log(`\n  Answer:\n${res.answer}\n`);

    results[tc.id] = {
      caseId: tc.id,
      wsId: tc.wsId,
      question: tc.question,
      recordedAt: new Date().toISOString(),
      model: res.effectiveModel,
      answer: res.answer,
      explanationStatus: res.explanationStatus,
      claims: res.claims,
      claimsSummary: res.claimsSummary,
      citations: res.citations,
      budget: res.budget,
      modelLog: res.modelLog,
      toolCallLog: res.toolCallLog,
    };
  }

  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ Cached ${Object.keys(results).length} NVIDIA test runs to: ${CACHE_FILE}`);
}

main().catch((err) => {
  console.error('❌ Error executing test suite:', err);
  process.exit(1);
});
