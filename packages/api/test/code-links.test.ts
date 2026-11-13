import { describe, expect, it } from 'vitest';
import { parseCouplingRadar, parseCrossRepo, resolveSymbolLinks } from '../src/code-links.js';

// Textos literales de LAIN 0.15.0 (ver docs): el repo de Parallax (con historia) y
// Saleor (clon superficial, sin ella). No se prueba contra una forma supuesta.
const RADAR_REAL = `Files that co-change with 'MapExplorer' (packages/web/src/map/MapExplorer.tsx) — top 45 partners:
1. packages/web/src/api/hooks.ts (changed together 6 times)
2. packages/web/src/map/MapCanvas.tsx (changed together 6 times)
3. packages/web/src/components/AppShell.tsx (changed together 5 times)
4. packages/shared/src/org-map/index.ts (changed together 1 time)

[Interactive coupling: http://localhost:9966/ui/coupling/6370f664-eb05-4e39-83f1-9173c7766f9a]
Click cells to see co-change details, then describe your selection to the agent.`;
const RADAR_NONE =
  "No co-change coupling found for 'perform_mutation' (saleor/graphql/account/bulk_mutations/customer_bulk_delete.py)";

describe('parseCouplingRadar', () => {
  it('reads the partners with how many times they changed together, and the engine total', () => {
    const r = parseCouplingRadar(RADAR_REAL);
    expect(r).toMatchObject({ status: 'found', total: 45 });
    expect(r?.partners).toHaveLength(4);
    expect(r?.partners[0]).toEqual({ path: 'packages/web/src/api/hooks.ts', times: 6 });
    // "1 time" en singular también.
    expect(r?.partners[3]).toEqual({ path: 'packages/shared/src/org-map/index.ts', times: 1 });
  });
  it('says "none" when the engine finds no coupling (e.g. a shallow clone), not an empty success', () => {
    expect(parseCouplingRadar(RADAR_NONE)).toEqual({ partners: [], total: null, status: 'none' });
  });
  it('returns null for something it does not understand', () => {
    expect(parseCouplingRadar('Error: tool failed')).toBeNull();
  });
});

describe('parseCrossRepo', () => {
  it('keeps only other repos, with their leaves and the truncation flag', () => {
    const r = parseCrossRepo(
      JSON.stringify({
        answer_scope: 'complete',
        by_repo: {
          saleor: ['saleor:Function:a.py:f:1'],
          storefront: ['storefront:File:b.ts:b.ts:0'],
        },
        total_count: 2,
        truncated: false,
      }),
      'saleor',
    );
    expect(r.note).toBeNull();
    expect(r.crossRepo).toEqual({
      repositories: [{ repo: 'storefront', leaves: ['storefront:File:b.ts:b.ts:0'] }],
      truncated: false,
    });
  });
  it('discards an answer the engine marks ambiguous_target: it belongs to some other symbol', () => {
    const r = parseCrossRepo(
      JSON.stringify({
        answer_scope: 'ambiguous_target',
        by_repo: { x: ['x:File:t.rs:t:0'] },
        truncated: true,
      }),
      'nemo-fabric',
    );
    expect(r.crossRepo).toBeNull();
    expect(r.note).toMatch(/could not tell which symbol/);
  });
  it('an empty reach is a real answer: no other repo reaches it', () => {
    const r = parseCrossRepo(
      JSON.stringify({ answer_scope: 'complete', by_repo: {}, total_count: 0, truncated: false }),
      'saleor',
    );
    expect(r.crossRepo).toEqual({ repositories: [], truncated: false });
  });
  it('garbage is reported as not understood', () => {
    expect(parseCrossRepo('nope', 'a').note).toMatch(/not understood/);
  });
});

// find_symbol de LAIN 0.15.0, literal: único / repetido / sin resultados.
const FIND_ONE = `## find_symbol: MapExplorer

Use this: \`0b374e8a-c683-53cf-96db-470c32ee9e6d\`  (path=\`web/MapExplorer.tsx\`, type=function)

1. \`0b374e8a-c683-53cf-96db-470c32ee9e6d\` function web/MapExplorer.tsx:99 anchor=0.49
`;
const FIND_MANY = `## find_symbol: resolve_checkout

Found 8 matches. Disambiguate with the \`path_hint\` argument:

1. \`d34aa24c-919d-5fe9-819a-e2a4a045495f\` function saleor/graphql/checkout/resolvers.py:36 anchor=0.86
2. \`b07e9caf-a82a-5c05-83cf-3c6f7c98d44f\` function saleor/graphql/account/types.py:660 anchor=0.18
3. \`3dd5ef86-fb16-5dbd-a438-5dc2f032289d\` function saleor/graphql/payment/types.py:847 anchor=0.18
4. \`60a2d089-5fca-57c5-8cf4-acbc2003a73b\` function saleor/graphql/payment/types.py:311 anchor=0.18
`;
const FIND_NONE = `## find_symbol: nonexistent_zzz

No matches.

Try a broader name, drop \`path_hint\`, or use \`query_graph\` with a \`find\` op for a structural search.`;

describe('resolveSymbolLinks', () => {
  const adapter = (
    find: string,
    radar = RADAR_REAL,
    cross = '{"by_repo":{},"truncated":false}',
  ) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const a = {
      codeTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          text: name === 'find_symbol' ? find : name === 'get_coupling_radar' ? radar : cross,
        };
      },
    } as unknown as Parameters<typeof resolveSymbolLinks>[0];
    return { a, calls };
  };

  it('a unique symbol gets co-change and cross-repo, asked with the repo pinned', async () => {
    const { a, calls } = adapter(FIND_ONE);
    const r = await resolveSymbolLinks(a, 'p', 'MapExplorer');
    expect(r.note).toBeNull();
    expect(r.path).toBe('web/MapExplorer.tsx');
    expect(r.coChange?.partners[0]?.path).toBe('packages/web/src/api/hooks.ts');
    expect(r.crossRepo).toEqual({ repositories: [], truncated: false });
    // Sin `repo_id` LAIN elegiría por su cuenta (visto: perform_mutation → otro archivo).
    expect(calls.find((c) => c.name === 'find_symbol')?.args).toEqual({
      name: 'MapExplorer',
      repo_id: 'p',
    });
    expect(calls.find((c) => c.name === 'get_coupling_radar')?.args).toEqual({
      symbol: 'MapExplorer',
      repo_id: 'p',
    });
  });

  it('a name used by several symbols is NOT answered: nothing is attributed to the wrong one', async () => {
    const { a, calls } = adapter(FIND_MANY);
    const r = await resolveSymbolLinks(a, 'p', 'resolve_checkout');
    expect(r.note).toMatch(/8 symbols in this repo are named "resolve_checkout"/);
    expect(r.note).toMatch(/saleor\/graphql\/checkout\/resolvers\.py/);
    expect(r.note).toMatch(/does not say which one/);
    expect(r.coChange).toBeNull();
    expect(r.crossRepo).toBeNull();
    // Ni siquiera se le pregunta al motor por el acoplamiento.
    expect(calls.map((c) => c.name)).toEqual(['find_symbol']);
  });

  it('says when the engine does not know the symbol, and when it answers something unreadable', async () => {
    expect((await resolveSymbolLinks(adapter(FIND_NONE).a, 'p', 'x')).note).toBe(
      'not found in the code index',
    );
    expect((await resolveSymbolLinks(adapter('Error: boom').a, 'p', 'x')).note).toMatch(
      /not understood/,
    );
  });
});
