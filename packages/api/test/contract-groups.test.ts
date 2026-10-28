import { describe, expect, it } from 'vitest';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildEndpointTopology, contractGroup, groupNodeId } from '../src/topology.js';

describe('contractGroup — what a contract is called on the map', () => {
  it('separates GraphQL queries, mutations and subscriptions', () => {
    expect(contractGroup('graphql:query:products', 3).label).toBe('GraphQL queries');
    expect(contractGroup('graphql:mutation:checkoutLinesUpdate', 0).label).toBe(
      'GraphQL mutations',
    );
    expect(contractGroup('graphql:subscription:orderUpdated', 0).label).toBe(
      'GraphQL subscriptions',
    );
  });

  it('separates Celery tasks from other topics', () => {
    expect(contractGroup('topic:celery/send_order_confirmation_email_task', 0).label).toBe(
      'Celery tasks',
    );
    expect(contractGroup('topic:kafka/orders.created', 0).label).toBe('Topics and events');
  });

  it('keeps real HTTP routes apart from method-less patterns nobody calls', () => {
    expect(contractGroup('http:GET /api/orders', 0).key).toBe('http');
    // Con método: es una ruta aunque nadie la llame todavía.
    expect(contractGroup('http:POST /api/orders', 0).key).toBe('http');
    // Sin método y sin consumidores: la forma de las "rutas" que el sensor saca del navegador.
    for (const noisy of [
      'http:ANY /click',
      'http:ANY /0',
      'http:ANY /14:00',
      'http:ANY /Action handler thrown',
    ]) {
      expect(contractGroup(noisy, 0), noisy).toMatchObject({
        key: 'http-methodless',
        label: 'HTTP patterns without a method',
      });
    }
    // Sin método PERO alguien la consume: no es un patrón huérfano.
    expect(contractGroup('http:ANY /api/legacy', 2).key).toBe('http');
    // El grupo explica por qué está aparte, y no afirma que sean falsos.
    expect(contractGroup('http:ANY /click', 0).note).toMatch(/event names or test data/);
  });

  it('gives any other contract kind its own labelled group', () => {
    expect(contractGroup('table:public.orders', 0).label).toBe('Other contracts (table)');
  });
});

describe('the topology puts each endpoint in the group of its kind', () => {
  const svc = (service: string, repo: string) => ({
    service,
    repo,
    endpoints: 4,
    consumer_services: 0,
    unresolved_inbound: 0,
    paths: [],
  });
  const ep = (key: string, bound: number, path = 'src/x.ts') => ({
    endpoint: { key, service: 'dash' },
    has_schema: false,
    bound_consumers: bound,
    providers: [{ repo: 'dash', path, line: 1 }],
  });
  const fake = {
    analyzerVersion: 't',
    apiVersion: '1' as const,
    listServices: async () => ({
      items: [svc('dash', 'dash')],
      scope: { configured_only: true, reviewed: [], unreviewed: [] },
    }),
    listContracts: async () => ({
      items: [
        ep('http:ANY /click', 0, 'src/hooks/useSuppressClickAfterDrag.ts'),
        ep('http:ANY /0', 0, 'src/ModalFilters/operandExclusions.test.ts'),
        ep('http:GET /api/x', 0),
        ep('graphql:query:products', 4),
      ],
      cursor: null,
    }),
    getService: async () => ({ consumers: [] }),
  } as unknown as LainAdapter;

  it('the browser-event and test-fixture "routes" land in their own group, the real ones do not', async () => {
    const t = await buildEndpointTopology(fake);
    const parentOf = (key: string) => t.nodes.find((n) => n.label === key)?.parent;
    expect(parentOf('http:ANY /click')).toBe(groupNodeId('dash', 'http-methodless'));
    expect(parentOf('http:ANY /0')).toBe(groupNodeId('dash', 'http-methodless'));
    expect(parentOf('http:GET /api/x')).toBe(groupNodeId('dash', 'http'));
    expect(parentOf('graphql:query:products')).toBe(groupNodeId('dash', 'gql-query'));
    const noise = t.nodes.find((n) => n.id === groupNodeId('dash', 'http-methodless'));
    expect(noise?.meta?.contracts).toBe(2);
    expect(noise?.meta?.note).toBeTruthy();
    // Nada se pierde: todos los contratos del motor siguen en el grafo.
    expect(t.nodes.filter((n) => n.kind === 'endpoint')).toHaveLength(4);
  });
});
