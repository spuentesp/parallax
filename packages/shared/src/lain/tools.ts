import { z } from 'zod';
import { EdgeType, FindingClass, LainView } from './enums.js';

const Range = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const Service = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  scope: z.string().optional(),
});

const Use = z.object({
  field: z.string().min(1).optional(),
  route: z.string().min(1).optional(),
  binding: EdgeType,
  source: z.string().min(1).optional(),
});

const Consumer = z.object({
  consumer: z.string().min(1),
  uses: z.array(Use),
});

const ImpactConsumer = z.object({
  consumer: z.string().min(1),
  field: z.string().min(1).optional(),
  route: z.string().min(1).optional(),
});

// 1. list_services
export const ListServicesArgs = z.object({ view: LainView, repo: z.string().min(1).optional() });
export const ListServicesResponse = z.object({
  view: LainView,
  services: z.array(Service),
  truncated: z.boolean().optional(),
});
export type ListServicesArgs = z.infer<typeof ListServicesArgs>;
export type ListServicesResponse = z.infer<typeof ListServicesResponse>;

// 2. get_service
export const GetServiceArgs = z.object({ view: LainView, service: z.string().min(1) });
export const GetServiceResponse = z.object({
  view: LainView,
  service: Service,
  consumers: z.array(Consumer),
  usedByTruncated: z.boolean(),
});
export type GetServiceArgs = z.infer<typeof GetServiceArgs>;
export type GetServiceResponse = z.infer<typeof GetServiceResponse>;

// 3. prepare_snapshot
export const PrepareSnapshotArgs = z.object({
  repos: z.record(z.string(), z.string().min(1)),
  configHash: z.string().min(1).optional(),
});
export const PrepareSnapshotResponse = z.object({
  snapshotId: z.string().min(1),
  status: z.enum(['pending', 'ready', 'failed']),
  manifestDigest: z.string().min(1),
});
export type PrepareSnapshotArgs = z.infer<typeof PrepareSnapshotArgs>;
export type PrepareSnapshotResponse = z.infer<typeof PrepareSnapshotResponse>;

// 4. get_snapshot
export const GetSnapshotArgs = z.object({ snapshotId: z.string().min(1) });
export const GetSnapshotResponse = z.object({
  snapshotId: z.string().min(1),
  status: z.enum(['pending', 'ready', 'failed']),
  error: z.string().optional(),
  analyzerVersion: z.string().min(1).optional(),
  configHash: z.string().min(1).optional(),
  manifestDigest: z.string().min(1).optional(),
});
export type GetSnapshotArgs = z.infer<typeof GetSnapshotArgs>;
export type GetSnapshotResponse = z.infer<typeof GetSnapshotResponse>;

// 5. diff_contracts
export const DiffContractsArgs = z.object({
  baseId: z.string().min(1),
  headId: z.string().min(1),
  service: z.string().min(1).optional(),
  cap: z.number().int().positive().optional(),
});
export const DiffContractsResponse = z.object({
  baseId: z.string().min(1),
  headId: z.string().min(1),
  changes: z.array(
    z.object({
      kind: z.string().min(1),
      service: z.string().min(1),
      field: z.string().min(1).optional(),
      route: z.string().min(1).optional(),
    }),
  ),
  truncated: z.boolean(),
  cap: z.number().int().positive(),
});
export type DiffContractsArgs = z.infer<typeof DiffContractsArgs>;
export type DiffContractsResponse = z.infer<typeof DiffContractsResponse>;

// 6. trace_impact
export const TraceImpactArgs = z.object({
  snapshotId: z.string().min(1),
  service: z.string().min(1).optional(),
  cap: z.number().int().positive().optional(),
});
export const TraceImpactResponse = z.object({
  snapshotId: z.string().min(1),
  findings: z.array(
    z.object({
      id: z.string().min(1),
      change: z.object({
        kind: z.string().min(1),
        service: z.string().min(1),
        field: z.string().min(1).optional(),
        route: z.string().min(1).optional(),
      }),
      classification: FindingClass,
      consumers: z.array(ImpactConsumer),
    }),
  ),
  truncated: z.boolean().optional(),
  cap: z.number().int().positive().optional(),
});
export type TraceImpactArgs = z.infer<typeof TraceImpactArgs>;
export type TraceImpactResponse = z.infer<typeof TraceImpactResponse>;

// 7. get_coverage
export const GetCoverageArgs = z.object({ snapshotId: z.string().min(1) });
export const GetCoverageResponse = z.object({
  reviewed: z.array(z.string().min(1)),
  omitted: z.array(z.object({ repo: z.string().min(1), cause: z.string().min(1) })),
  truncated: z.array(z.object({ repo: z.string().min(1), surface: z.string().min(1) })),
});
export type GetCoverageArgs = z.infer<typeof GetCoverageArgs>;
export type GetCoverageResponse = z.infer<typeof GetCoverageResponse>;

// 8. resolve_evidence
export const ResolveEvidenceArgs = z.object({
  view: LainView,
  evidenceId: z.string().min(1),
});
export const ResolveEvidenceResponse = z.object({
  repo: z.string().min(1),
  sha: z.string().min(1),
  path: z.string().min(1),
  range: Range.optional(),
});
export type ResolveEvidenceArgs = z.infer<typeof ResolveEvidenceArgs>;
export type ResolveEvidenceResponse = z.infer<typeof ResolveEvidenceResponse>;

// 9. read_source
export const ReadSourceArgs = z.object({
  view: LainView,
  repo: z.string().min(1),
  sha: z.string().min(1),
  path: z.string().min(1),
  range: Range.optional(),
});
export const ReadSourceResponse = z.object({
  text: z.string(),
  cap: z.number().int().positive(),
  truncated: z.boolean(),
});
export type ReadSourceArgs = z.infer<typeof ReadSourceArgs>;
export type ReadSourceResponse = z.infer<typeof ReadSourceResponse>;
