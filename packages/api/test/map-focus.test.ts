// El agente sólo puede llevar al usuario a lo que el motor respalda: el foco
// sale de afirmaciones adjudicadas por verifyClaims sobre el motor (mock en el
// borde), no de datos escritos a mano.

import { describe, expect, it } from 'vitest';
import { type Claim, type ClaimEvidence, verifyClaims } from '../src/agent/claims.js';
import { mapFocusFromClaims } from '../src/agent/map-focus.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { toOrgGraph } from '../src/org-graph.js';
import { viewOrgGraph } from '../src/org-graph-view.js';
import { buildEndpointTopology } from '../src/topology.js';

const lain = createLainMock();
const none: ClaimEvidence = { accepted: [], receipts: [], rejected: [] };

async function catalog() {
  const services = await lain.listServices({ snapshot: 'live' });
  return {
    resolveService: async (name: string) =>
      services.items.find((s) => s.service === name || s.repo === name) ?? null,
  };
}

const rel = (consumer: string, provider: string, polarity: 'present' | 'absent'): Claim => ({
  kind: 'relation',
  consumer,
  provider,
  polarity,
});

async function focusFor(claims: Claim[]) {
  const { resolveService } = await catalog();
  const results = await verifyClaims(claims, {
    lain,
    view: 'live',
    resolveService,
    validateRefs: async () => none,
  });
  const topo = await buildEndpointTopology(lain);
  const known = new Set(topo.nodes.map((n) => n.id));
  return { focus: mapFocusFromClaims(results, known), results, topo, known };
}

describe('mapFocusFromClaims', () => {
  it('points at the consumers and provider of a verified relation, with a deep link', async () => {
    const { focus, results } = await focusFor([rel('billing', 'orders', 'present')]);
    expect(results[0]?.verdict).toBe('verified');
    expect(focus).not.toBeNull();
    expect(focus?.ids).toEqual(expect.arrayContaining(['svc:billing', 'svc:orders']));
    expect(focus?.relations[0]).toMatchObject({
      consumer: 'billing',
      provider: 'orders',
      polarity: 'present',
    });
    expect(focus?.relations[0]?.uses).toBeGreaterThan(0);
    const q = new URLSearchParams(focus?.query);
    expect(q.get('tab')).toBe('map');
    expect(q.get('focus')).toBe(focus?.seed);
    expect(q.get('sel')).toBe(focus?.seed);
  });

  it('lands on the endpoint when exactly one endpoint is at stake', async () => {
    const { focus } = await focusFor([rel('billing', 'orders', 'present')]);
    const endpoints = focus?.relations[0]?.endpoints ?? [];
    if (endpoints.length === 1) expect(focus?.seed).toBe(endpoints[0]);
    else expect(focus?.seed).toBe('svc:orders');
  });

  it('never points at a contradicted claim: what the engine does not hold is not drawn', async () => {
    const { focus, results } = await focusFor([rel('orders', 'billing', 'present')]);
    expect(results[0]?.verdict).toBe('contradicted');
    expect(focus).toBeNull();
  });

  it('never points at claims about services the map does not have', async () => {
    const { focus, results } = await focusFor([rel('ghost', 'orders', 'present')]);
    expect(results[0]?.verdict).toBe('unverifiable');
    expect(focus).toBeNull();
  });

  it('keeps only the verified claims when the answer mixes verdicts', async () => {
    const { focus } = await focusFor([
      rel('billing', 'orders', 'present'),
      rel('orders', 'billing', 'present'),
    ]);
    expect(focus?.relations).toHaveLength(1);
    expect(focus?.relations[0]?.consumer).toBe('billing');
  });

  it('reports a verified absence as an absence, never as an edge', async () => {
    const { focus } = await focusFor([rel('reports', 'billing', 'absent')]);
    expect(focus?.relations[0]).toMatchObject({ polarity: 'absent', uses: 0 });
  });

  it('only names nodes that exist, and the map view resolves the focus it is given', async () => {
    const { focus, topo, known } = await focusFor([rel('billing', 'orders', 'present')]);
    expect(focus?.ids.every((id) => known.has(id))).toBe(true);
    const view = viewOrgGraph(toOrgGraph(topo), { focus: focus?.seed ?? '', hops: 1 });
    expect(view.focus?.seed).toBe(focus?.seed);
    // El resultado del mapa incluye al consumidor que el agente citó.
    expect(view.nodes.some((n) => n.id === 'svc:billing')).toBe(true);
  });
});

// Un motor con usos controlados: billing toca UN endpoint de orders, reports
// toca DOS. Lo demás (catálogo, alcance) lo pone el mock.
const GET = 'http:GET /api/orders/{}';
const LIST = 'http:GET /api/orders';
const use = (key: string) => ({
  endpoint: { key, service: 'orders' },
  binding: { kind: 'static', confidence: 1, source: 'TreeSitter' },
  fields: [],
  match: 'exact',
  caller: { repo: 'x', path: 'x.py', line: 1, id: 'c' },
});
function engineWith(): LainAdapter {
  const base = createLainMock();
  return {
    ...base,
    async getService(req) {
      const r = await base.getService(req);
      if (req.service !== 'orders') return r;
      return {
        ...r,
        consumers: [
          { service: 'billing', repo: 'billing', uses: [use(GET)] },
          { service: 'reports', repo: 'reports-repo', uses: [use(GET), use(LIST)] },
        ],
      } as typeof r;
    },
  };
}

async function focusWith(claims: Claim[], known: string[]) {
  const engine = engineWith();
  const services = await engine.listServices({ snapshot: 'live' });
  const results = await verifyClaims(claims, {
    lain: engine,
    view: 'live',
    resolveService: async (name) =>
      services.items.find((x) => x.service === name || x.repo === name) ?? null,
    validateRefs: async () => none,
  });
  return mapFocusFromClaims(results, new Set(known));
}

const ALL = ['svc:billing', 'svc:orders', 'svc:reports', `ep:${GET}@orders`, `ep:${LIST}@orders`];

describe('mapFocusFromClaims — where the agent lands', () => {
  it('lands on the endpoint when exactly one endpoint is at stake, and lists consumer, provider and endpoint', async () => {
    const f = await focusWith([rel('billing', 'orders', 'present')], ALL);
    expect(f?.seed).toBe(`ep:${GET}@orders`);
    expect(new Set(f?.ids)).toEqual(new Set(['svc:billing', 'svc:orders', `ep:${GET}@orders`]));
    expect(f?.relations[0]).toMatchObject({
      endpoints: [`ep:${GET}@orders`],
      uses: 1,
      complete: true,
    });
    expect(new URLSearchParams(f?.query).get('focus')).toBe(`ep:${GET}@orders`);
  });

  it('lands on the provider when several endpoints are involved', async () => {
    const f = await focusWith([rel('reports', 'orders', 'present')], ALL);
    expect(f?.seed).toBe('svc:orders');
    expect(f?.relations[0]?.endpoints).toHaveLength(2);
    expect(f?.ids).toEqual(expect.arrayContaining([`ep:${GET}@orders`, `ep:${LIST}@orders`]));
  });

  it('keeps only endpoints the map has; with none left it lands on the provider', async () => {
    const f = await focusWith([rel('billing', 'orders', 'present')], ['svc:billing', 'svc:orders']);
    expect(f?.relations[0]?.endpoints).toEqual([]);
    expect(f?.seed).toBe('svc:orders');
    expect(f?.ids.some((id) => id.startsWith('ep:'))).toBe(false);
  });

  it('skips a relation when EITHER end is missing from the map', async () => {
    expect(await focusWith([rel('billing', 'orders', 'present')], ['svc:orders'])).toBeNull();
    expect(await focusWith([rel('billing', 'orders', 'present')], ['svc:billing'])).toBeNull();
  });

  it('merges several verified claims: union of ids, the first provider seeds', async () => {
    const f = await focusWith(
      [rel('billing', 'orders', 'present'), rel('reports', 'orders', 'present')],
      ALL,
    );
    expect(f?.relations).toHaveLength(2);
    expect(new Set(f?.ids)).toEqual(new Set(ALL));
    // Dos endpoints distintos en juego en total: aterriza en el proveedor.
    expect(f?.seed).toBe('svc:orders');
  });

  it('a repeated endpoint across claims still counts as one: the seed stays on it', async () => {
    const f = await focusWith(
      [rel('billing', 'orders', 'present'), rel('billing', 'orders', 'present')],
      ALL,
    );
    expect(f?.seed).toBe(`ep:${GET}@orders`);
  });

  it('ignores note claims and any verdict other than verified', async () => {
    const f = await focusWith(
      [
        { kind: 'note', text: 'orders is central', evidence: ['ev:1'] },
        rel('billing', 'reports', 'present'),
      ],
      ALL,
    );
    expect(f).toBeNull();
  });
});
