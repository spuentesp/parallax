import { readFileSync } from 'node:fs';
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
      repos: [],
      gaps: {
        unresolvedConsumers: 1,
        ambiguous: 1,
        unresolvedRefs: 0,
        urlDefaults: 0,
        blindSpotSites: 0,
      },
    });
  });
  it('omits what is missing or malformed instead of inventing it', () => {
    expect(normalizeLedger(null)).toEqual({
      complete: null,
      external: [],
      schemalessEndpoints: 0,
      staleBindings: 0,
      repos: [],
      gaps: {
        unresolvedConsumers: 0,
        ambiguous: 0,
        unresolvedRefs: 0,
        urlDefaults: 0,
        blindSpotSites: 0,
      },
    });
    const r = normalizeLedger({
      external: [{ host: 'a' }, { calls: 2 }, 'x', { host: 'b', calls: 3 }],
    });
    expect(r.external).toEqual([{ host: 'b', calls: 3 }]);
  });
});

// Salida literal de `get_coverage` (snapshot live) de LAIN 0.16.0 sobre Saleor
// (saleor, saleor-dashboard, storefront), recortada sólo en listas largas de
// ejemplos. Capturada con `lain server` real; nada escrito a mano.
const LIVE_016 = JSON.parse(
  readFileSync(new URL('./fixtures/lain-coverage-0.16-saleor.json', import.meta.url), 'utf8'),
);

describe('normalizeLedger — per-repo ledger from LAIN 0.16.0 (live view)', () => {
  const r = normalizeLedger(LIVE_016);

  it('lists every repo with its state, languages and sensors that ran (most findings first)', () => {
    expect(r.repos.map((x) => x.repo)).toEqual(['saleor', 'saleor-dashboard', 'storefront']);
    const saleor = r.repos[0];
    expect(saleor?.state).toBe('indexed');
    expect(saleor?.error).toBeNull();
    expect(saleor?.languages).toEqual(['python']);
    expect(saleor?.sensors[0]).toEqual({ name: 'sql_tables', count: 788 });
    expect(saleor?.sensors.map((s) => s.name)).toContain('http_routes');
    const dash = r.repos[1];
    expect(dash?.languages).toEqual(['ts', 'tsjs', 'tsx']);
  });

  it('reports blind spots by reason, with the directories the engine groups them by', () => {
    const orm = r.repos[0]?.blindSpots.find((b) => b.reason === 'OrmDynamicQuery');
    expect(orm?.count).toBe(1760);
    expect(orm?.directories.length).toBeGreaterThan(0);
    expect(orm?.directories.length).toBeLessThanOrEqual(5);
    const counts = orm?.directories.map((d) => d.count) ?? [];
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(r.repos[1]?.blindSpots.map((b) => b.reason)).toContain('FrontendValueUnclassified');
  });

  it('explains why the engine does not call coverage complete, with its own counts', () => {
    expect(r.complete).toBe(false);
    expect(r.gaps.unresolvedConsumers).toBe(32);
    expect(r.gaps.urlDefaults).toBe(1);
    expect(r.gaps.blindSpotSites).toBe(
      r.repos.reduce((n, x) => n + x.blindSpots.reduce((m, b) => m + b.count, 0), 0),
    );
    expect(r.schemalessEndpoints).toBe(221);
  });

  it('ignores malformed repo entries instead of inventing them', () => {
    const x = normalizeLedger({
      repos: [null, { state: 'indexed' }, { repo: 'a', sensors: { x: 'n' } }],
    });
    expect(x.repos).toEqual([
      {
        repo: 'a',
        state: 'unknown',
        error: null,
        commit: null,
        languages: [],
        sensors: [],
        skips: [],
        blindSpots: [],
      },
    ]);
  });
});
