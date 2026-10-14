import { z } from 'zod';
import { FindingClass, LainView } from './enums.js';

// Real response envelope from a running lain server:
// { _meta: { revision, static_graph_generation, view: { git_commits, kind, snapshot_id } },
//   content: [ { text: "<JSON string with analyzer_version, api_version, data, meta>" } ] }
//
// The `text` field is a JSON string. The LainAdapter client parses it and
// returns the `data` payload. These schemas describe that payload.

const Range = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

// 1. list_services — data.items[] + data.scope
export const ListServicesArgs = z.object({
  view: LainView,
  repo: z.string().min(1).optional(),
});

export const ServiceSummary = z.object({
  service: z.string().min(1),
  repo: z.string().min(1),
  endpoints: z.number().int().nonnegative(),
  consumer_services: z.number().int().nonnegative(),
  unresolved_inbound: z.number().int().nonnegative(),
  paths: z.array(z.string()).optional(),
});

export const ListServicesResponse = z.object({
  items: z.array(ServiceSummary),
  scope: z.object({
    configured_only: z.boolean(),
    reviewed: z.array(
      z.object({
        repo: z.string().min(1),
        commit: z.string().min(1),
        dirty: z.boolean(),
      }),
    ),
    unreviewed: z.array(z.string().min(1)),
  }),
});
export type ListServicesArgs = z.infer<typeof ListServicesArgs>;
export type ListServicesResponse = z.infer<typeof ListServicesResponse>;

// 2. get_service — data.service + data.consumers[] + data.endpoints[]
//
// Real lain (analyzer 0.9.1) names the consumer by `service` (plus its `repo`),
// and each `uses[]` entry carries a `binding` object with a confidence and a
// kind, and the consumed `endpoint` key. `caller`/`site` are evidence anchors
// (repo/path/line/commit) that we pass through without modelling in depth.
const Binding = z.object({
  confidence: z.number().min(0).max(1),
  kind: z.string().min(1),
  source: z.string().optional(),
  detector: z.string().optional(),
});

const Anchor = z
  .object({
    id: z.string().optional(),
    repo: z.string().optional(),
    path: z.string().optional(),
    line: z.number().int().optional(),
    commit: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
  })
  .loose();

const Use = z.object({
  binding: Binding,
  endpoint: z
    .object({ key: z.string().min(1), service: z.string().min(1) })
    .optional(),
  fields: z.array(z.string()).default([]),
  match: z.string().optional(),
  caller: Anchor.optional(),
  site: Anchor.optional(),
});

const Consumer = z.object({
  service: z.string().min(1),
  repo: z.string().min(1),
  uses: z.array(Use),
});

export const GetServiceArgs = z.object({ view: LainView, service: z.string().min(1) });
export const GetServiceResponse = z.object({
  service: z.string().min(1),
  consumers: z.array(Consumer),
  endpoints: z.array(z.string()).default([]),
  usedByTruncated: z.boolean().optional(),
});
export type GetServiceArgs = z.infer<typeof GetServiceArgs>;
export type GetServiceResponse = z.infer<typeof GetServiceResponse>;

// 3. prepare_snapshot
export const PrepareSnapshotArgs = z.object({
  repos: z.record(z.string(), z.string().min(1)),
  configHash: z.string().min(1).optional(),
});
export const PrepareSnapshotResponse = z.object({
  snapshot: z.string().min(1),
  state: z.enum(['pending', 'ready', 'failed']),
  reproducible: z.boolean().optional(),
  repos: z
    .array(
      z.object({
        repo: z.string().min(1),
        commit: z.string().min(1),
        state: z.string().min(1),
      }),
    )
    .optional(),
  created_unix: z.number().optional(),
  last_access_unix: z.number().optional(),
});
export type PrepareSnapshotArgs = z.infer<typeof PrepareSnapshotArgs>;
export type PrepareSnapshotResponse = z.infer<typeof PrepareSnapshotResponse>;

// 4. get_snapshot
export const GetSnapshotArgs = z.object({ snapshot: z.string().min(1) });
export const GetSnapshotResponse = z.object({
  snapshot: z.string().min(1),
  state: z.enum(['pending', 'ready', 'failed']),
  error: z.string().optional(),
  analyzerVersion: z.string().min(1).optional(),
  configHash: z.string().min(1).optional(),
  manifestDigest: z.string().min(1).optional(),
});
export type GetSnapshotArgs = z.infer<typeof GetSnapshotArgs>;
export type GetSnapshotResponse = z.infer<typeof GetSnapshotResponse>;

// 5. diff_contracts
export const DiffContractsArgs = z.object({
  base: z.string().min(1),
  head: z.string().min(1),
  service: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  cap: z.number().int().positive().optional(),
  min_impact: z.string().min(1).optional(),
});
export const DiffContractsResponse = z.object({
  base: z.string().min(1).optional(),
  head: z.string().min(1).optional(),
  baseId: z.string().min(1).optional(),
  headId: z.string().min(1).optional(),
  changes: z.array(
    z.object({
      kind: z.string().min(1),
      service: z.string().min(1).optional(),
      side: z.string().optional(),
      endpoint: z
        .object({
          service: z.string().min(1).optional(),
          key: z.string().min(1).optional(),
        })
        .optional(),
      field: z.string().min(1).optional(),
      route: z.string().min(1).optional(),
      direction: z.string().optional(),
      compat: z.string().optional(),
    }),
  ),
  compatible_changes: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  cap: z.number().int().positive().optional(),
  coverage: z
    .object({
      complete: z.boolean(),
      scope: z
        .object({
          reviewed: z.array(z.string().min(1)),
          unreviewed: z.array(z.string().min(1)),
          configured_only: z.boolean(),
        })
        .optional(),
    })
    .optional(),
});
export type DiffContractsArgs = z.infer<typeof DiffContractsArgs>;
export type DiffContractsResponse = z.infer<typeof DiffContractsResponse>;

// 6. trace_impact
const ImpactConsumer = z.object({
  consumer: z.string().min(1),
  field: z.string().min(1).optional(),
  route: z.string().min(1).optional(),
});

export const TraceImpactArgs = z.object({
  snapshot: z.string().min(1),
  from: z
    .object({
      endpoint: z.string().min(1).optional(),
      field: z.string().min(1).optional(),
      symbol: z.string().min(1).optional(),
    })
    .refine((v) => v.endpoint || v.field || v.symbol, {
      message: 'exactly one of endpoint, field, symbol must be set',
    }),
  cap: z.number().int().positive().optional(),
  depth: z.number().int().nonnegative().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
});
export const TraceImpactResponse = z.object({
  snapshot: z.string().min(1).optional(),
  findings: z.array(
    z.object({
      id: z.string().min(1).optional(),
      change: z
        .object({
          kind: z.string().min(1).optional(),
          service: z.string().min(1).optional(),
          field: z.string().min(1).optional(),
          route: z.string().min(1).optional(),
        })
        .optional(),
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
export const GetCoverageArgs = z.object({ snapshot: z.string().min(1) });
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
