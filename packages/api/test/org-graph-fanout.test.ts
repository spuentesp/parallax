// Un grupo abierto con muchas operaciones no se dibuja como un abanico de líneas:
// la relación va al grupo, y la de cada operación reaparece al seleccionarla.

import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { FANOUT_LIMIT, projectOrgGraph, toOrgGraph } from '../src/org-graph.js';
import {
  buildEndpointTopology,
  endpointNodeId,
  groupNodeId,
  interfacesNodeId,
  serviceNodeId,
} from '../src/topology.js';

const N = FANOUT_LIMIT + 8;
const keys = Array.from({ length: N }, (_, i) => `graphql:query:op${i}`);

const fake = {
  analyzerVersion: 't',
  apiVersion: '1' as const,
  listServices: async () => ({
    items: [
      {
        service: 'api',
        repo: 'api',
        endpoints: N,
        consumer_services: 1,
        unresolved_inbound: 0,
        paths: [],
      },
      {
        service: 'web',
        repo: 'web',
        endpoints: 0,
        consumer_services: 0,
        unresolved_inbound: 0,
        paths: [],
      },
    ],
    scope: { configured_only: true, reviewed: [], unreviewed: [] },
  }),
  listContracts: async () => ({
    items: keys.map((key) => ({
      endpoint: { key, service: 'api' },
      has_schema: false,
      bound_consumers: 1,
      providers: [{ repo: 'api', path: 'schema.graphql', line: 1 }],
    })),
    cursor: null,
  }),
  getService: async ({ service }: { service: string }) => ({
    consumers:
      service === 'api'
        ? [
            {
              service: 'web',
              repo: 'web',
              uses: keys.map((key, i) => ({
                binding: { confidence: 1, kind: 'static' },
                endpoint: { key, service: 'api' },
                fields: [],
                caller: { repo: 'web', path: `src/q${i}.ts`, line: 1 },
              })),
            },
          ]
        : [],
  }),
} as unknown as LainAdapter;

const api = serviceNodeId('api');
const web = serviceNodeId('web');
const group = groupNodeId('api', 'gql-query');
const open = new Set([
  'repo:api',
  'repo:web',
  interfacesNodeId('api'),
  interfacesNodeId('web'),
  api,
  group,
]);

describe('projection — crowded groups', async () => {
  const graph = toOrgGraph(await buildEndpointTopology(fake));

  it('draws ONE relation from the consumer to the group, carrying every use', () => {
    const p = projectOrgGraph(graph, open);
    const consumes = p.edges.filter((e) => e.kind === 'consumes');
    expect(consumes).toHaveLength(1);
    expect(consumes[0]).toMatchObject({ source: web, target: group, count: N });
    // Las operaciones siguen ahí, sin una línea cada una.
    expect(p.nodes.filter((n) => n.kind === 'endpoint').length).toBeGreaterThan(FANOUT_LIMIT);
  });

  it('a selected (pinned) operation gets its own line back, the rest stay rolled up', () => {
    const op = endpointNodeId(keys[3] ?? '', 'api');
    const p = projectOrgGraph(graph, open, { pinned: new Set([op]) });
    const consumes = p.edges.filter((e) => e.kind === 'consumes');
    expect(consumes.map((e) => e.target).sort()).toEqual([group, op].sort());
    expect(consumes.find((e) => e.target === op)?.count).toBe(1);
    expect(consumes.find((e) => e.target === group)?.count).toBe(N - 1);
  });

  it('a small group keeps one line per operation', () => {
    const p = projectOrgGraph(graph, open, { fanoutLimit: N + 5, childLimit: N + 5 });
    expect(p.edges.filter((e) => e.kind === 'consumes')).toHaveLength(N);
  });

  it('collapsed Interfaces retain the relation between their services', () => {
    const p = projectOrgGraph(graph, new Set(['repo:api', 'repo:web']));
    expect(p.edges.filter((e) => e.kind === 'consumes').map((e) => [e.source, e.target])).toEqual([
      [interfacesNodeId('web'), interfacesNodeId('api')],
    ]);
  });
});
