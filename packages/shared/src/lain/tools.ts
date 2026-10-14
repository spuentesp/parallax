import { z } from 'zod';
import { FindingClass, LainView } from './enums.js';

// Contra la versión fijada del motor: los *Args replican el inputSchema de
// docs/lain-tool-schemas.json (capturado con tools/list de lain 0.9.1) y las
// *Response describen el campo `data` del envoltorio
// { analyzer_version, api_version, data, meta, snapshot, view, reproducible }
// que el LainAdapter devuelve tras parsear content[0].text.
//
// Los argumentos son estrictos donde el motor declara additionalProperties:false
// (prepare_snapshot no lo declara y además acepta configHash), para que una
// tool o un argumento renombrado fallen en casa antes que en el servidor.

/** Snapshot id (`snap_<hex>`): `live` no es válido como base/head de un diff. */
export const SnapshotId = z.string().regex(/^snap_[0-9a-f]+$/);
export type SnapshotId = z.infer<typeof SnapshotId>;

export const EndpointRef = z.object({
  key: z.string().min(1),
  service: z.string().min(1),
});
export type EndpointRef = z.infer<typeof EndpointRef>;

const Cursor = z.string().min(1);
const Limit = z.number().int().min(1).max(1000);
const WaitMs = z.number().int().min(0).max(60000);

const ReviewedRepo = z.object({
  repo: z.string().min(1),
  commit: z.string().min(1),
  dirty: z.boolean(),
});

const Scope = z
  .object({
    configured_only: z.boolean(),
    reviewed: z.array(ReviewedRepo),
    unreviewed: z.array(z.string()),
  })
  .loose();

const SnapshotRepo = z.object({ repo: z.string().min(1) }).loose();

// 1. list_services — data.items[] + data.scope
export const ListServicesArgs = z
  .object({
    snapshot: LainView,
    repo: z.string().min(1).optional(),
    cursor: Cursor.optional(),
    limit: Limit.optional(),
  })
  .strict();
export type ListServicesArgs = z.infer<typeof ListServicesArgs>;

export const ServiceSummary = z.object({
  service: z.string().min(1),
  repo: z.string().min(1),
  endpoints: z.number().int().nonnegative(),
  consumer_services: z.number().int().nonnegative(),
  unresolved_inbound: z.number().int().nonnegative(),
  paths: z.array(z.string()),
});

export const ListServicesResponse = z.object({
  items: z.array(ServiceSummary),
  scope: Scope,
});
export type ListServicesResponse = z.infer<typeof ListServicesResponse>;

// 2. get_service — data.service + data.consumers[] + data.endpoints[]
//
// El motor (analyzer 0.9.1) nombra al consumidor por `service` (y su `repo`);
// cada `uses[]` lleva un `binding` con confidence/kind y el `endpoint` que se
// consume. `caller`/`site` son anclas de evidencia (repo/path/line/commit/text)
// que se propagan sin modelar en profundidad; `used_by`, `reads_complete` y
// demás metadatos ricos pasan a través con loose().
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

const Use = z
  .object({
    binding: Binding,
    endpoint: EndpointRef.optional(),
    fields: z.array(z.string()).default([]),
    match: z.string().optional(),
    caller: Anchor.optional(),
    site: Anchor.optional(),
  })
  .loose();

const Consumer = z.object({
  service: z.string().min(1),
  repo: z.string().min(1),
  uses: z.array(Use),
});

export const GetServiceArgs = z
  .object({
    snapshot: LainView,
    service: z.string().min(1),
    cursor: Cursor.optional(),
    limit: Limit.optional(),
    depth: z.number().int().min(1).max(8).optional(),
  })
  .strict();
export type GetServiceArgs = z.infer<typeof GetServiceArgs>;

export const GetServiceResponse = z
  .object({
    service: z.string().min(1),
    consumers: z.array(Consumer),
    endpoints: z.array(z.string()),
  })
  .loose();
export type GetServiceResponse = z.infer<typeof GetServiceResponse>;

// 3. prepare_snapshot — idempotente: mismas entradas tras resolución de refs
// producen el mismo id; `from` deriva de un snapshot listo.
export const PrepareSnapshotArgs = z
  .object({
    repos: z.record(z.string(), z.string().min(1)).optional(),
    exclude: z.array(z.string()).optional(),
    from: SnapshotId.optional(),
    max_base_age_s: z.number().int().min(1).optional(),
    wait_ms: WaitMs.optional(),
    // Parte del contrato de idempotencia aunque el tools/list capturado no lo
    // enumera: prepare_snapshot no declara additionalProperties:false.
    configHash: z.string().min(1).optional(),
  })
  .loose();
export type PrepareSnapshotArgs = z.infer<typeof PrepareSnapshotArgs>;

export const PrepareSnapshotResponse = z.object({
  snapshot: z.string().min(1),
  state: z.enum(['pending', 'ready', 'failed']),
  repos: z.array(SnapshotRepo).optional(),
  created_unix: z.number().optional(),
  last_access_unix: z.number().optional(),
});
export type PrepareSnapshotResponse = z.infer<typeof PrepareSnapshotResponse>;

// 4. get_snapshot — misma forma que devuelve prepare_snapshot; sobre `live`
// responde con la forma de readiness del §8.7.
export const GetSnapshotArgs = z
  .object({
    snapshot: LainView,
    wait_ms: WaitMs.optional(),
  })
  .strict();
export type GetSnapshotArgs = z.infer<typeof GetSnapshotArgs>;

export const GetSnapshotResponse = z.object({
  snapshot: z.string().min(1),
  state: z.enum(['pending', 'ready', 'failed']),
  repos: z.array(SnapshotRepo).optional(),
  created_unix: z.number().optional(),
  last_access_unix: z.number().optional(),
  error: z.string().optional(),
});
export type GetSnapshotResponse = z.infer<typeof GetSnapshotResponse>;

// 5. list_contracts
export const ListContractsArgs = z
  .object({
    snapshot: LainView,
    service: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    kind: z.enum(['http', 'topic', 'rpc', 'graphql', 'websocket', 'table']).optional(),
    cursor: Cursor.optional(),
    limit: Limit.optional(),
  })
  .strict();
export type ListContractsArgs = z.infer<typeof ListContractsArgs>;

// 6. get_contract
export const GetContractArgs = z
  .object({
    snapshot: LainView,
    key: z.string().min(1),
    service: z.string().min(1).optional(),
  })
  .strict();
export type GetContractArgs = z.infer<typeof GetContractArgs>;

// 7. list_unresolved — data.{ambiguous, items, scope}
export const ListUnresolvedArgs = z
  .object({
    snapshot: LainView,
    cursor: Cursor.optional(),
    limit: Limit.optional(),
    repo: z.string().min(1).optional(),
    service: z.string().min(1).optional(),
  })
  .strict();
export type ListUnresolvedArgs = z.infer<typeof ListUnresolvedArgs>;

// 8. check_binding — valida un vínculo propuesto; no crea nada.
export const CheckBindingArgs = z
  .object({
    snapshot: LainView,
    consumer: z.string().min(1),
    endpoint: EndpointRef,
  })
  .strict();
export type CheckBindingArgs = z.infer<typeof CheckBindingArgs>;

// 9. diff_contracts — base/head deben ser snapshots `ready`; `live` se rechaza
// en el motor con invalid_argument / live_not_supported.
export const DiffContractsArgs = z
  .object({
    base: SnapshotId,
    head: SnapshotId,
    service: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    cap: z.number().int().min(1).max(500).optional(),
    min_impact: FindingClass.optional(),
  })
  .strict();
export type DiffContractsArgs = z.infer<typeof DiffContractsArgs>;

const ContractChange = z.object({
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
});

const Coverage = z
  .object({
    complete: z.boolean(),
    scope: Scope.optional(),
    repos: z.array(SnapshotRepo).optional(),
  })
  .loose();

export const DiffContractsResponse = z.object({
  changes: z.array(ContractChange),
  compatible_changes: z.number().int().nonnegative().optional(),
  coverage: Coverage.optional(),
});
export type DiffContractsResponse = z.infer<typeof DiffContractsResponse>;

// 10. trace_impact — exactamente uno de endpoint/field/symbol en `from`.
const ImpactHop = z
  .object({
    edge: z.string().min(1),
    node: z.string().min(1),
    node_type: z.string().min(1),
    name: z.string().optional(),
    provenance: z
      .object({
        confidence: z.number(),
        kind: z.string().min(1),
      })
      .optional(),
  })
  .loose();

const ImpactPath = z
  .object({
    start: z.string().min(1),
    min_confidence: z.number(),
    hops: z.array(ImpactHop),
  })
  .loose();

export const TraceImpactArgs = z
  .object({
    snapshot: LainView,
    from: z
      .object({
        endpoint: EndpointRef.optional(),
        field: z
          .object({
            direction: z.enum(['request', 'response', 'payload']).optional(),
            endpoint: EndpointRef.optional(),
            json_path: z.string().optional(),
          })
          .optional(),
        symbol: z.string().optional(),
      })
      .refine((v) => v.endpoint !== undefined || v.field !== undefined || v.symbol !== undefined, {
        message: 'exactly one of endpoint, field, symbol must be set',
      }),
    cap: z.number().int().min(1).max(500).optional(),
    depth: z.number().int().min(1).max(12).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
  })
  .strict();
export type TraceImpactArgs = z.infer<typeof TraceImpactArgs>;

export const TraceImpactResponse = z
  .object({
    paths: z.array(ImpactPath),
    scope: Scope.optional(),
    truncated: z.boolean().optional(),
  })
  .loose();
export type TraceImpactResponse = z.infer<typeof TraceImpactResponse>;

// 11. get_coverage — qué vio la vista y qué no pudo resolver; con `endpoint`,
// `complete` refleja la puerta de could-match.
export const GetCoverageArgs = z
  .object({
    snapshot: LainView,
    endpoint: EndpointRef.optional(),
  })
  .strict();
export type GetCoverageArgs = z.infer<typeof GetCoverageArgs>;

export const GetCoverageResponse = Coverage;
export type GetCoverageResponse = z.infer<typeof GetCoverageResponse>;

// 12. resolve_evidence — `refs` acepta GlobalIds o textos EvidenceRef
// `<repo>@<sha>:<path>:<line>`; una ref mala devuelve exists:false con reason,
// nunca un error.
export const ResolveEvidenceArgs = z
  .object({
    snapshot: LainView,
    refs: z.array(z.string().min(1)).min(1).max(200),
    context_lines: z.number().int().min(0).max(20).optional(),
  })
  .strict();
export type ResolveEvidenceArgs = z.infer<typeof ResolveEvidenceArgs>;

const EvidenceNode = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  node_type: z.string().min(1),
  ref: Anchor,
});

const EvidenceItem = z.object({
  exists: z.boolean(),
  ref: z.string(),
  snippet: z.string().nullable().optional(),
  reason: z.string().optional(),
  node: EvidenceNode.optional(),
});

export const ResolveEvidenceResponse = z.object({
  items: z.array(EvidenceItem),
});
export type ResolveEvidenceResponse = z.infer<typeof ResolveEvidenceResponse>;

// 13. read_source — un rango de líneas acotado del índice del snapshot; el
// motor rechaza secretos y binarios (§10.7).
export const ReadSourceArgs = z
  .object({
    snapshot: LainView,
    repo: z.string().min(1),
    path: z.string().min(1),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .strict();
export type ReadSourceArgs = z.infer<typeof ReadSourceArgs>;

export const ReadSourceResponse = z.object({
  text: z.string(),
  path: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  commit: z.string().min(1),
  total_lines: z.number().int().nonnegative(),
  source: z.string().optional(),
});
export type ReadSourceResponse = z.infer<typeof ReadSourceResponse>;
