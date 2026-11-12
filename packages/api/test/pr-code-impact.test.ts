// La revisión de código de un PR, con el motor sustituido en su borde (codeTool) por respuestas
// reales capturadas. Lo que se prueba es la composición: diff → símbolo → id de nodo → medida, y
// que todo lo que se deja fuera se declara.

import { describe, expect, it } from 'vitest';
import type { PrFile } from '../src/github/reader.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { MAX_SYMBOLS, reviewCodeImpact } from '../src/pr-review/code-impact.js';
import {
  ASSESS_MEDIUM,
  ASSESS_NOT_FOUND,
  ASSESS_UNTESTED_HIGH,
  CAPABILITIES,
  FIND_SYMBOL_AMBIGUOUS,
  FIND_SYMBOL_UNIQUE,
  SEARCH_ORG_FILE,
} from './fixtures/lain-code-outputs.js';

const BASE = '487885d437feed94922cdbdf16a76552c120b550';
const PATH = 'saleor/warehouse/lock_objects.py';

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

/** Un motor que responde como LAIN a las cuatro preguntas de la revisión. */
function engine(over: Partial<Record<string, (args: Record<string, unknown>) => string>> = {}) {
  const calls: Call[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => string> = {
    get_capabilities: () => CAPABILITIES,
    search_org: () => SEARCH_ORG_FILE,
    find_symbol: () => FIND_SYMBOL_UNIQUE,
    assess_change: () => ASSESS_UNTESTED_HIGH,
    get_cross_repo_blast_radius: () =>
      JSON.stringify({
        by_repo: {
          saleor: ['saleor:Function:a.py:local:1'],
          storefront: ['storefront:Function:cart.ts:checkout:2'],
        },
        total_count: 2,
        truncated: false,
      }),
    ...over,
  };
  const lain = {
    async codeTool(tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      const h = handlers[tool];
      if (!h) throw new Error(`unexpected tool ${tool}`);
      return { text: h(args) };
    },
  } as unknown as Pick<LainAdapter, 'codeTool'>;
  return { lain, calls };
}

// Cambia el cuerpo de stock_qs_select_for_update (def en la línea 8 del archivo real).
const EDIT_BODY = [
  '@@ -8,3 +8,3 @@ def stock_qs_select_for_update():',
  ' def stock_qs_select_for_update():',
  '-    return 1',
  '+    return 2',
  ' ',
].join('\n');

const file = (over: {
  path: string;
  status?: string;
  patch?: string | undefined;
  previousPath?: string;
}): PrFile => {
  const patch = 'patch' in over ? over.patch : EDIT_BODY;
  return {
    path: over.path,
    status: over.status ?? 'modified',
    additions: 1,
    deletions: 1,
    ...(patch !== undefined ? { patch } : {}),
    ...(over.previousPath ? { previousPath: over.previousPath } : {}),
  };
};

const review = (files: PrFile[], lain: Pick<LainAdapter, 'codeTool'>, extra: object = {}) =>
  reviewCodeImpact({ lain, repoId: 'saleor', repoName: 'saleor', files, baseSha: BASE, ...extra });

describe('reviewCodeImpact', () => {
  it('maps an edit inside a function to that function, asks the engine by NODE ID, and reports its reach', async () => {
    const { lain, calls } = engine();
    const r = await review([file({ path: PATH })], lain);
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0]).toMatchObject({
      name: 'stock_qs_select_for_update',
      path: PATH,
      change: 'edited',
      direct: 6,
      transitive: 87,
      risk: 'high',
      untested: true,
    });
    expect(r.highestRisk).toBe('high');
    expect(r.symbols[0]?.crossRepo).toEqual({
      repositories: [{ repo: 'storefront', leaves: ['storefront:Function:cart.ts:checkout:2'] }],
      truncated: false,
    });
    expect(calls.find((c) => c.tool === 'get_cross_repo_blast_radius')?.args).toMatchObject({
      symbol: 'stock_qs_select_for_update',
      repo_id: 'saleor',
      depth: 4,
    });
    // assess_change recibe el id del nodo, no el nombre (los nombres se repiten entre archivos).
    const assess = calls.find((c) => c.tool === 'assess_change');
    expect(assess?.args).toMatchObject({
      symbol: '31f53657-7bd5-5f8d-b28b-99cdd7bdbd1e',
      repo_id: 'saleor',
    });
    expect(calls.find((c) => c.tool === 'find_symbol')?.args).toMatchObject({
      name: 'stock_qs_select_for_update',
      path_hint: PATH,
    });
  });

  it("picks the node at THE FILE's path when a name is defined in several files", async () => {
    const { lain, calls } = engine({
      find_symbol: () => FIND_SYMBOL_AMBIGUOUS,
      search_org: (args) =>
        JSON.stringify([
          {
            global_id: 'saleor:Function:saleor/warehouse/models.py:decrease_stock:546',
            kind: 'Function',
            name: 'decrease_stock',
            path: 'saleor/warehouse/models.py',
            repo_id: 'saleor',
          },
          ...(args.query === 'decrease_stock'
            ? [
                {
                  global_id: 'saleor:Function:saleor/other.py:decrease_stock:10',
                  kind: 'Function',
                  name: 'decrease_stock',
                  path: 'saleor/other.py',
                  repo_id: 'saleor',
                },
              ]
            : []),
        ]),
    });
    const patch = ['@@ -547,2 +547,2 @@', ' def decrease_stock(self):', '-    a', '+    b'].join(
      '\n',
    );
    await review([file({ path: 'saleor/warehouse/models.py', patch })], lain);
    expect(calls.find((c) => c.tool === 'assess_change')?.args.symbol).toBe(
      '005bde1b-f4d4-53a1-9894-77d79be1a139',
    );
    expect(calls.some((c) => c.tool === 'get_cross_repo_blast_radius')).toBe(false);
  });

  it('declares truncated federated traversals and unavailable results', async () => {
    const truncated = engine({
      get_cross_repo_blast_radius: () =>
        JSON.stringify({
          by_repo: { storefront: ['storefront:Function:cart.ts:checkout:2'] },
          total_count: 1,
          truncated: true,
        }),
    });
    const result = await review([file({ path: PATH })], truncated.lain);
    expect(result.symbols[0]?.crossRepo?.truncated).toBe(true);
    const unavailable = engine({
      get_cross_repo_blast_radius: () => 'Error: federation unavailable',
    });
    const failed = await review([file({ path: PATH })], unavailable.lain);
    expect(failed.symbols[0]).toMatchObject({
      risk: 'high',
      crossRepo: null,
      crossRepoNote: 'cross-repo engine answer was not understood',
    });
  });

  it('does not attribute a newly added definition to the symbol next to it', async () => {
    const { lain } = engine();
    const patch = ['@@ -12,1 +12,4 @@', ' end', '+def brand_new():', '+    return 1'].join('\n');
    const r = await review([file({ path: PATH, patch })], lain);
    expect(r.symbols).toHaveLength(0);
    expect(r.newDefinitions).toBe(1);
  });

  it('a change before any definition is module scope, not a symbol', async () => {
    const { lain } = engine();
    const patch = ['@@ -1,2 +1,3 @@', '+import os', ' a', ' b'].join('\n');
    const r = await review([file({ path: PATH, patch })], lain);
    expect(r.symbols).toHaveLength(0);
    expect(r.moduleScopeFiles).toEqual([PATH]);
  });

  it('counts what it does not read: non-code, tests, added files, files without a diff', async () => {
    const { lain, calls } = engine();
    const r = await review(
      [
        file({ path: 'README.md' }),
        file({ path: 'saleor/warehouse/tests/test_stock.py' }),
        file({ path: 'saleor/new_feature.py', status: 'added' }),
        file({ path: 'saleor/huge_generated.py', patch: undefined }),
        file({ path: PATH }),
      ],
      lain,
    );
    expect(r.skipped).toMatchObject({ nonCode: 1, tests: 1, addedFiles: 1, noDiff: 1 });
    expect(r.filesChanged).toBe(5);
    expect(r.filesAnalyzed).toBe(1);
    expect(calls.filter((c) => c.tool === 'search_org' && c.args.query === PATH)).toHaveLength(1);
  });

  it('declares an index that is not at the PR base commit, and stays quiet when it is', async () => {
    const stale = engine({
      get_capabilities: () =>
        JSON.stringify({ repositories: [{ id: 'saleor', last_indexed_commit: 'c'.repeat(40) }] }),
    });
    const a = await reviewCodeImpact({
      lain: stale.lain,
      repoId: 'saleor',
      repoName: 'saleor',
      files: [file({ path: PATH })],
      baseSha: BASE,
    });
    expect(a.index).toEqual({ commit: 'c'.repeat(40), matchesBase: false });
    expect(a.gaps.join('\n')).toMatch(/code index is at ccccccc and the PR is based on 487885d/);

    const fresh = await review([file({ path: PATH })], engine().lain);
    expect(fresh.index).toEqual({ commit: BASE, matchesBase: true });
    expect(fresh.gaps.join('\n')).not.toMatch(/code index is at/);
  });

  it('measures at most MAX_SYMBOLS and declares the rest', async () => {
    const many = JSON.stringify(
      Array.from({ length: 14 }, (_, i) => ({
        global_id: `saleor:Function:${PATH}:f${String(i)}:${String(i * 10)}`,
        kind: 'Function',
        name: `f${String(i)}`,
        path: PATH,
        repo_id: 'saleor',
      })),
    );
    const { lain, calls } = engine({ search_org: () => many });
    // Un hunk por función: toca las 14.
    const patch = Array.from(
      { length: 14 },
      (_, i) => `@@ -${String(i * 10 + 2)},1 +${String(i * 10 + 2)},1 @@\n-a\n+b`,
    ).join('\n');
    const r = await review([file({ path: PATH, patch })], lain);
    expect(r.symbols).toHaveLength(MAX_SYMBOLS);
    expect(r.skipped.overSymbolLimit).toBe(14 - MAX_SYMBOLS);
    expect(calls.filter((c) => c.tool === 'assess_change')).toHaveLength(MAX_SYMBOLS);
    expect(r.gaps.join('\n')).toMatch(/4 more changed symbol\(s\) were not measured/);
  });

  it('a symbol the engine does not know keeps its place with a reason, never a made-up measure', async () => {
    const { lain } = engine({ assess_change: () => ASSESS_NOT_FOUND });
    const r = await review([file({ path: PATH })], lain);
    expect(r.symbols[0]).toMatchObject({ risk: 'unknown', direct: null, transitive: null });
    expect(r.symbols[0]?.note).toMatch(/Not found/);
    expect(r.highestRisk).toBe('unknown');
  });

  it('an engine failure on one file is a gap, and the other files are still read', async () => {
    let n = 0;
    const { lain } = engine({
      search_org: () => {
        n++;
        if (n === 1) throw new Error('engine down');
        return SEARCH_ORG_FILE;
      },
    });
    const r = await review([file({ path: 'saleor/a.py' }), file({ path: PATH })], lain);
    expect(r.gaps.join('\n')).toMatch(/could not read the symbols of saleor\/a\.py: engine down/);
    expect(r.symbols).toHaveLength(1);
  });

  it('a removed file touches every symbol it defined, as removed', async () => {
    const { lain } = engine({ assess_change: () => ASSESS_MEDIUM });
    const r = await review([file({ path: PATH, status: 'removed', patch: undefined })], lain);
    expect(r.symbols).toHaveLength(3);
    expect(r.symbols.every((s) => s.change === 'removed')).toBe(true);
  });

  it('uses the previous path of a renamed file, which is the one the index knows', async () => {
    const { lain, calls } = engine();
    await review(
      [file({ path: 'saleor/warehouse/renamed_lock.py', previousPath: PATH, status: 'renamed' })],
      lain,
    );
    expect(calls.find((c) => c.tool === 'search_org')?.args.query).toBe(PATH);
  });

  it('declares a PR that has more files than were read', async () => {
    const r = await review([file({ path: PATH })], engine().lain, { filesTruncated: true });
    expect(r.gaps.join('\n')).toMatch(/more files than were read/);
  });
});
