// La orientación sale del grafo real (topología sobre un motor falso en el borde)
// y cada número debe poder rastrearse hasta él.

import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildBriefing } from '../src/onboarding/briefing.js';
import { annotateRepos, toOrgGraph } from '../src/org-graph.js';
import { buildEndpointTopology } from '../src/topology.js';

const svc = (service: string, repo: string) => ({
  service,
  repo,
  endpoints: 0,
  consumer_services: 0,
  unresolved_inbound: 0,
  paths: [],
});
const ep = (key: string, bound = 1) => ({
  endpoint: { key, service: 'api' },
  has_schema: false,
  bound_consumers: bound,
  providers: [{ repo: 'api', path: 'schema.graphql', line: 1 }],
});
const use = (key: string, kind: 'static' | 'heuristic', path: string) => ({
  binding: { confidence: kind === 'static' ? 1 : 0.6, kind },
  endpoint: { key, service: 'api' },
  fields: [],
  caller: { repo: 'web', path, line: 1 },
});

const fake = {
  analyzerVersion: 't',
  apiVersion: '1' as const,
  listServices: async () => ({
    items: [svc('api', 'api'), svc('dashboard', 'web'), svc('storefront', 'shop')],
    scope: { configured_only: true, reviewed: [], unreviewed: [] },
  }),
  listContracts: async () => ({
    items: [
      ep('graphql:query:products'),
      ep('graphql:query:orders'),
      ep('graphql:mutation:checkoutLinesUpdate'),
      ep('topic:celery/send_email_task', 0),
    ],
    cursor: null,
  }),
  getService: async ({ service }: { service: string }) => ({
    consumers:
      service === 'api'
        ? [
            {
              service: 'dashboard',
              repo: 'web',
              uses: [
                use('graphql:query:products', 'static', 'a.ts'),
                use('graphql:query:products', 'static', 'b.ts'),
                use('graphql:query:orders', 'static', 'c.ts'),
              ],
            },
            {
              service: 'storefront',
              repo: 'shop',
              uses: [
                use('graphql:mutation:checkoutLinesUpdate', 'static', 'd.ts'),
                use('graphql:query:products', 'heuristic', 'e.ts'),
              ],
            },
          ]
        : [],
  }),
} as unknown as LainAdapter;

describe('buildBriefing', async () => {
  const graph = annotateRepos(
    toOrgGraph(await buildEndpointTopology(fake)),
    new Set(['api', 'web']),
  );
  const b = buildBriefing(graph);

  it('counts what the map holds, and nothing else', () => {
    expect(b.totals).toEqual({ repos: 3, services: 3, contracts: 4, relations: 2 });
    expect(b.repos.map((r) => r.name)).toEqual(['api', 'shop', 'web']);
  });

  it('describes the doors of a service by kind, the biggest first, with counts that add up', () => {
    const api = b.repos.find((r) => r.name === 'api')?.services[0];
    expect(api?.contracts).toBe(4);
    expect(api?.groups.map((g) => [g.label, g.count])).toEqual([
      ['GraphQL queries', 2],
      ['Celery tasks', 1],
      ['GraphQL mutations', 1],
    ]);
    expect(api?.groups.reduce((n, g) => n + g.count, 0)).toBe(api?.contracts);
  });

  it('rolls relations up service to service, keeping deterministic and inferred apart', () => {
    expect(b.relations).toEqual([
      { from: 'dashboard', to: 'api', uses: 3, deterministic: 3, inferred: 0, contractsUsed: 2 },
      { from: 'storefront', to: 'api', uses: 2, deterministic: 1, inferred: 1, contractsUsed: 2 },
    ]);
  });

  it('names the most-depended-on service and the busiest operations', () => {
    expect(b.hubs).toEqual([{ service: 'api', repo: 'api', consumerServices: 2, uses: 5 }]);
    expect(b.topOperations[0]).toMatchObject({
      key: 'graphql:query:products',
      service: 'api',
      group: 'GraphQL queries',
      uses: 3,
      consumers: 2,
    });
    expect(b.topOperations.map((o) => o.uses)).toEqual(
      [...b.topOperations.map((o) => o.uses)].sort((x, y) => y - x),
    );
  });

  it('says what it cannot show: a repo whose code the engine does not index', () => {
    expect(b.gaps).toEqual([expect.objectContaining({ repo: 'shop' })]);
    expect(b.gaps[0]?.reason).toMatch(/not in the engine index/);
  });

  it('an empty graph is an empty briefing, not an error', () => {
    expect(buildBriefing({ nodes: [], edges: [] })).toMatchObject({
      totals: { repos: 0, services: 0, contracts: 0, relations: 0 },
      gaps: [],
    });
  });
});
