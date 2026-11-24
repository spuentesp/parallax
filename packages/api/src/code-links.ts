// Lo que une a un símbolo con el resto: qué archivos cambian junto con él (historia
// de git) y qué otros repos lo alcanzan. Las dos respuestas salen de LAIN
// (`get_coupling_radar`, `get_cross_repo_blast_radius`); aquí sólo se leen.
//
// Un nombre de símbolo no identifica un símbolo: en Saleor `resolve_checkout` está
// en tres archivos. LAIN resuelve por nombre, así que con un nombre repetido
// atribuiría la respuesta a otro símbolo. Por eso aquí NO se responde si el nombre
// no es único en el repo, y se descarta toda respuesta que LAIN marque
// `ambiguous_target`: mejor decir "no se puede atribuir" que enseñar datos de otro.

import type { LainAdapter } from './lain-adapter/types.js';
import { parseSymbolCandidates } from './pr-review/lain-parse.js';

export interface CoChangePartner {
  path: string;
  times: number;
}

export interface SymbolLinksDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  symbol: string;
  repo: string;
  /** Archivo del símbolo, cuando el nombre es único en el repo. */
  path: string | null;
  /** Por qué no hay datos (nombre repetido, no encontrado…). Si está, lo demás es null. */
  note: string | null;
  coChange: {
    /** Socios mostrados (LAIN lista los 10 primeros). */
    partners: CoChangePartner[];
    /** Cuántos socios dice tener LAIN en total. */
    total: number | null;
    /** "none": LAIN no encontró acoplamiento (p. ej. un clon superficial sin historia). */
    status: 'found' | 'none';
  } | null;
  crossRepo: {
    repositories: Array<{ repo: string; leaves: string[] }>;
    truncated: boolean;
  } | null;
  /** Por qué no hay dato de otros repos aunque el símbolo sea único. */
  crossRepoNote: string | null;
}

/** `get_coupling_radar`: "Files that co-change with 'X' (path) — top N partners:\n1. p (changed together K times)". */
export function parseCouplingRadar(text: string): SymbolLinksDto['coChange'] {
  if (/No co-change coupling found/i.test(text))
    return { partners: [], total: null, status: 'none' };
  const head = /top\s+(\d+)\s+partners/i.exec(text);
  const partners: CoChangePartner[] = [];
  for (const m of text.matchAll(/^\s*\d+\.\s+(.+?)\s+\(changed together (\d+) times?\)\s*$/gm)) {
    partners.push({ path: m[1] as string, times: Number(m[2]) });
  }
  if (!head && partners.length === 0) return null;
  return { partners, total: head ? Number(head[1]) : null, status: 'found' };
}

/** `get_cross_repo_blast_radius`: JSON con `by_repo`, `truncated` y `answer_scope`. */
export function parseCrossRepo(
  text: string,
  sourceRepo: string,
): { crossRepo: SymbolLinksDto['crossRepo']; note: string | null } {
  try {
    const data = JSON.parse(text) as {
      by_repo?: Record<string, unknown>;
      truncated?: unknown;
      answer_scope?: unknown;
    };
    if (data.answer_scope === 'ambiguous_target') {
      return {
        crossRepo: null,
        note: 'the engine could not tell which symbol this is, so it will not say who reaches it',
      };
    }
    if (!data.by_repo || typeof data.by_repo !== 'object' || typeof data.truncated !== 'boolean') {
      return { crossRepo: null, note: 'the engine answer was not understood' };
    }
    const repositories: Array<{ repo: string; leaves: string[] }> = [];
    for (const [repo, leaves] of Object.entries(data.by_repo)) {
      if (!Array.isArray(leaves) || !leaves.every((l) => typeof l === 'string')) {
        return { crossRepo: null, note: 'the engine answer was not understood' };
      }
      if (repo !== sourceRepo && leaves.length > 0) {
        repositories.push({ repo, leaves: leaves as string[] });
      }
    }
    return { crossRepo: { repositories, truncated: data.truncated }, note: null };
  } catch {
    return { crossRepo: null, note: 'the engine answer was not understood' };
  }
}

export async function resolveSymbolLinks(
  adapter: Pick<LainAdapter, 'codeTool'>,
  repo: string,
  symbol: string,
): Promise<SymbolLinksDto> {
  const base: SymbolLinksDto = {
    source: 'lain',
    symbol,
    repo,
    path: null,
    note: null,
    coChange: null,
    crossRepo: null,
    crossRepoNote: null,
  };
  // find_symbol busca por nombre EXACTO en el repo y dice cuántos hay ("Found 8
  // matches"); search_org compara por subcadena y se desborda con nombres comunes.
  const found = await adapter.codeTool('find_symbol', { name: symbol, repo_id: repo });
  if (/^\s*No matches/im.test(found.text)) return { ...base, note: 'not found in the code index' };
  const candidates = parseSymbolCandidates(found.text);
  const counted = /Found\s+(\d+)\s+matches/i.exec(found.text);
  const count = counted ? Number(counted[1]) : candidates.length;
  if (count === 0 || candidates.length === 0) {
    return { ...base, note: 'the engine lookup was not understood' };
  }
  if (count > 1) {
    const where = candidates
      .slice(0, 3)
      .map((c) => c.path)
      .join(', ');
    return {
      ...base,
      note: `${count} symbols in this repo are named "${symbol}" (${where}${
        count > 3 ? ', …' : ''
      }), and the map node does not say which one this is`,
    };
  }
  const path = candidates[0]?.path ?? null;

  const [radar, cross] = await Promise.all([
    adapter.codeTool('get_coupling_radar', { symbol, repo_id: repo }),
    adapter.codeTool('get_cross_repo_blast_radius', { symbol, repo_id: repo, depth: 3 }),
  ]);
  const crossParsed = parseCrossRepo(cross.text, repo);
  return {
    ...base,
    path,
    coChange: parseCouplingRadar(radar.text),
    crossRepo: crossParsed.crossRepo,
    crossRepoNote: crossParsed.note,
  };
}
