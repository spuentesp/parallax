import { z } from 'zod';
import { FindingClass, LainView } from './enums.js';

// Contra el pin vigente del motor: los *Args replican el inputSchema de
// docs/lain-tool-schemas.json (recapturado con tools/list del paquete
// `contracts` del lain de dev; ver docs/lain-integration-notes.md) y las
// *Response describen el campo `data` del envoltorio
// { analyzer_version, api_version, data, meta, snapshot, view, reproducible }
// que el LainAdapter devuelve tras parsear content[0].text (o structuredContent).
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

// Respuestas de las tools de catálogo. Se modelan sólo las señales que el
// producto consume; los blobs de evidencia pasan con .loose().
export const ListContractsResponse = z.object({
  items: z.array(
    z
      .object({
        endpoint: EndpointRef,
        has_schema: z.boolean().optional(),
        bound_consumers: z.number().int().nonnegative().optional(),
      })
      .loose(),
  ),
  cursor: z.string().nullable().optional(),
});
export type ListContractsResponse = z.infer<typeof ListContractsResponse>;

// Handler de un contrato desde el batch v0.15.0 de dev: antes era un string,
// ahora es un objeto {repo, file, symbol} (get_contract.out.json, $defs/Handler).
export const HandlerRef = z
  .object({
    repo: z.string().min(1),
    file: z.string().min(1),
    symbol: z.string().min(1),
  })
  .strict();
export type HandlerRef = z.infer<typeof HandlerRef>;

export const GetContractResponse = z.object({
  // Cada item es un contrato con sus refs de evidencia; cada ref puede llevar
  // `handlers` con la ubicación del código que atiende el endpoint.
  items: z.array(z.looseObject({ handlers: z.array(HandlerRef).optional() })),
});
export type GetContractResponse = z.infer<typeof GetContractResponse>;

const UnresolvedScope = z
  .object({
    configured_only: z.boolean().optional(),
    reviewed: z.array(z.looseObject({})).optional(),
    unreviewed: z.array(z.looseObject({})).optional(),
  })
  .loose();

// Vocabulario de razones de list_unresolved en el motor dev (v0.15.0 batch):
// el split `dynamic_target` (ruta seleccionada en runtime sin servicio
// atribuible) salió de `no_route_in_service`, que queda para el caso de
// servicio conocido con camino dinámico.
export const UnresolvedReason = z.enum([
  'no_route_in_service',
  'no_match',
  'wrapper_unconfigured',
  'env_unmapped',
  'env_ambiguous',
  'rpc_stub_unknown',
  'graphql_no_op',
  'dynamic_url',
  'base_unknown',
  'dynamic_topic',
  'external_ref',
  'dynamic_sql',
  'orm_dynamic_query',
  'external_schema_ref',
  'dynamic_target',
]);
export type UnresolvedReason = z.infer<typeof UnresolvedReason>;

export const ListUnresolvedResponse = z.object({
  items: z.array(z.looseObject({ reason: UnresolvedReason.optional() })),
  ambiguous: z.array(z.looseObject({})),
  scope: UnresolvedScope,
});
export type ListUnresolvedResponse = z.infer<typeof ListUnresolvedResponse>;

// `check_binding` diagnostica un vínculo propuesto y, cuando es válido,
// devuelve `bindings_entry`: el YAML de `repos.yaml#bindings` listo para
// copiar. Hay que usarlo verbatim — su symbol/key están calibrados para que
// el matcher del motor (repo + path + symbol) encuentre el nodo.
export const CheckBindingReason = z.enum([
  'not_a_consumer',
  'method_mismatch',
  'template_mismatch',
  'same_service',
  'already_bound',
  // Del motor nuevo (bindings GraphQL): la llave no coincide en op o en el
  // campo raíz. El 0.9 no los emite porque rechaza las llaves graphql:.
  'op_mismatch',
  'field_mismatch',
]);
export type CheckBindingReason = z.infer<typeof CheckBindingReason>;

export const TemplateMatch = z.enum(['exact', 'pattern', 'prefix_stripped', 'none']);
export type TemplateMatch = z.infer<typeof TemplateMatch>;

export const CheckBindingResponse = z
  .object({
    valid: z.boolean(),
    reasons: z.array(CheckBindingReason),
    method_match: z.boolean(),
    template_match: TemplateMatch,
    bindings_entry: z.string().optional(),
  })
  .loose();
export type CheckBindingResponse = z.infer<typeof CheckBindingResponse>;

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
    // Del motor dev (v0.15.0 batch): profundidad máxima de los caminos de
    // impacto y timeout cooperativo del análisis (diff_contracts.in.json).
    max_hops: z.number().int().min(1).max(100).optional(),
    timeout_ms: z.number().int().min(1).max(600_000).optional(),
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
  // Del motor dev: el análisis puede quedar incompleto por timeout; un diff
  // truncado nunca es "sin impacto" (INV 3).
  truncated: z.boolean().optional(),
  truncation_reason: z.enum(['timeout']).optional(),
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

// 14. trace_flow (batch v0.15.0 de dev, paquete contracts) — un camino a través
// del borde de contratos con provenance por salto y `gaps` explícitos (dónde
// se corta la cadena y por qué). `snapshot` es opcional en el motor (default
// live); Parallax siempre lo envía para fijar la vista (INV 1).
export const TraceFlowFrom = z
  .object({
    endpoint: EndpointRef.optional(),
    symbol: z.string().min(1).optional(),
    repo_id: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
  })
  .refine((v) => [v.endpoint, v.symbol, v.table].filter((x) => x !== undefined).length === 1, {
    message: 'exactly one of endpoint, symbol, table must be set',
  });
export type TraceFlowFrom = z.infer<typeof TraceFlowFrom>;

export const TraceFlowArgs = z
  .object({
    snapshot: LainView.optional(),
    from: TraceFlowFrom,
    direction: z.enum(['downstream', 'upstream']).optional(),
    strategy: z.enum(['breadth', 'depth']).optional(),
    depth: z.union([z.string().min(1), z.number()]).optional(),
    cap: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type TraceFlowArgs = z.infer<typeof TraceFlowArgs>;

export const TraceFlowHop = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().optional(),
  node_type: z.string().optional(),
  repo: z.string().optional(),
  path: z.string().optional(),
  line: z.number().int().nullable().optional(),
  edge_type: z.string().nullable().optional(),
});
export type TraceFlowHop = z.infer<typeof TraceFlowHop>;

export const TraceFlowPath = z.looseObject({
  min_confidence: z.number().optional(),
  boundary_hops: z.number().int().nonnegative().optional(),
  hops: z.array(TraceFlowHop).default([]),
});
export type TraceFlowPath = z.infer<typeof TraceFlowPath>;

export const TraceFlowGap = z.looseObject({
  node: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  reason: z.string().min(1),
});
export type TraceFlowGap = z.infer<typeof TraceFlowGap>;

export const TraceFlowResponse = z
  .object({
    from: z.looseObject({}),
    direction: z.enum(['downstream', 'upstream']).optional(),
    seeds: z.array(z.string()).default([]),
    paths: z.array(TraceFlowPath).default([]),
    gaps: z.array(TraceFlowGap).default([]),
    truncated: z.boolean().optional(),
    truncation_reasons: z.array(z.string()).optional(),
    nodes_visited: z.number().int().nonnegative().optional(),
    scope: Scope.optional(),
  })
  .loose();
export type TraceFlowResponse = z.infer<typeof TraceFlowResponse>;

// 15. list_service_refs (batch v0.15.0, paquete contracts) — literales URL que
// nombran un servicio declarado: evidencia de objetivo, no de llamada
// (`linked_to_call` dice si un sensor vio la llamada en esa línea). Live only.
export const ListServiceRefsArgs = z
  .object({
    snapshot: z.literal('live'),
    repo: z.string().min(1).optional(),
    usage: z.enum(['production', 'test', 'configuration', 'documentation']).optional(),
    outcome: z.enum(['resolved', 'ambiguous', 'unknown']).optional(),
    cursor: Cursor.optional(),
    limit: Limit.optional(),
    suggestions: z.boolean().optional(),
    min_score: z.number().min(0).max(1).optional(),
  })
  .strict();
export type ListServiceRefsArgs = z.infer<typeof ListServiceRefsArgs>;

export const ServiceRefOutcome = z.looseObject({
  kind: z.enum(['resolved', 'ambiguous', 'unknown']),
  service: z.string().optional(),
  services: z.array(z.string()).optional(),
});
export type ServiceRefOutcome = z.infer<typeof ServiceRefOutcome>;

export const ServiceRef = z.looseObject({
  repo: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().min(1),
  value: z.string().min(1),
  host: z.string().optional(),
  outcome: ServiceRefOutcome.optional(),
  usage: z.string().optional(),
  linked_to_call: z.boolean().optional(),
});
export type ServiceRef = z.infer<typeof ServiceRef>;

export const ListServiceRefsResponse = z
  .object({
    items: z.array(ServiceRef),
    cursor: z.string().nullable().optional(),
    suggestions: z.array(z.looseObject({})).optional(),
  })
  .loose();
export type ListServiceRefsResponse = z.infer<typeof ListServiceRefsResponse>;

// 16. apply_contract_context (batch v0.15.0, paquete contracts) — aplica
// provides/host_aliases/bindings al repos.yaml del servidor (con .bak) y los
// sirve; dry-run por defecto. `applied` sólo es true si todo queda servido.
export const ContractContextBinding = z
  .object({
    consumer: z
      .object({
        repo: z.string().min(1),
        path: z.string().min(1),
        symbol: z.string().min(1),
        key: z.string().min(1),
        site: z.string().min(1).optional(),
      })
      .strict(),
    provider: z.looseObject({ service: z.string().min(1), key: z.string().min(1) }),
  })
  .loose();
export type ContractContextBinding = z.infer<typeof ContractContextBinding>;

export const ApplyContractContextArgs = z
  .object({
    snapshot: z.literal('live'),
    provides: z
      .array(z.looseObject({ service: z.string().min(1), key: z.string().min(1) }))
      .optional(),
    host_aliases: z.array(z.looseObject({})).optional(),
    bindings: z.array(ContractContextBinding).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type ApplyContractContextArgs = z.infer<typeof ApplyContractContextArgs>;

export const ApplyContractContextResponse = z
  .object({
    applied: z.boolean(),
    dry_run: z.boolean().optional(),
    config_path: z.string().optional(),
    added: z.array(z.looseObject({})).optional(),
    added_host_aliases: z.array(z.looseObject({})).optional(),
    added_bindings: z.array(z.looseObject({})).optional(),
    yaml: z.string().optional(),
    backup: z.string().optional(),
    note: z.string().optional(),
  })
  .loose();
export type ApplyContractContextResponse = z.infer<typeof ApplyContractContextResponse>;
