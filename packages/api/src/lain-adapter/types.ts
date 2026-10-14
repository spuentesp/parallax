import type {
  DiffContractsArgs,
  DiffContractsResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  ListServicesArgs,
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

// Firmas alineadas con las tools reales de lain 0.9.1: todas reciben
// `snapshot` (o `base`/`head` en diff_contracts) y los argumentos homónimos
// de docs/lain-tool-schemas.json.
export interface LainAdapter {
  readonly analyzerVersion: string;
  readonly apiVersion: '1';

  listServices(req: ListServicesArgs): Promise<ListServicesResponse>;
  getService(req: GetServiceArgs): Promise<GetServiceResponse>;
  prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse>;
  getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse>;
  diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse>;
  traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse>;
  getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse>;
  resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse>;
  readSource(req: ReadSourceArgs): Promise<ReadSourceResponse>;
}
