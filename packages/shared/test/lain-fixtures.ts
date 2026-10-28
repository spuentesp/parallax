import type {
  DiffContractsResponse,
  GetCoverageResponse,
  GetServiceResponse,
  ListServicesResponse,
  TraceImpactResponse,
} from '../src/lain/tools.js';

export const apiVersion = '1' as const;
export const analyzerVersion = '0.9.1-fixture';

const orders = {
  service: 'orders',
  repo: 'orders',
  endpoints: 5,
  consumer_services: 1,
  unresolved_inbound: 0,
  paths: [] as string[],
};
const billing = {
  service: 'billing',
  repo: 'billing',
  endpoints: 2,
  consumer_services: 2,
  unresolved_inbound: 0,
  paths: [] as string[],
};
const reports = {
  service: 'reports',
  repo: 'reports',
  endpoints: 2,
  consumer_services: 0,
  unresolved_inbound: 0,
  paths: [] as string[],
};
const platform = {
  service: 'platform',
  repo: 'platform',
  endpoints: 3,
  consumer_services: 1,
  unresolved_inbound: 0,
  paths: ['services/shipping/', 'services/inventory/'],
};

export const services = [
  orders,
  billing,
  reports,
  platform,
] as const satisfies ListServicesResponse['items'];

const getService = (svc: { service: string; repo: string }): GetServiceResponse => {
  const consumers: Record<string, GetServiceResponse['consumers']> = {
    orders: [
      {
        service: 'billing',
        repo: 'billing',
        uses: [
          {
            binding: { confidence: 1, kind: 'static', source: 'Regex' },
            endpoint: { key: 'graphql:query:orders', service: 'orders' },
            fields: ['customer_id', 'total'],
            match: 'exact',
          },
        ],
      },
      {
        service: 'reports',
        repo: 'reports',
        uses: [
          {
            binding: { confidence: 0.4, kind: 'heuristic', detector: 'ambiguous' },
            endpoint: { key: 'table:orders', service: 'orders' },
            fields: ['created_at'],
            match: 'pattern',
          },
        ],
      },
    ],
    billing: [
      {
        service: 'platform/shipping',
        repo: 'platform',
        uses: [
          {
            binding: { confidence: 1, kind: 'static', source: 'Regex' },
            endpoint: { key: 'http:GET /invoices/:id', service: 'billing' },
            fields: ['invoice_id'],
            match: 'exact',
          },
        ],
      },
    ],
    reports: [],
    platform: [
      {
        service: 'platform/inventory',
        repo: 'platform',
        uses: [
          {
            binding: { confidence: 1, kind: 'static', source: 'Regex' },
            endpoint: { key: 'http:GET /api/inventory', service: 'platform' },
            fields: [],
            match: 'exact',
          },
        ],
      },
    ],
  };
  return {
    service: svc.service,
    consumers: consumers[svc.service] ?? [],
    endpoints: [],
  };
};

export const getServiceById = (id: string): GetServiceResponse => {
  const svc = services.find((s: { service: string }) => s.service === id);
  if (!svc) throw new Error(`unknown service: ${id}`);
  return getService(svc);
};

export interface Scenario {
  readonly id: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffContracts: DiffContractsResponse;
  readonly traceImpact: TraceImpactResponse;
  readonly coverage: GetCoverageResponse;
}

export const s1RemoveCustomerId: Scenario = {
  id: 's1-remove-customer-id',
  baseSha: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  headSha: 'afece2321df86647a31d073a2e3cadb50e13d42e',
  diffContracts: {
    changes: [{ kind: 'FieldRemoved', service: 'orders', field: 'customer_id' }],
    compatible_changes: 0,
  },
  traceImpact: {
    paths: [
      {
        start: 'orders:Field:openapi.yaml:customer_id:27',
        min_confidence: 1,
        hops: [
          {
            edge: 'Calls',
            node: 'billing:Function:src/main.py:fetch_me:35',
            node_type: 'Function',
          },
        ],
      },
    ],
    truncated: false,
  },
  coverage: {
    complete: false,
    scope: {
      configured_only: true,
      reviewed: [
        { repo: 'orders', commit: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf', dirty: true },
        { repo: 'billing', commit: '972651746b73f234031e3eae3c7b71b5d255d0ef', dirty: false },
        { repo: 'platform', commit: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c', dirty: false },
      ],
      unreviewed: ['reports'],
    },
  },
};

export const s2AddCurrency: Scenario = {
  id: 's2-add-currency',
  baseSha: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  headSha: 'b5bf29b0000000000000000000000000000abcdef',
  diffContracts: {
    changes: [{ kind: 'FieldAdded', service: 'orders', field: 'currency' }],
    compatible_changes: 1,
  },
  traceImpact: {
    paths: [],
    truncated: false,
  },
  coverage: {
    complete: true,
    scope: {
      configured_only: true,
      reviewed: [
        { repo: 'orders', commit: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf', dirty: false },
        { repo: 'billing', commit: '972651746b73f234031e3eae3c7b71b5d255d0ef', dirty: false },
        { repo: 'platform', commit: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c', dirty: false },
        { repo: 'reports', commit: '06f27bd72248a3c8513bc58807d98de15c286b8c', dirty: false },
      ],
      unreviewed: [],
    },
  },
};

export const scenarios: Record<string, Scenario> = {
  [s1RemoveCustomerId.id]: s1RemoveCustomerId,
  [s2AddCurrency.id]: s2AddCurrency,
};
