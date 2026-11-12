// Diagnóstico del relevo en un caso: por qué la entrega final no tiene
// afirmaciones. Imprime los errores del investigador, el registro de llamadas
// y la respuesta. Es una herramienta de trabajo, no un test.
//
//   LAIN_URL=http://localhost:9999/mcp pnpm --filter @parallax/api exec tsx \
//     --env-file-if-exists=../../.env scripts/probe-relay.ts "<question>" [--handoff]

import { investigate } from '../src/agent/investigator.js';
import { investigatorModel } from '../src/agent/model.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import { loadConfig } from '../src/config.js';

const args = process.argv.slice(2);
const handoff = args.includes('--handoff');
const question = args.find((a) => !a.startsWith('--')) ?? 'Where is the shipping address set?';

const lain = await createLainClient({
  lainUrl: process.env.LAIN_URL ?? 'http://localhost:9999/mcp',
  apiVersion: '1',
  timeoutMs: 120_000,
});
const model = investigatorModel(loadConfig(process.env));
if (!model) throw new Error('NEBIUS_TOKEN is not set');

const res = await investigate({
  question,
  lain,
  model: model.provider,
  view: 'live',
  budget: model.budget,
  ...(handoff ? { handoff: true } : {}),
});

console.log('\n=== status ===');
console.log('status:', res.explanationStatus);
console.log('errors:', JSON.stringify(res.errors, null, 2));
console.log('budget:', JSON.stringify(res.budget));
console.log('claims:', res.claims.length, JSON.stringify(res.claimsSummary));
console.log('citations:', JSON.stringify(res.citations));
console.log('\n=== model calls ===');
for (const m of res.modelLog) {
  console.log(` ${m.model} ${m.finishReason} tools=${m.toolCalls} in=${m.promptTokens} out=${m.completionTokens} ${m.latencyMs}ms`);
}
console.log('\n=== tool calls ===');
for (const t of res.toolCallLog) {
  console.log(` ${t.tool} ok=${t.ok} ${t.code ?? ''} chars=${t.resultChars} ${t.truncated ? 'CUT' : ''}`);
}
console.log('\n=== answer ===');
console.log(res.answer ?? '(none)');
