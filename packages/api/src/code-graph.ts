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
export const CHILDREN_LIMIT = 60;
/** Cuántos hijos se piden al motor antes de filtrar ruido y recortar a CHILDREN_LIMIT. */
const CHILDREN_FETCH = 400;
/** Tope de directorios al buscar la cima de un repo. */
const DIR_FETCH = 20_000;

// Ruido de estructura: carpetas y archivos que no ayudan a entender qué hace un
// repo (ocultos, tests, mocks, historias, utilidades de prueba). No se borran:
// se cuentan y se declaran ("N ocultos"), y se pueden pedir con `all`.
const NOISE_DIR =
  /^(\.[^/]*|__\w+__|node_modules|e2e|e2e-legacy|tests?|testUtils|storybookUtils|fixtures)$/i;
const NOISE_FILE = /(\.(test|spec|stories)\.[cm]?[jt]sx?$|\.snap$|^\.)/i;

export function isNoise(node: { name: string; type: string }): boolean {
  return CONTAINER_DIR_TYPES.has(node.type)
    ? NOISE_DIR.test(node.name)
    : NOISE_FILE.test(node.name);
}

const CONTAINER_DIR_TYPES = new Set(['Namespace', 'Package']);
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
  /** Carpetas de la cima que se dejaron fuera por ser ruido (ocultas, tests, utilidades). */
  hidden?: number;
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
  /** Hijos que se dejaron fuera por ser ruido (tests, historias, ocultos). */
  childrenHidden?: number;
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

/**
 * Raíz de un repo: sus carpetas de primer nivel — directorios que ningún otro
 * directorio contiene —, no una lista plana de archivos. Se ordenan por nombre;
 * el ruido (ocultas, tests, utilidades) se cuenta aparte y se declara.
 */
export async function buildRepoRoot(
  adapter: LainAdapter,
  repo: string,
  _limit = ROOT_LIMIT,
  opts: { all?: boolean } = {},
): Promise<CodeGraphRepoRoot> {
  const types = [...CONTAINER_DIR_TYPES];
  const everyDir: QueryGraphSpec = {
    ops: [
      { op: 'find', type: types },
      { op: 'limit', count: DIR_FETCH },
    ],
  };
  const innerDirs: QueryGraphSpec = {
    ops: [
      { op: 'find', type: types },
      { op: 'connect', edge: 'Contains', direction: 'outgoing', depth: 1, target: { type: types } },
      { op: 'limit', count: DIR_FETCH },
    ],
  };
  try {
    const [all, inner] = await Promise.all([
      adapter.queryGraph({ query: everyDir, repo_id: repo }),
      adapter.queryGraph({ query: innerDirs, repo_id: repo }),
    ]);
    // Se compara por id del motor: los nombres se repiten (hay muchos "components").
    const contained = new Set(inner.nodes.map((n) => n.id));
    const top = all.nodes.filter((n) => !contained.has(n.id)).map(toCodeNode);
    const shown = opts.all ? top : top.filter((n) => !isNoise(n));
    const seen = new Set<string>();
    const nodes = shown
      .filter((n) => {
        const k = `${n.type}:${n.name}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      repo,
      nodes,
      hidden: top.length - shown.length,
      truncated: all.nodes.length >= DIR_FETCH,
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
  opts: { all?: boolean } = {},
): Promise<GraphRootResult> {
  const out: CodeGraphRepoRoot[] = [];
  for (const repo of repos) {
    out.push(await buildRepoRoot(adapter, repo, limit, opts));
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
  limits: { children?: number; comm?: number; all?: boolean } = {},
): Promise<GraphChildrenResult> {
  const childrenLimit = limits.children ?? CHILDREN_LIMIT;
  const commLimit = limits.comm ?? COMM_LIMIT;

  const containsSpec: QueryGraphSpec = {
    ops: [
      findOps(ref),
      { op: 'connect', edge: 'Contains', direction: 'outgoing', depth: 1 },
      { op: 'limit', count: Math.max(CHILDREN_FETCH, childrenLimit) },
    ],
  };
  const containsRes = await adapter.queryGraph({ query: containsSpec, repo_id: ref.repo });
  // Contains saliente no incluye la semilla, pero se filtra por si el motor
  // cambia de opinión: un nodo no es su propio hijo.
  const own = containsRes.nodes
    .map(toCodeNode)
    .filter((n) => !(n.type === ref.type && n.name === ref.name));
  // Carpetas primero (para orientarse), luego el resto por nombre; el ruido se
  // cuenta y se declara en vez de llenar la lista.
  const visible = limits.all ? own : own.filter((n) => !isNoise(n));
  const ranked = [...visible].sort(
    (a, b) =>
      Number(CONTAINER_DIR_TYPES.has(b.type)) - Number(CONTAINER_DIR_TYPES.has(a.type)) ||
      a.name.localeCompare(b.name),
  );
  const children = ranked.slice(0, childrenLimit);

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
    childrenTruncated:
      ranked.length > childrenLimit ||
      containsRes.nodes.length >= Math.max(CHILDREN_FETCH, childrenLimit),
    childrenHidden: own.length - visible.length,
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

export interface SymbolContextResult {
  symbol: string;
  repo: string;
  path: string | null;
  type: string | null;
  calls: string[];
  calledBy: string[];
  anchorScore?: number | undefined;
  rawText?: string | undefined;
  error?: string | undefined;
}

export interface CallChainResult {
  from: string;
  to: string;
  repo: string;
  chain: string[];
  rawText?: string | undefined;
  error?: string | undefined;
}

export async function resolveSymbolContext(
  adapter: LainAdapter,
  repo: string,
  symbol: string,
): Promise<SymbolContextResult> {
  try {
    const res = await adapter.codeTool('get_context', { symbol, repo_id: repo, depth: 1 });
    const text = res.text;
    const pathMatch = /\*\*Path:\*\*\s*(.+)/.exec(text);
    const typeMatch = /Explanation for '[^']+'\s*\(([^)]+)\)/.exec(text);
    const callsMatch = /-\s+\*\*Calls:\*\*\s*(.+)/.exec(text);
    const calledByMatch = /-\s+\*\*Called by:\*\*\s*(.+)/.exec(text);
    const scoreMatch = /-\s+\*\*Anchor Score:\*\*\s*([\d.]+)/.exec(text);

    const parseList = (m: RegExpExecArray | null): string[] => {
      if (!m?.[1]) return [];
      return m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('('));
    };

    return {
      symbol,
      repo,
      path: pathMatch?.[1]?.trim() ?? null,
      type: typeMatch?.[1]?.trim() ?? null,
      calls: parseList(callsMatch),
      calledBy: parseList(calledByMatch),
      anchorScore: scoreMatch?.[1] ? Number(scoreMatch[1]) : undefined,
      rawText: text,
    };
  } catch (e) {
    return {
      symbol,
      repo,
      path: null,
      type: null,
      calls: [],
      calledBy: [],
      error: e instanceof Error ? e.message : 'get_context failed',
    };
  }
}

export async function resolveCallChain(
  adapter: LainAdapter,
  repo: string,
  from: string,
  to: string,
): Promise<CallChainResult> {
  try {
    const res = await adapter.codeTool('get_call_chain', { from, to, repo_id: repo });
    const text = res.text;
    const arrowLine = text
      .split('\n')
      .find((line) => (line.includes('→') || line.includes('->')) && !line.startsWith('##'));
    const chain = arrowLine
      ? arrowLine
          .split(/→|->/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [from, to];
    return { from, to, repo, chain, rawText: text };
  } catch (e) {
    return {
      from,
      to,
      repo,
      chain: [],
      error: e instanceof Error ? e.message : 'get_call_chain failed',
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
