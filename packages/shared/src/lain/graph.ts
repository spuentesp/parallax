import { z } from 'zod';

// Tipos del grafo crudo de lain 0.9.1 (paquetes raw/arch): query_graph,
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

// `nodes` se omite entero cuando el resultado está vacío: default([]) lo
// normaliza sin mintear datos (un vacío sigue siendo un vacío).
export const QueryGraphResponse = z
  .object({
    nodes: z.array(QueryGraphNode).default([]),
    count: z.number().int().nonnegative(),
    legacy: z.boolean().optional(),
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

// Estas tres tools devuelven markdown plano (sin structuredContent): el
// adapter las envuelve como {text} en vez de parsearlas como JSON.
export const LainTextResponse = z.object({ text: z.string() });
export type LainTextResponse = z.infer<typeof LainTextResponse>;
