import { describe, expect, it } from 'vitest';
import { normalizeLedger } from '../src/coverage/ledger.js';

// Forma literal de `get_coverage` de LAIN 0.15.0 (cluster A), recortada.
const REAL = {
  complete: false,
  external: [
    { calls: 1, host: 'agent-server.test' },
    { calls: 7, host: 'collector.test' },
    { calls: 1, host: 'example.com' },
  ],
  schemaless_endpoints: [
    { key: 'http:GET /health', service: 'nemo-fabric' },
    { key: 'http:GET /_requests', service: 'nemo-fabric' },
  ],
  stale_bindings: 0,
  unresolved_consumers: ['POST /chat/completions'],
  ambiguous: ['POST /'],
};

describe('normalizeLedger', () => {
  it('reads the external hosts (most calls first), the schemaless count and the staleness', () => {
    expect(normalizeLedger(REAL)).toEqual({
      complete: false,
      external: [
        { host: 'collector.test', calls: 7 },
        { host: 'agent-server.test', calls: 1 },
        { host: 'example.com', calls: 1 },
      ],
      schemalessEndpoints: 2,
      staleBindings: 0,
    });
  });
  it('omits what is missing or malformed instead of inventing it', () => {
    expect(normalizeLedger(null)).toEqual({
      complete: null,
      external: [],
      schemalessEndpoints: 0,
      staleBindings: 0,
    });
    const r = normalizeLedger({
      external: [{ host: 'a' }, { calls: 2 }, 'x', { host: 'b', calls: 3 }],
    });
    expect(r.external).toEqual([{ host: 'b', calls: 3 }]);
  });
});
