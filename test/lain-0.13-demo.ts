#!/usr/bin/env tsx
import { createLainClient } from '../packages/api/src/lain-adapter/client.js';

const lainUrl = process.env.LAIN_URL;
if (!lainUrl) throw new Error('LAIN_URL is required (for example http://localhost:9999/mcp)');

const key = process.env.DEMO_TRACE_KEY ?? 'graphql:query:products';
const service = process.env.DEMO_TRACE_SERVICE ?? 'api';
const lain = await createLainClient({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });

const trace = await lain.traceFlow({
  snapshot: 'live',
  from: { endpoint: { key, service } },
  direction: 'downstream',
  strategy: 'breadth',
  depth: 6,
  cap: 50,
});
const refs = await lain.listServiceRefs({ snapshot: 'live', limit: 5 });

console.log(JSON.stringify({ analyzerVersion: lain.analyzerVersion, trace, serviceRefs: refs }, null, 2));
