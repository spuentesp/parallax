import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import {
  buildEndpointTopology,
  contractKind,
  endpointNodeId,
  resolveServiceForPath,
  serviceNodeId,
} from '../src/topology.js';

describe('resolveServiceForPath', () => {
  // En un monorepo, el consumidor es el módulo dueño del archivo, no el repo.
  const index = new Map([
    ['shipping', ['services/shipping/']],
    ['inventory', ['services/inventory/']],
  ]);

  it('attributes a call-site to the module that owns the file', () => {
    expect(resolveServiceForPath('services/shipping/main.py', index)).toBe('shipping');
    expect(resolveServiceForPath('services/inventory/handler.py', index)).toBe('inventory');
  });

  it('prefers the longest matching prefix', () => {
    const nested = new Map([
      ['outer', ['src/']],
      ['inner', ['src/deep/']],
    ]);
    expect(resolveServiceForPath('src/deep/x.ts', nested)).toBe('inner');
    expect(resolveServiceForPath('src/shallow.ts', nested)).toBe('outer');
  });

  it('returns null when nothing matches', () => {
    expect(resolveServiceForPath('README.md', index)).toBeNull();
    expect(resolveServiceForPath(undefined, index)).toBeNull();
  });
});

describe('contractKind', () => {
  it('takes the protocol before the colon', () => {
    expect(contractKind('http:GET /api/orders/{}')).toBe('http');
    expect(contractKind('topic:kafka/orders.created')).toBe('topic');
    expect(contractKind('graphql:query:shop')).toBe('graphql');
  });
});

describe('buildEndpointTopology', () => {
  // Cadenas: consumidor → endpoint → proveedor. Es lo que convierte el grafo
  // en una red de relaciones en vez de soles.
  const fake = {
    analyzerVersion: 'test',
    apiVersion: '1' as const,
    listServices: async () => ({
      items: [
        {
          service: 'orders',
          repo: 'orders',
          endpoints: 1,
          consumer_services: 1,
          unresolved_inbound: 0,
          paths: [],
        },
        {
          service: 'shipping',
          repo: 'platform',
          endpoints: 1,
          consumer_services: 0,
          unresolved_inbound: 0,
          paths: ['services/shipping/'],
        },
      ],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listContracts: async () => ({
      items: [
        {
          endpoint: { key: 'http:GET /api/orders/{}', service: 'orders' },
          has_schema: true,
          bound_consumers: 1,
        },
      ],
      cursor: null,
    }),
    // Los consumos salen de get_service: es donde LAIN resuelve los vínculos.
    getService: async (req: { service: string }) => {
      if (req.service !== 'orders') {
        return { service: req.service, consumers: [], endpoints: [] };
      }
      return {
        service: 'orders',
        consumers: [
          {
            service: 'shipping',
            repo: 'platform',
            uses: [
              {
                binding: { confidence: 1, kind: 'static', source: 'TreeSitter' },
                endpoint: { key: 'http:GET /api/orders/{}', service: 'orders' },
                fields: ['customer_id'],
                match: 'exact',
                caller: {
                  repo: 'platform',
                  path: 'services/shipping/main.py',
                  line: 12,
                  id: 'shipping:call:12',
                },
              },
            ],
          },
        ],
        endpoints: [],
      };
    },
  } as unknown as LainAdapter;

  it('builds the chain consumer → endpoint → provider', async () => {
    const t = await buildEndpointTopology(fake);
    const consumes = t.edges.find((e) => e.kind === 'consumes');
    const servedBy = t.edges.find((e) => e.kind === 'servedBy');

    expect(consumes?.source).toBe(serviceNodeId('shipping'));
    expect(consumes?.target).toBe(endpointNodeId('http:GET /api/orders/{}', 'orders'));
    // El rótulo es el campo leído, no el transporte.
    expect(consumes?.label).toBe('customer_id');

    // served by cierra la cadena: endpoint → proveedor.
    expect(servedBy?.source).toBe(endpointNodeId('http:GET /api/orders/{}', 'orders'));
    expect(servedBy?.target).toBe(serviceNodeId('orders'));
  });

  it('nests services under their repo and endpoints under their service', async () => {
    const t = await buildEndpointTopology(fake);
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    expect(byId.get(serviceNodeId('shipping'))?.parent).toBe('repo:platform');
    expect(byId.get(serviceNodeId('orders'))?.parent).toBe('repo:orders');
    expect(byId.get(endpointNodeId('http:GET /api/orders/{}', 'orders'))?.parent).toBe(
      serviceNodeId('orders'),
    );
  });

  it('filters by binding and confidence', async () => {
    const onlyHeuristic = await buildEndpointTopology(fake, { binding: 'heuristic' });
    expect(onlyHeuristic.edges.filter((e) => e.kind === 'consumes')).toHaveLength(0);

    const tooStrict = await buildEndpointTopology(fake, { minConfidence: 0.5 });
    expect(tooStrict.edges.filter((e) => e.kind === 'consumes')).toHaveLength(1);
  });
});
