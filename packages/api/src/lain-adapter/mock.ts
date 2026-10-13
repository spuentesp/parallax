import type {
  DiffContractsArgs,
  DiffContractsResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  ListServicesResponse,
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
  manifestDigest: string;
  configHash?: string;
  analyzerVersion: string;
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

    async listServices(view, opts) {
      recordMockCall({ tool: 'list_services', view, args: opts ?? {} });
      const filtered = opts?.repo
        ? services.filter((s: { repo: string }) => s.repo === opts.repo)
        : services;
      const r: ListServicesResponse = {
        items: filtered,
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      };
      return r;
    },

    async getService(view: string, req: GetServiceArgs): Promise<GetServiceResponse> {
      recordMockCall({ tool: 'get_service', view, args: req });
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
      const id = `snap_${++snapshotCounter}_${Date.now().toString(36)}`;
      const manifestDigest = `digest_${id}`;
      const pending: PendingSnapshot = {
        snapshot: id,
        state: 'pending',
        readyAt: Date.now() + 100,
        manifestDigest,
        analyzerVersion,
      };
      if (req.configHash !== undefined) pending.configHash = req.configHash;
      snapshots.set(id, pending);
      return { snapshot: id, state: 'pending' as const };
    },

    async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
      recordMockCall({ tool: 'get_snapshot', args: req });
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
      return {
        snapshot: s.snapshot,
        state: 'ready',
        analyzerVersion: s.analyzerVersion,
        configHash: s.configHash,
        manifestDigest: s.manifestDigest,
      };
    },

    async diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse> {
      recordMockCall({ tool: 'diff_contracts', args: req });
      return pickScenario(req.head).diffContracts;
    },

    async traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse> {
      recordMockCall({ tool: 'trace_impact', args: req });
      return pickScenario(req.snapshot).traceImpact;
    },

    async getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse> {
      recordMockCall({ tool: 'get_coverage', args: req });
      return pickScenario(req.snapshot).coverage;
    },

    async resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse> {
      recordMockCall({ tool: 'resolve_evidence', view: req.view, args: req });
      return {
        repo: 'orders',
        sha: s1RemoveCustomerId.baseSha,
        path: 'src/main.rs',
        range: { start: 1, end: 10 },
      };
    },

    async readSource(req: ReadSourceArgs): Promise<ReadSourceResponse> {
      recordMockCall({ tool: 'read_source', view: req.view, args: req });
      return {
        text: `// stub of ${req.path}@${req.sha.slice(0, 7)}`,
        cap: 2000,
        truncated: false,
      };
    },
  };
}

export { getLainMockCalls, resetLainMock };
