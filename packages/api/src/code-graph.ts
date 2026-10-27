import type { QueryGraphNode, QueryGraphSpec } from '@parallax/shared/lain';
import type { LainAdapter } from './lain-adapter/types.js';

// Topología de código expandible sobre query_graph (paquete raw de lain).
//
// LAIN 0.11 devuelve edges/paths en consultas connect; 0.9.1 sólo devolvía
// nodos. Cada nivel conserva consultas compatibles con ambos motores, y
// las relaciones de comunicación se agrupan por TIPO de arista
// (una consulta por arista) en vez de inventar aristas por par de nodos:
//
//   raíz:      find {type: [File, Namespace, Module, Package, HttpRoute, Topic]}
//              + sort + limit          → estructura de alto nivel por repo
//   hijos:     find {type, name} + connect {edge: Contains, outgoing, depth: 1}
//              + limit                 → lo que el nodo contiene
//   comm:      find {type, name} + connect {edge: E, both, depth: 1} + limit,
//              una consulta por E ∈ {Calls, Uses, Imports, Produces, Consumes,
//              CallsHttp}               → vecinos de comunicación por arista
//
// El filtro `id` de find es INERTE en este build (matchea todo el repo): los
// nodos se dirigen por type+name, nunca por UUID. Un resultado vacío se
// devuelve vacío — nunca se sintetiza una arista (INV 3).

/** Tipos de nodo que componen la raíz de un repo. */
export const ROOT_NODE_TYPES = [
  'File',
  'Namespace',
  'Module',
  'Package',
  'HttpRoute',
  'Topic',
] as const;

/** Aristas de comunicación que muestra la expansión de un nodo. */
export const COMM_EDGE_TYPES = [
  'Calls',
  'Uses',
  'Imports',
  'Produces',
  'Consumes',
  'CallsHttp',
] as const;

export const ROOT_LIMIT = 200;
export const CHILDREN_LIMIT = 100;
export const COMM_LIMIT = 50;

export type CodeNodeKind = 'container' | 'symbol' | 'route' | 'schema' | 'other';

export interface CodeGraphNode {
  /** UUID del motor (informativo; el filtro `id` no sirve para dirigirlo). */
  id: string;
  name: string;
  /** Tipo del grafo: File, Function, Method, HttpRoute… */
  type: string;
  kind: CodeNodeKind;
}

export interface CodeGraphRepoRoot {
  repo: string;
  nodes: CodeGraphNode[];
  /** true si la consulta devolvió exactamente el límite (puede haber más). */
  truncated: boolean;
  error?: string;
}

export interface GraphRootResult {
  repos: CodeGraphRepoRoot[];
}

export interface CodeGraphCommGroup {
  edge: string;
  nodes: CodeGraphNode[];
  error?: string;
}

export interface NodeRef {
  repo: string;
  type: string;
  name: string;
}

export interface GraphChildrenResult {
  node: NodeRef;
  children: CodeGraphNode[];
  childrenTruncated: boolean;
  /** Vecinos agrupados por arista; vacío (no ausente) = sin comunicación. */
  communications: CodeGraphCommGroup[];
  hasCommunication: boolean;
}

export interface SymbolSnippetResult {
  symbol: string;
  repo: string;
  path: string | null;
  text: string | null;
  error?: string;
}

const CONTAINER_TYPES = new Set(['File', 'Namespace', 'Module', 'Package']);
const ROUTE_TYPES = new Set(['HttpRoute', 'Topic', 'Resource']);
const SCHEMA_TYPES = new Set(['Schema']);
const SYMBOL_TYPES = new Set([
  'Class',
  'Interface',
  'Struct',
  'Enum',
  'Trait',
  'Function',
  'Method',
  'Property',
  'Variable',
  'Constant',
  'Field',
  'FieldRef',
  'HttpClientCall',
  'Table',
  'Synthetic',
]);

export function classifyNode(type: string): CodeNodeKind {
  if (CONTAINER_TYPES.has(type)) return 'container';
  if (ROUTE_TYPES.has(type)) return 'route';
  if (SCHEMA_TYPES.has(type)) return 'schema';
  if (SYMBOL_TYPES.has(type)) return 'symbol';
  return 'other';
}

export function toCodeNode(n: QueryGraphNode): CodeGraphNode {
  return { id: n.id, name: n.name, type: n.type, kind: classifyNode(n.type) };
}

function findOps(ref: { type: string; name: string }): {
  op: 'find';
  type: string;
  name: { exact: string };
} {
  return { op: 'find', type: ref.type, name: { exact: ref.name } };
}

/** Raíz de un repo: estructura de alto nivel, acotada y marcada si se corta. */
export async function buildRepoRoot(
  adapter: LainAdapter,
  repo: string,
  limit = ROOT_LIMIT,
): Promise<CodeGraphRepoRoot> {
  const spec: QueryGraphSpec = {
    ops: [
      { op: 'find', type: [...ROOT_NODE_TYPES] },
      { op: 'sort', by: 'name' },
      { op: 'limit', count: limit },
    ],
  };
  try {
    const res = await adapter.queryGraph({ query: spec, repo_id: repo });
    const nodes = res.nodes.map(toCodeNode).sort((a, b) => a.name.localeCompare(b.name));
    return {
      repo,
      nodes,
      // Si llegó al límite, puede haber más nodos de los que vemos.
      truncated: res.nodes.length >= limit,
    };
  } catch (e) {
    return {
      repo,
      nodes: [],
      truncated: false,
      error: e instanceof Error ? e.message : 'query_graph failed',
    };
  }
}

export async function buildGraphRoot(
  adapter: LainAdapter,
  repos: readonly string[],
  limit = ROOT_LIMIT,
): Promise<GraphRootResult> {
  const out: CodeGraphRepoRoot[] = [];
  for (const repo of repos) {
    out.push(await buildRepoRoot(adapter, repo, limit));
  }
  return { repos: out };
}

/**
 * Expansión de un nodo: lo que contiene (Contains saliente) + sus vecinos de
 * comunicación, una consulta por tipo de arista para poder rotularlos sin
 * inventar la arista concreta entre pares.
 */
export async function buildGraphChildren(
  adapter: LainAdapter,
  ref: NodeRef,
  limits: { children?: number; comm?: number } = {},
): Promise<GraphChildrenResult> {
  const childrenLimit = limits.children ?? CHILDREN_LIMIT;
  const commLimit = limits.comm ?? COMM_LIMIT;

  const containsSpec: QueryGraphSpec = {
    ops: [
      findOps(ref),
      { op: 'connect', edge: 'Contains', direction: 'outgoing', depth: 1 },
      { op: 'limit', count: childrenLimit },
    ],
  };
  const containsRes = await adapter.queryGraph({ query: containsSpec, repo_id: ref.repo });
  // Contains saliente no incluye la semilla, pero se filtra por si el motor
  // cambia de opinión: un nodo no es su propio hijo.
  const children = containsRes.nodes
    .map(toCodeNode)
    .filter((n) => !(n.type === ref.type && n.name === ref.name));

  const communications: CodeGraphCommGroup[] = [];
  for (const edge of COMM_EDGE_TYPES) {
    const spec: QueryGraphSpec = {
      ops: [
        findOps(ref),
        { op: 'connect', edge, direction: 'both', depth: 1 },
        { op: 'limit', count: commLimit },
      ],
    };
    try {
      const res = await adapter.queryGraph({ query: spec, repo_id: ref.repo });
      const nodes = res.nodes
        .map(toCodeNode)
        .filter((n) => !(n.type === ref.type && n.name === ref.name));
      if (nodes.length > 0) {
        communications.push({ edge, nodes });
      }
    } catch (e) {
      // Una arista que el motor rechaza (p. ej. Imports sin indexar) queda
      // registrada como error, no como silencio ni como arista inventada.
      communications.push({
        edge,
        nodes: [],
        error: e instanceof Error ? e.message : 'query_graph failed',
      });
    }
  }

  const hasCommunication = communications.some((g) => g.nodes.length > 0);
  return {
    node: ref,
    children,
    childrenTruncated: containsRes.nodes.length >= childrenLimit,
    communications,
    hasCommunication,
  };
}

/**
 * Fuente de un símbolo: explain_symbol aporta el path (query_graph no devuelve
 * propiedades), y get_code_snippet abre ese path en el índice del repo.
 */
export async function resolveSymbolSnippet(
  adapter: LainAdapter,
  repo: string,
  symbol: string,
  contextLines = 12,
): Promise<SymbolSnippetResult> {
  let path: string | null = null;
  let explainText = '';
  try {
    const explained = await adapter.explainSymbol({ symbol, repo_id: repo });
    explainText = explained.text;
    const m = /\*\*Path:\*\*\s*(.+)/.exec(explained.text);
    path = m?.[1]?.trim() ?? null;
  } catch (e) {
    return {
      symbol,
      repo,
      path: null,
      text: null,
      error: e instanceof Error ? e.message : 'explain_symbol failed',
    };
  }
  if (!path) {
    return {
      symbol,
      repo,
      path: null,
      text: null,
      error: 'explain_symbol did not report a path for this symbol',
    };
  }
  try {
    const snippet = await adapter.getCodeSnippet({
      path,
      repo_id: repo,
      context_lines: contextLines,
    });
    return { symbol, repo, path, text: snippet.text };
  } catch (e) {
    // El path existe en el grafo pero el índice no puede abrirlo: se dice.
    return {
      symbol,
      repo,
      path,
      text: explainText || null,
      error: e instanceof Error ? e.message : 'get_code_snippet failed',
    };
  }
}

/** Fuente de un archivo por su path (p. ej. dónde se define un endpoint). */
export async function resolvePathSnippet(
  adapter: LainAdapter,
  repo: string,
  path: string,
  contextLines = 12,
): Promise<SymbolSnippetResult> {
  try {
    const snippet = await adapter.getCodeSnippet({
      path,
      repo_id: repo,
      context_lines: contextLines,
    });
    return { symbol: path, repo, path, text: snippet.text };
  } catch (e) {
    return {
      symbol: path,
      repo,
      path,
      text: null,
      error: e instanceof Error ? e.message : 'get_code_snippet failed',
    };
  }
}

/**
 * repo_id de LAIN para un repo del workspace: el basename del checkout local
 * (./test-repos/contracts-fixture/orders → orders), o del URI sin .git.
 */
export function deriveLainRepoId(repo: { uri: string; local?: string | null }): string {
  const base = (p: string): string => {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] ?? p;
  };
  if (repo.local && repo.local.trim() !== '') return base(repo.local);
  return base(repo.uri.replace(/\.git$/, ''));
}
