import type {
  CheckBindingArgs,
  CheckBindingResponse,
  DiffContractsArgs,
  DiffContractsResponse,
  GetContractArgs,
  GetContractResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  ListContractsArgs,
  ListContractsResponse,
  ListServicesArgs,
  ListServicesResponse,
  ListUnresolvedArgs,
  ListUnresolvedResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  TraceImpactArgs,
  TraceImpactResponse,
} from '@parallax/shared/lain';
import {
  analyzerVersion,
  apiVersion,
  getServiceById,
  s1RemoveCustomerId,
  s2AddCurrency,
  services,
} from '@parallax/shared/test/lain-fixtures';
import { LainCallError } from './errors.js';
import { getLainMockCalls, recordMockCall, resetLainMock } from './record.js';
import type { LainAdapter } from './types.js';

interface PendingSnapshot {
  snapshot: string;
  state: 'pending' | 'ready' | 'failed';
  readyAt: number;
}

const snapshots = new Map<string, PendingSnapshot>();
let snapshotCounter = 0;

function pickScenario(snapshot: string | undefined) {
  if (!snapshot) return s1RemoveCustomerId;
  if (snapshot.includes('s2')) return s2AddCurrency;
  return s1RemoveCustomerId;
}

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

export function createLainMock(): LainAdapter {
  return {
    analyzerVersion,
    apiVersion,

    async listServices(req: ListServicesArgs): Promise<ListServicesResponse> {
      recordMockCall({ tool: 'list_services', snapshot: req.snapshot, args: req });
      const filtered = req.repo
        ? services.filter((s: { repo: string }) => s.repo === req.repo)
        : services;
      return {
        items: filtered,
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      };
    },

    async getService(req: GetServiceArgs): Promise<GetServiceResponse> {
      recordMockCall({ tool: 'get_service', snapshot: req.snapshot, args: req });
      try {
        return getServiceById(req.service);
      } catch {
        throw LainCallError.parse({
          code: 'NotImplemented',
          message: `unknown service: ${req.service}`,
          doc: SPEC_DOC,
        });
      }
    },

    async prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse> {
      recordMockCall({ tool: 'prepare_snapshot', args: req });
      const id = `snap_${(++snapshotCounter).toString(16).padStart(16, '0')}`;
      snapshots.set(id, { snapshot: id, state: 'pending', readyAt: Date.now() + 100 });
      return { snapshot: id, state: 'pending' as const };
    },

    async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
      recordMockCall({ tool: 'get_snapshot', snapshot: req.snapshot, args: req });
      const s = snapshots.get(req.snapshot);
      if (!s) {
        throw LainCallError.parse({
          code: 'SnapshotNotReady',
          message: 'unknown snapshot',
          snapshot: req.snapshot,
        });
      }
      if (Date.now() < s.readyAt) {
        return { snapshot: s.snapshot, state: 'pending' };
      }
      s.state = 'ready';
      return { snapshot: s.snapshot, state: 'ready' };
    },

    async diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse> {
      recordMockCall({ tool: 'diff_contracts', args: req });
      return pickScenario(req.head).diffContracts;
    },

    async traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse> {
      recordMockCall({ tool: 'trace_impact', snapshot: req.snapshot, args: req });
      return pickScenario(req.snapshot).traceImpact;
    },

    async getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse> {
      recordMockCall({ tool: 'get_coverage', snapshot: req.snapshot, args: req });
      return pickScenario(req.snapshot).coverage;
    },

    async resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse> {
      recordMockCall({ tool: 'resolve_evidence', snapshot: req.snapshot, args: req });
      return {
        items: req.refs.map((ref) => ({
          exists: true,
          ref,
          snippet: `// mock evidence for ${ref}`,
        })),
      };
    },

    async readSource(req: ReadSourceArgs): Promise<ReadSourceResponse> {
      recordMockCall({ tool: 'read_source', snapshot: req.snapshot, args: req });
      const lineCount = Math.max(1, req.end - req.start);
      const text = Array.from(
        { length: lineCount },
        (_, i) => `${req.path}:${req.start + i + 1}: mock line`,
      ).join('\n');
      return {
        text,
        path: req.path,
        start: req.start,
        end: req.end,
        commit: s1RemoveCustomerId.baseSha,
        total_lines: req.end + 40,
        source: req.snapshot,
      };
    },

    async listContracts(req: ListContractsArgs): Promise<ListContractsResponse> {
      recordMockCall({ tool: 'list_contracts', snapshot: req.snapshot, args: req });
      return {
        items: [
          {
            endpoint: { key: 'http:GET /api/orders/{}', service: 'orders' },
            has_schema: true,
            bound_consumers: 1,
          },
          {
            endpoint: { key: 'http:GET /invoices/{}', service: 'billing' },
            has_schema: false,
            bound_consumers: 1,
          },
        ],
      };
    },

    async getContract(req: GetContractArgs): Promise<GetContractResponse> {
      recordMockCall({ tool: 'get_contract', snapshot: req.snapshot, args: req });
      return { items: [{ key: req.key, service: req.service, consumers: [] }] };
    },

    async listUnresolved(req: ListUnresolvedArgs): Promise<ListUnresolvedResponse> {
      recordMockCall({ tool: 'list_unresolved', snapshot: req.snapshot, args: req });
      return {
        items: [],
        ambiguous: [],
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      };
    },

    async checkBinding(req: CheckBindingArgs): Promise<CheckBindingResponse> {
      recordMockCall({ tool: 'check_binding', snapshot: req.snapshot, args: req });
      return {
        valid: true,
        method_match: true,
        template_match: 'exact',
        reasons: [],
        bindings_entry: [
          `- consumer:`,
          `    repo: ${req.consumer.split(':')[0]}`,
          `    path: mock/path.graphql`,
          `    symbol: graphql-call:${req.endpoint.key.replace(/^graphql:/, '')}`,
          `    key: "${req.endpoint.key}"`,
          `  provider:`,
          `    service: ${req.endpoint.service}`,
          `    key: "${req.endpoint.key}"`,
        ].join('\n'),
      };
    },
  };
}

export { getLainMockCalls, resetLainMock };
