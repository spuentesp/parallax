// Herramientas de CÓDIGO de LAIN que ve el investigador, además de las de
// contratos. Todas son de sólo lectura y devuelven markdown plano del motor.
// El modelo nombra el repo como `repo` (el despachante lo valida contra el
// catálogo) y aquí se traduce al `repo_id` de LAIN. Sin ellas, el investigador
// sólo puede hablar de contratos: no puede localizar un símbolo, seguir una
// llamada ni medir el radio de un cambio dentro del código.

import { z } from 'zod';

const repo = z.string().min(1).optional();
const symbol = z.string().min(1);
const limit = (max: number) => z.number().int().min(1).max(max).optional();

export const CODE_TOOL_ARGS = {
  understand_repository: z.object({ repo }).strict(),
  search_code: z
    .object({
      query: z.string().min(1),
      repo,
      mode: z.enum(['lexical', 'semantic', 'auto']).optional(),
      limit: limit(25),
    })
    .strict(),
  find_symbol: z
    .object({
      name: z.string().min(1),
      repo,
      path_hint: z.string().min(1).optional(),
      type_filter: z
        .enum([
          'function',
          'method',
          'class',
          'struct',
          'interface',
          'trait',
          'enum',
          'module',
          'file',
        ])
        .optional(),
    })
    .strict(),
  search_org: z.object({ query: z.string().min(1), limit: limit(25) }).strict(),
  find_anchors: z.object({ repo, limit: limit(20) }).strict(),
  list_entry_points: z.object({ repo }).strict(),
  get_context: z.object({ symbol, repo, depth: limit(3) }).strict(),
  explain_symbol: z.object({ symbol, repo }).strict(),
  get_call_sites: z.object({ symbol, repo }).strict(),
  get_call_chain: z.object({ from: symbol, to: symbol, repo }).strict(),
  get_blast_radius: z.object({ symbol, repo }).strict(),
  get_cross_repo_blast_radius: z.object({ symbol, repo, depth: limit(4) }).strict(),
  find_related: z.object({ symbol, repo, limit: limit(25) }).strict(),
  get_coupling_radar: z.object({ symbol, repo }).strict(),
  get_cross_runtime_callers: z
    .object({
      /** El UUID entre comillas invertidas que devuelven find_symbol / search_code. */
      node_id: z.string().min(8),
      repo: z.string().min(1),
    })
    .strict(),
  get_code_snippet: z
    .object({
      path: z.string().min(1),
      repo,
      line: z.number().int().min(1).optional(),
      context_lines: limit(60),
    })
    .strict(),
} as const;

export type CodeTool = keyof typeof CODE_TOOL_ARGS;
export const CODE_TOOLS = Object.keys(CODE_TOOL_ARGS) as CodeTool[];

export const isCodeTool = (name: string): name is CodeTool => name in CODE_TOOL_ARGS;

export const CODE_TOOL_DESCRIPTIONS: Record<CodeTool, string> = {
  understand_repository:
    'Bootstrap a repo: top anchors (foundational symbols), entry points, important paths. Start here for "what is in this repo?".',
  search_code:
    'Find code by name or intent across the code index (functions, classes, schema). Use to locate where a feature lives, e.g. "checkout shipping address". Returns symbol, kind, file:line.',
  find_symbol:
    'Exact symbol lookup by name, optionally narrowed by path_hint and type_filter. Returns ids and file:line.',
  search_org:
    'Case-insensitive substring search across the symbols of EVERY repo of the workspace: shows the same name in API, dashboard and storefront at once.',
  find_anchors: 'The most foundational, stable symbols of a repo: what to read first.',
  list_entry_points:
    'Where execution starts in a repo (main/App-style entry points, top-level routes).',
  get_context: 'One-call dossier for a symbol: definition, callers, callees, source excerpt.',
  explain_symbol: 'Signature, docstring and metrics of a symbol as a readable summary.',
  get_call_sites: 'Every caller of a symbol, with file:line.',
  get_call_chain: 'The exact call path from one symbol to another within a repo.',
  get_blast_radius:
    'What breaks if a symbol changes: direct and transitive dependents, untested ones, co-change partners.',
  get_cross_repo_blast_radius:
    'Like get_blast_radius but follows calls across repositories of the workspace.',
  find_related: 'Graph neighbours and co-change partners of a symbol.',
  get_coupling_radar:
    'Files that change together with this symbol (hidden coupling from git history).',
  get_cross_runtime_callers:
    'Where a handler is wired in: the GraphQL resolvers / HTTP routes / gRPC services that use it. node_id is the UUID in backticks from find_symbol or search_code results; repo is required.',
  get_code_snippet:
    'Source of a file with context around a line. Use to show the code behind an answer.',
};
