import { z } from 'zod';
import { LainView } from './enums.js';

// Tipos del grafo crudo de lain (paquetes raw/arch): query_graph,
// describe_schema, get_code_snippet, explain_symbol y get_call_sites.
//
// Divergencias motor ↔ docs/query-language.md de lain, verificadas en vivo
// contra el fixture :9997:
//   - El argumento se llama `query`, no `spec` (el docs dice `spec`).
//   - 0.9.1 omite edges/paths; 0.11 los devuelve para connect. loose()
//     conserva ambos campos. El motor omite nodes cuando count=0.
//   - `meta` no trae `plan` (sólo exec_us y nodes_visited).
//   - El filtro `id` de find es inerte en este build: hay que dirigir los
//     nodos por type+name.

/** Un op del pipeline; el motor acepta campos extra, no los modelamos en profundidad. */
export const QueryGraphOp = z.looseObject({ op: z.string().min(1) });
export type QueryGraphOp = z.infer<typeof QueryGraphOp>;

export const QueryGraphSpec = z.object({
  ops: z.array(QueryGraphOp).min(1),
});
export type QueryGraphSpec = z.infer<typeof QueryGraphSpec>;

export const QueryGraphArgs = z.object({
  query: QueryGraphSpec,
  // Obligatorio en modo federación (varios repos por servidor).
  repo_id: z.string().min(1).optional(),
});
export type QueryGraphArgs = z.infer<typeof QueryGraphArgs>;

export const QueryGraphNode = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string(),
  })
  .loose();
export type QueryGraphNode = z.infer<typeof QueryGraphNode>;

// Arista concreta devuelta por connect desde 0.11 (antes sólo llegaba
// `nodes`): from/to son ids de nodo. `provenance`/`confidence`/`site` pasan
// con loose().
export const QueryGraphEdge = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .loose();
export type QueryGraphEdge = z.infer<typeof QueryGraphEdge>;

// Camino multi-hop devuelto por connect (0.11+): cadena de nodos + aristas.
export const QueryGraphPath = z
  .object({
    nodes: z.array(QueryGraphNode).default([]),
    edges: z.array(QueryGraphEdge).default([]),
  })
  .loose();
export type QueryGraphPath = z.infer<typeof QueryGraphPath>;

// `nodes` se omite entero cuando el resultado está vacío: default([]) lo
// normaliza sin mintear datos (un vacío sigue siendo un vacío). `edges` y
// `paths` sólo aparecen en consultas connect (0.11+); default([]) también.
export const QueryGraphResponse = z
  .object({
    nodes: z.array(QueryGraphNode).default([]),
    edges: z.array(QueryGraphEdge).default([]),
    paths: z.array(QueryGraphPath).default([]),
    count: z.number().int().nonnegative(),
    legacy: z.boolean().optional(),
    groups: z.looseObject({}).optional(),
    meta: z.looseObject({}).optional(),
    occupancy: z.looseObject({}).optional(),
  })
  .loose();
export type QueryGraphResponse = z.infer<typeof QueryGraphResponse>;

export const DescribeSchemaArgs = z.object({}).strict();
export type DescribeSchemaArgs = z.infer<typeof DescribeSchemaArgs>;

export const SchemaTypeEntry = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    indexed: z.boolean().optional(),
  })
  .loose();

export const SchemaEdgeEntry = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    source_types: z.array(z.string()).optional(),
    target_types: z.array(z.string()).optional(),
    indexed: z.boolean().optional(),
  })
  .loose();

export const DescribeSchemaResponse = z
  .object({
    node_types: z.array(SchemaTypeEntry),
    edge_types: z.array(SchemaEdgeEntry),
  })
  .loose();
export type DescribeSchemaResponse = z.infer<typeof DescribeSchemaResponse>;

export const LoadPackageArgs = z.object({
  package: z.string().min(1),
});
export type LoadPackageArgs = z.infer<typeof LoadPackageArgs>;

// load_package responde JSON: {already_loaded, loaded, package, pitch, hint…}.
export const LoadPackageResponse = z
  .object({
    package: z.string().min(1),
    loaded: z.boolean().optional(),
    already_loaded: z.boolean().optional(),
  })
  .loose();
export type LoadPackageResponse = z.infer<typeof LoadPackageResponse>;

export const GetCodeSnippetArgs = z
  .object({
    path: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    line: z.number().int().min(1).optional(),
    context_lines: z.number().int().min(0).max(50).optional(),
  })
  .strict();
export type GetCodeSnippetArgs = z.infer<typeof GetCodeSnippetArgs>;

export const ExplainSymbolArgs = z
  .object({
    symbol: z.string().min(1),
    repo_id: z.string().min(1).optional(),
  })
  .strict();
export type ExplainSymbolArgs = z.infer<typeof ExplainSymbolArgs>;

export const GetCallSitesArgs = z
  .object({
    symbol: z.string().min(1),
    repo_id: z.string().min(1).optional(),
  })
  .strict();
export type GetCallSitesArgs = z.infer<typeof GetCallSitesArgs>;

// answer_scope del motor dev: vocabulario de incompletitud (truncated,
// stale_or_unindexed, dynamic_target, ambiguous_target) que acompaña al
// structuredContent de las tools raw con outputSchema (get_call_sites,
// explain_symbol, assess_change, explain_dispatch…). INV 3 lo hace mecánico.
export const AnswerScope = z.record(z.string(), z.unknown());
export type AnswerScope = z.infer<typeof AnswerScope>;

// Estas tres tools devuelven markdown plano: el adapter las envuelve como
// {text}. Desde el batch v0.15.0 de dev también pueden traer structuredContent
// con answer_scope, que se conserva aparte sin reemplazar el texto.
export const LainTextResponse = z.object({
  text: z.string(),
  answerScope: AnswerScope.optional(),
});
export type LainTextResponse = z.infer<typeof LainTextResponse>;

// ---- Batch v0.15.0 de dev: tools raw con outputSchema (paquete raw) ----
// Los inputSchema de lain no declaran additionalProperties:false en estas
// tools, y el handler acepta `snapshot`/`repo_id` aunque el schema no los
// enumere: el espejo los declara opcionales y el dispatcher siempre inyecta
// la vista del análisis (INV 1).

// search_code — búsqueda léxica/semántica sobre el índice del grafo.
export const SearchCodeArgs = z.looseObject({
  query: z.string().min(1),
  mode: z.enum(['lexical', 'semantic', 'auto']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  snapshot: LainView.optional(),
  repo_id: z.string().min(1).optional(),
});
export type SearchCodeArgs = z.infer<typeof SearchCodeArgs>;

export const SearchCodeResponse = z.looseObject({
  query: z.string().optional(),
  mode: z.string().optional(),
  fell_back: z.boolean().optional(),
  results: z.array(z.looseObject({})).default([]),
  count: z.number().int().nonnegative().optional(),
  answer_scope: AnswerScope.optional(),
});
export type SearchCodeResponse = z.infer<typeof SearchCodeResponse>;

// assess_change — impacto pre-edición de un símbolo con verdict de riesgo.
export const AssessChangeArgs = z.looseObject({
  symbol: z.string().min(1),
  snapshot: LainView.optional(),
  repo_id: z.string().min(1).optional(),
  depth: z.string().optional(),
  include_tests: z.boolean().optional(),
  limit: z.number().int().min(1).optional(),
});
export type AssessChangeArgs = z.infer<typeof AssessChangeArgs>;

export const AssessChangeResponse = z.looseObject({
  target: z.looseObject({}).optional(),
  risk: z.string().optional(),
  answer_scope: AnswerScope.optional(),
});
export type AssessChangeResponse = z.infer<typeof AssessChangeResponse>;

// explain_dispatch — verdict único sobre los edges de despacho de un símbolo.
export const ExplainDispatchArgs = z.looseObject({
  symbol: z.string().min(1),
  snapshot: LainView.optional(),
  repo_id: z.string().min(1).optional(),
});
export type ExplainDispatchArgs = z.infer<typeof ExplainDispatchArgs>;

export const ExplainDispatchResponse = z.looseObject({
  verdict: z.string().optional(),
  answer_scope: AnswerScope.optional(),
});
export type ExplainDispatchResponse = z.infer<typeof ExplainDispatchResponse>;

// get_cross_runtime_callers — llamadores a nivel de protocolo (HTTP/gRPC/GraphQL).
export const GetCrossRuntimeCallersArgs = z.looseObject({
  node_id: z.string().min(1),
  snapshot: LainView.optional(),
  repo_id: z.string().min(1).optional(),
});
export type GetCrossRuntimeCallersArgs = z.infer<typeof GetCrossRuntimeCallersArgs>;

export const GetCrossRuntimeCallersResponse = z.looseObject({
  target: z.looseObject({}).optional(),
  answer_scope: AnswerScope.optional(),
});
export type GetCrossRuntimeCallersResponse = z.infer<typeof GetCrossRuntimeCallersResponse>;

// get_call_chain — camino exacto from→to dentro de un repo. Devuelve texto
// (sin outputSchema): el adapter la trata como LainTextResponse.
export const GetCallChainArgs = z.looseObject({
  from: z.string().min(1),
  to: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  snapshot: LainView.optional(),
});
export type GetCallChainArgs = z.infer<typeof GetCallChainArgs>;

// get_federation_health — estado por repo (Indexing/Ready/Degraded) con razón.
export const GetFederationHealthArgs = z.object({});
export type GetFederationHealthArgs = z.infer<typeof GetFederationHealthArgs>;

export const FederationRepoHealth = z.looseObject({
  repo: z.string().min(1),
  state: z.string().optional(),
  reason: z.string().optional(),
});
export type FederationRepoHealth = z.infer<typeof FederationRepoHealth>;

export const GetFederationHealthResponse = z.looseObject({
  repos: z.array(FederationRepoHealth).default([]),
});
export type GetFederationHealthResponse = z.infer<typeof GetFederationHealthResponse>;
