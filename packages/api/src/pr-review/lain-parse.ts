// Lectura de lo que LAIN contesta a la revisión de un PR. Las herramientas de código devuelven
// texto (o JSON en texto) pensado para un humano: aquí se extrae lo estructurado con patrones
// CONSERVADORES. Lo que no se reconoce no se inventa: queda `unknown` y el texto crudo.

export interface FileSymbol {
  name: string;
  kind: string;
  /** Línea (desde 1) en que empieza la definición, igual que en un diff y que en `find_symbol`. */
  line: number;
}

/** Tipos de nodo que son una definición con cuerpo: lo que "contiene" un cambio. */
const DEFINITION_KINDS = new Set([
  'function',
  'method',
  'class',
  'struct',
  'interface',
  'trait',
  'enum',
]);

/**
 * `search_org` con la ruta de un archivo: sus símbolos, cada uno con el id global
 * `repo:Tipo:ruta:nombre:línea`. Devuelve sólo las definiciones de ESE archivo en ESE repo.
 * `truncated` si el motor llegó al tope pedido (puede haber más).
 */
export function parseFileSymbols(
  text: string,
  repoId: string,
  path: string,
  limit: number,
): { symbols: FileSymbol[]; truncated: boolean } | null {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const symbols: FileSymbol[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (r.repo_id !== repoId || r.path !== path) continue;
    const kind = String(r.kind ?? '').toLowerCase();
    if (!DEFINITION_KINDS.has(kind)) continue;
    const id = String(r.global_id ?? '');
    // El id global cuenta las líneas desde 0 (comprobado contra el archivo real): se normaliza a
    // desde 1, que es lo que usan el diff de GitHub y `find_symbol`.
    const line = Number(id.slice(id.lastIndexOf(':') + 1)) + 1;
    if (!Number.isFinite(line) || typeof r.name !== 'string') continue;
    symbols.push({ name: r.name, kind, line });
  }
  symbols.sort((a, b) => a.line - b.line);
  return { symbols, truncated: rows.length >= limit };
}

export interface SymbolCandidate {
  id: string;
  kind: string;
  path: string;
  line: number;
}

/** `find_symbol`: los candidatos con su id de nodo (UUID), tipo y ruta:línea. */
export function parseSymbolCandidates(text: string): SymbolCandidate[] {
  const out: SymbolCandidate[] = [];
  for (const m of text.matchAll(/^\d+\.\s+`([0-9a-f-]{36})`\s+(\w+)\s+(\S+?):(\d+)/gm)) {
    out.push({
      id: m[1] as string,
      kind: (m[2] as string).toLowerCase(),
      path: m[3] as string,
      line: Number(m[4]),
    });
  }
  return out;
}

export type Risk = 'low' | 'medium' | 'high' | 'unknown';

export interface Dependent {
  name: string;
  path: string;
}

export interface SymbolImpact {
  direct: number | null;
  transitive: number | null;
  risk: Risk;
  /** Ninguna prueba llega al símbolo, ni directa ni por sus llamadores (null = no se supo). */
  untested: boolean | null;
  /** Los primeros llamadores directos, para mostrarlos. */
  dependents: Dependent[];
}

const MAX_DEPENDENTS = 6;

/** Una ruta de pruebas: lo que llama a un símbolo desde ahí es una prueba que lo ejerce. */
export const TEST_PATH =
  /(^|\/)(tests?|__tests__|specs?|e2e|testUtils|fixtures)\/|(\.|_)(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/i;

/** `assess_change`: dependientes directos y transitivos, pruebas y el veredicto de riesgo. */
export function parseAssessChange(text: string): SymbolImpact {
  const verdict =
    /Direct:\s*(\d+);\s*transitive:\s*(\d+);\s*verdict:\s*\*\*(low|medium|high)\*\*/i.exec(text);
  const dependents: Dependent[] = [];
  let testCallers = 0;
  for (const m of text.matchAll(/^- \*\*([^*]+)\*\* \(([^)]+)\) calls it at line \d+/gm)) {
    const path = (m[2] as string).trim();
    if (TEST_PATH.test(path)) testCallers++;
    // Se muestran primero los llamadores que NO son pruebas: son los que importan al revisar.
    else if (dependents.length < MAX_DEPENDENTS)
      dependents.push({ name: (m[1] as string).trim(), path });
  }
  // El motor dice "ninguna prueba llega aquí" aun cuando su propia lista de llamadores incluye
  // pruebas (visto en Saleor: decrease_stock): si un llamador directo vive en una ruta de
  // pruebas, el símbolo SÍ está probado, y no se repite la afirmación contradicha.
  const untested =
    testCallers > 0
      ? false
      : /No test calls this symbol/i.test(text)
        ? true
        : /## Test coverage/i.test(text)
          ? false
          : null;
  return {
    direct: verdict ? Number(verdict[1]) : null,
    transitive: verdict ? Number(verdict[2]) : null,
    risk: verdict ? ((verdict[3] as string).toLowerCase() as Risk) : 'unknown',
    untested,
    dependents,
  };
}

/** Un error de LAIN para un símbolo, en una frase para el informe. */
export function lainErrorLine(text: string): string | null {
  if (!/^\s*Error:/i.test(text)) return null;
  return (
    text
      .replace(/^\s*Error:\s*/i, '')
      .split('\n')[0]
      ?.slice(0, 200) ?? null
  );
}

/** `get_capabilities`: el commit que el índice de un repo tiene indexado. */
export function parseIndexedCommit(text: string, repoId: string): string | null {
  try {
    const j = JSON.parse(text) as {
      repositories?: Array<{ id?: string; last_indexed_commit?: string }>;
    };
    const repo = j.repositories?.find((r) => r.id === repoId);
    return typeof repo?.last_indexed_commit === 'string' && repo.last_indexed_commit !== ''
      ? repo.last_indexed_commit
      : null;
  } catch {
    return null;
  }
}
