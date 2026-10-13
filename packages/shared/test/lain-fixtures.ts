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
        consumer: 'billing',
        uses: [
          { field: 'customer_id', binding: 'confirmed', source: 'http' },
          { field: 'total', binding: 'confirmed', source: 'http' },
        ],
      },
      {
        consumer: 'reports',
        uses: [{ field: 'created_at', binding: 'heuristic', source: 'db' }],
      },
    ],
    billing: [
      {
        consumer: 'platform/shipping',
        uses: [{ field: 'invoice_id', binding: 'confirmed', source: 'http' }],
      },
    ],
    reports: [],
    platform: [
      {
        consumer: 'platform/inventory',
        uses: [{ route: '/api/inventory', binding: 'confirmed', source: 'http' }],
      },
    ],
  };
  return {
    service: { id: svc.service, name: svc.service },
    consumers: consumers[svc.service] ?? [],
    usedByTruncated: false,
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
    baseId: 'snap_base_s1',
    headId: 'snap_head_s1',
    changes: [{ kind: 'FieldRemoved', service: 'orders', field: 'customer_id' }],
    truncated: false,
    cap: 1000,
  },
  traceImpact: {
    snapshotId: 'snap_head_s1',
    findings: [
      {
        id: 'f_s1_1',
        change: { kind: 'FieldRemoved', service: 'orders', field: 'customer_id' },
        classification: 'Verified',
        consumers: [{ consumer: 'billing', field: 'customer_id' }],
      },
    ],
  },
  coverage: {
    reviewed: ['orders', 'billing', 'platform'],
    omitted: [{ repo: 'reports', cause: 'no-resolved-evidence' }],
    truncated: [],
  },
};

export const s2AddCurrency: Scenario = {
  id: 's2-add-currency',
  baseSha: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
  headSha: 'b5bf29b0000000000000000000000000000abcdef',
  diffContracts: {
    baseId: 'snap_base_s2',
    headId: 'snap_head_s2',
    changes: [{ kind: 'FieldAdded', service: 'orders', field: 'currency' }],
    truncated: false,
    cap: 1000,
  },
  traceImpact: {
    snapshotId: 'snap_head_s2',
    findings: [
      {
        id: 'f_s2_1',
        change: { kind: 'FieldAdded', service: 'orders', field: 'currency' },
        classification: 'NoKnownImpact',
        consumers: [],
      },
    ],
  },
  coverage: {
    reviewed: ['orders', 'billing', 'platform', 'reports'],
    omitted: [],
    truncated: [],
  },
};

export const scenarios: Record<string, Scenario> = {
  [s1RemoveCustomerId.id]: s1RemoveCustomerId,
  [s2AddCurrency.id]: s2AddCurrency,
};
