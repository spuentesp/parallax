// La revisión de CÓDIGO de un PR: de los archivos y diffs que cambia, a los símbolos que toca y a
// cuánto alcanzan (llamadores directos, alcance transitivo, pruebas, riesgo).
//
//   diff del PR ──► líneas cambiadas (numeración BASE) ──► símbolo que las contiene
//        └── search_org(ruta)    definiciones del archivo y su línea
//   símbolo ──► find_symbol(nombre, ruta) ──► id de nodo ──► assess_change(id)
//
// El motor indexa el código TAL COMO ESTABA (no hay parámetro de snapshot en estas herramientas):
// la medida es la del código base, y si el índice no está en el commit base del PR se declara.
// Todo está acotado y lo que se deja fuera se cuenta; ninguna medida se inventa.

import type { CodeImpact, CodeRisk, ImpactedSymbol } from '@parallax/shared/domain';
import type { PrFile } from '../github/reader.js';
import type { LainAdapter } from '../lain-adapter/types.js';
import { changedLines } from './diff.js';
import {
  type FileSymbol,
  lainErrorLine,
  parseAssessChange,
  parseCrossRepoImpact,
  parseFileSymbols,
  parseIndexedCommit,
  parseSymbolCandidates,
  TEST_PATH,
} from './lain-parse.js';

/** Archivos cuyos símbolos se leen del índice. */
export const MAX_FILES = 25;
/** Símbolos a los que se pide `assess_change`. */
export const MAX_SYMBOLS = 10;
const SYMBOLS_PER_FILE_LIMIT = 300;

const CODE_FILE =
  /\.(py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|hpp|swift|scala)$/i;

export interface CodeImpactDeps {
  lain: Pick<LainAdapter, 'codeTool'>;
  /** El id del repo en el motor (no el nombre de pantalla). */
  repoId: string;
  repoName: string;
  files: readonly PrFile[];
  baseSha: string;
  /** El PR tiene más archivos de los que se leyeron. */
  filesTruncated?: boolean;
}

interface Touched {
  symbol: FileSymbol;
  path: string;
  change: 'edited' | 'removed';
}

const RISK_ORDER: Record<CodeRisk, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

export async function reviewCodeImpact(deps: CodeImpactDeps): Promise<CodeImpact> {
  const { lain, repoId, files, baseSha } = deps;
  const gaps: string[] = [];
  const skipped = {
    nonCode: 0,
    tests: 0,
    addedFiles: 0,
    noDiff: 0,
    overFileLimit: 0,
    overSymbolLimit: 0,
  };

  if (deps.filesTruncated) {
    gaps.push('the PR changes more files than were read; the rest are not analyzed');
  }

  // ¿El índice está en el commit del que parte el PR?
  const index: CodeImpact['index'] = { commit: null, matchesBase: null };
  try {
    const caps = await lain.codeTool('get_capabilities', { repo_id: repoId });
    index.commit = parseIndexedCommit(caps.text, repoId);
  } catch {
    index.commit = null;
  }
  if (index.commit === null) {
    gaps.push('could not read which commit the code index was built at');
  } else {
    const indexed = index.commit.toLowerCase();
    const base = baseSha.toLowerCase();
    index.matchesBase = indexed.startsWith(base) || base.startsWith(indexed);
    if (!index.matchesBase) {
      gaps.push(
        `the code index is at ${indexed.slice(0, 7)} and the PR is based on ${base.slice(0, 7)}: the reach below is that of the indexed code, not exactly the PR base`,
      );
    }
  }

  // Qué archivos merecen leerse.
  const candidates: PrFile[] = [];
  for (const f of files) {
    if (!CODE_FILE.test(f.path)) skipped.nonCode++;
    else if (TEST_PATH.test(f.path)) skipped.tests++;
    else if (f.status === 'added') skipped.addedFiles++;
    else if (f.status !== 'removed' && !f.patch) skipped.noDiff++;
    else candidates.push(f);
  }
  const analyzed = candidates.slice(0, MAX_FILES);
  skipped.overFileLimit = candidates.length - analyzed.length;

  // Archivo → símbolos que contienen sus líneas cambiadas.
  const touched: Touched[] = [];
  const moduleScopeFiles: string[] = [];
  let newDefinitions = 0;
  for (const f of analyzed) {
    // El índice conoce la ruta de ANTES si el archivo se renombró.
    const lookup = f.previousPath ?? f.path;
    let table: { symbols: FileSymbol[]; truncated: boolean } | null = null;
    try {
      const res = await lain.codeTool('search_org', {
        query: lookup,
        limit: SYMBOLS_PER_FILE_LIMIT,
      });
      table = parseFileSymbols(res.text, repoId, lookup, SYMBOLS_PER_FILE_LIMIT);
    } catch (e) {
      gaps.push(
        `could not read the symbols of ${f.path}: ${e instanceof Error ? e.message : 'engine error'}`,
      );
      continue;
    }
    if (table === null) {
      gaps.push(`the code index answered ${f.path} in a shape that was not understood`);
      continue;
    }
    if (table.symbols.length === 0) {
      gaps.push(`${f.path} is not in the code index`);
      continue;
    }
    if (table.truncated)
      gaps.push(`${f.path} has more symbols than were read; the list may be incomplete`);

    if (f.status === 'removed') {
      for (const s of table.symbols) touched.push({ symbol: s, path: lookup, change: 'removed' });
      continue;
    }
    const seen = new Set<string>();
    let atModuleScope = false;
    for (const c of changedLines(f.patch)) {
      if (c.startsNewDefinition) {
        newDefinitions++;
        continue;
      }
      // El símbolo cuya definición empieza en la última línea <= la cambiada (el índice no trae
      // el fin de cada símbolo: es una aproximación, y se dice). Ambas numeraciones son desde 1.
      let owner: FileSymbol | null = null;
      for (const s of table.symbols) {
        if (s.line <= c.oldLine) owner = s;
        else break;
      }
      if (c.oldLine === 0 || owner === null) {
        atModuleScope = true;
        continue;
      }
      const key = `${owner.line}:${owner.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      touched.push({ symbol: owner, path: lookup, change: 'edited' });
    }
    if (atModuleScope) moduleScopeFiles.push(f.path);
  }
  if (touched.length > 0) {
    gaps.push(
      'a change is attributed to the nearest preceding definition (the index has no end lines), so a change after the last method of a class may be attributed to that method',
    );
  }

  // Cada símbolo tocado, acotado.
  const measured = touched.slice(0, MAX_SYMBOLS);
  skipped.overSymbolLimit = touched.length - measured.length;
  if (skipped.overSymbolLimit > 0) {
    gaps.push(
      `${skipped.overSymbolLimit} more changed symbol(s) were not measured (limit ${MAX_SYMBOLS})`,
    );
  }
  const symbols: ImpactedSymbol[] = [];
  for (const t of measured) {
    symbols.push(await measure(lain, deps.repoName, repoId, t));
  }

  const highest = symbols.reduce<CodeRisk | null>(
    (acc, s) => (acc === null || RISK_ORDER[s.risk] > RISK_ORDER[acc] ? s.risk : acc),
    null,
  );
  return {
    repo: deps.repoName,
    index,
    filesChanged: files.length,
    filesAnalyzed: analyzed.length,
    symbols,
    newDefinitions,
    moduleScopeFiles,
    skipped,
    gaps,
    highestRisk: highest,
  };
}

/** Un símbolo: id de nodo exacto por ruta (los nombres se repiten) y luego `assess_change`. */
async function measure(
  lain: Pick<LainAdapter, 'codeTool'>,
  repoName: string,
  repoId: string,
  t: Touched,
): Promise<ImpactedSymbol> {
  const base: ImpactedSymbol = {
    name: t.symbol.name,
    kind: t.symbol.kind,
    repo: repoName,
    path: t.path,
    line: t.symbol.line,
    change: t.change,
    direct: null,
    transitive: null,
    risk: 'unknown',
    untested: null,
    dependents: [],
  };
  try {
    const found = await lain.codeTool('find_symbol', {
      name: t.symbol.name,
      repo_id: repoId,
      path_hint: t.path,
    });
    const here = parseSymbolCandidates(found.text).filter((c) => c.path === t.path);
    // Dos herramientas, dos conteos de línea (±1): se elige el más cercano de ESA ruta.
    const node = here.sort(
      (a, b) => Math.abs(a.line - t.symbol.line) - Math.abs(b.line - t.symbol.line),
    )[0];
    if (!node) return { ...base, note: 'not found in the code index at that path' };
    const res = await lain.codeTool('assess_change', {
      symbol: node.id,
      repo_id: repoId,
      limit: 10,
    });
    const error = lainErrorLine(res.text);
    if (error) return { ...base, note: error };
    const impact = parseAssessChange(res.text);
    if (impact.risk === 'unknown') return { ...base, note: 'the engine answer was not understood' };
    const crossRepo = await measureCrossRepo(lain, repoId, t);
    return { ...base, ...impact, ...crossRepo };
  } catch (e) {
    return { ...base, note: e instanceof Error ? e.message : 'engine error' };
  }
}

/** Federation resolves the seed by name and repo, so reject ambiguous or incomplete lookups. */
async function measureCrossRepo(
  lain: Pick<LainAdapter, 'codeTool'>,
  repoId: string,
  t: Touched,
): Promise<Pick<ImpactedSymbol, 'crossRepo' | 'crossRepoNote'>> {
  try {
    const matches = await lain.codeTool('search_org', { query: t.symbol.name, limit: 300 });
    const rows: unknown = JSON.parse(matches.text);
    if (!Array.isArray(rows) || rows.length >= 300) {
      return { crossRepo: null, crossRepoNote: 'cross-repo symbol lookup was incomplete' };
    }
    const exact = rows.filter(
      (row: { repo_id?: unknown; name?: unknown }) =>
        row.repo_id === repoId && row.name === t.symbol.name,
    );
    if (exact.length !== 1 || exact[0]?.path !== t.path) {
      return {
        crossRepo: null,
        crossRepoNote: 'cross-repo lookup cannot uniquely identify this symbol',
      };
    }
    const result = await lain.codeTool('get_cross_repo_blast_radius', {
      symbol: t.symbol.name,
      repo_id: repoId,
      depth: 4,
    });
    const parsed = parseCrossRepoImpact(result.text, repoId);
    if (!parsed)
      return { crossRepo: null, crossRepoNote: 'cross-repo engine answer was not understood' };
    return { crossRepo: parsed };
  } catch (e) {
    return {
      crossRepo: null,
      crossRepoNote: `cross-repo impact unavailable: ${e instanceof Error ? e.message : 'engine error'}`,
    };
  }
}
