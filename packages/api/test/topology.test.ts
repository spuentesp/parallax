import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import {
  buildEndpointTopology,
  contractKind,
  endpointNodeId,
  groupNodeId,
  interfacesNodeId,
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

  it('nests services under Interfaces, separately from the repo code', async () => {
    const t = await buildEndpointTopology(fake);
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    expect(byId.get(interfacesNodeId('platform'))).toMatchObject({
      label: 'Interfaces',
      kind: 'group',
      parent: 'repo:platform',
      meta: { repo: 'platform', role: 'interfaces' },
    });
    expect(byId.get(serviceNodeId('shipping'))?.parent).toBe(interfacesNodeId('platform'));
    expect(byId.get(serviceNodeId('orders'))?.parent).toBe(interfacesNodeId('orders'));
    const ep = byId.get(endpointNodeId('http:GET /api/orders/{}', 'orders'));
    expect(ep?.parent).toBe(groupNodeId('orders', 'http'));
    expect(byId.get(groupNodeId('orders', 'http'))).toMatchObject({
      kind: 'group',
      label: 'HTTP routes',
      parent: serviceNodeId('orders'),
    });
  });

  it('counts the contracts in each group, so the map can say it without opening it', async () => {
    const t = await buildEndpointTopology(fake);
    const groups = t.nodes.filter((n) => n.kind === 'group' && n.meta?.group !== undefined);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const children = t.nodes.filter((n) => n.parent === g.id).length;
      expect(g.meta?.contracts).toBe(children);
      expect(children).toBeGreaterThan(0);
    }
  });

  it('filters by binding and confidence', async () => {
    const onlyHeuristic = await buildEndpointTopology(fake, { binding: 'heuristic' });
    expect(onlyHeuristic.edges.filter((e) => e.kind === 'consumes')).toHaveLength(0);

    const tooStrict = await buildEndpointTopology(fake, { minConfidence: 0.5 });
    expect(tooStrict.edges.filter((e) => e.kind === 'consumes')).toHaveLength(1);
  });
});

describe('buildEndpointTopology — dueño de un endpoint', () => {
  // Dos servicios exponen la misma clave: el primero que la declara es el dueño.
  const KEY = 'http:GET /shared';
  const base = {
    analyzerVersion: 'test',
    apiVersion: '1' as const,
    listServices: async () => ({
      items: ['a', 'b'].map((service) => ({
        service,
        repo: service,
        endpoints: 1,
        consumer_services: 0,
        unresolved_inbound: 0,
        paths: [],
      })),
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listContracts: async () => ({
      items: [{ endpoint: { key: KEY, service: 'a' } }, { endpoint: { key: KEY, service: 'b' } }],
      cursor: null,
    }),
    getService: async (req: { service: string }) =>
      req.service === 'a'
        ? { service: 'a', endpoints: [], consumers: [] }
        : {
            service: 'b',
            endpoints: [],
            consumers: [
              {
                service: 'c',
                repo: 'c',
                uses: [
                  {
                    endpoint: { key: KEY, service: 'b' },
                    binding: { kind: 'static', confidence: 1, source: 'TreeSitter' },
                    fields: [],
                    match: 'exact',
                    caller: { repo: 'c', path: 'x.py', line: 1, id: 'k' },
                  },
                ],
              },
            ],
          },
  } as unknown as LainAdapter;

  it('closes the chain on the first service that declared the key', async () => {
    const t = await buildEndpointTopology(base);
    const consumes = t.edges.find((e) => e.kind === 'consumes');
    expect(consumes?.target).toBe(endpointNodeId(KEY, 'a'));
    expect(t.edges.find((e) => e.kind === 'servedBy')?.target).toBe(serviceNodeId('a'));
  });

  it('adds an endpoint the inventory does not know under the service the consumer named', async () => {
    const lonely = {
      ...base,
      listContracts: async () => ({ items: [], cursor: null }),
    } as unknown as LainAdapter;
    const t = await buildEndpointTopology(lonely);
    expect(t.nodes.find((x) => x.id === endpointNodeId(KEY, 'b'))?.parent).toBe(
      groupNodeId('b', 'http'),
    );
    expect(t.edges.find((e) => e.kind === 'consumes')?.target).toBe(endpointNodeId(KEY, 'b'));
    expect(t.stats.byKind.http).toBe(1);
  });

  it('a consumer naming another owner for a key keeps the first declared owner for the chain', async () => {
    const declaredByA = {
      ...base,
      listContracts: async () => ({
        items: [{ endpoint: { key: KEY, service: 'a' } }],
        cursor: null,
      }),
    } as unknown as LainAdapter;
    const t = await buildEndpointTopology(declaredByA);
    // Se da de alta el endpoint que el consumidor nombró (dueño b), pero la arista
    // se cierra sobre el dueño que declaró la clave primero (a).
    expect(t.nodes.some((x) => x.id === endpointNodeId(KEY, 'b'))).toBe(true);
    expect(t.edges.find((e) => e.kind === 'consumes')?.target).toBe(endpointNodeId(KEY, 'a'));
  });
});
