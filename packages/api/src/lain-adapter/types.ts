import type {
  DiffContractsArgs,
  DiffContractsResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  LainView,
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

export interface LainAdapter {
  readonly analyzerVersion: string;
  readonly apiVersion: '1';

  listServices(view: LainView, opts?: { repo?: string }): Promise<ListServicesResponse>;
  getService(view: LainView, req: GetServiceArgs): Promise<GetServiceResponse>;
  prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse>;
  getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse>;
  diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse>;
  traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse>;
  getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse>;
  resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse>;
  readSource(req: ReadSourceArgs): Promise<ReadSourceResponse>;
}
