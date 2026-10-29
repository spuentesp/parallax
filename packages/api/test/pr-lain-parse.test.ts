// Los parsers de lo que LAIN contesta, contra salidas reales capturadas (fixtures).

import { describe, expect, it } from 'vitest';
import {
  lainErrorLine,
  parseAssessChange,
  parseFileSymbols,
  parseIndexedCommit,
  parseSymbolCandidates,
} from '../src/pr-review/lain-parse.js';
import {
  ASSESS_MEDIUM,
  ASSESS_NOT_FOUND,
  ASSESS_TESTS_CALL_BUT_SAYS_UNTESTED,
  ASSESS_UNTESTED_HIGH,
  CAPABILITIES,
  FIND_SYMBOL_AMBIGUOUS,
  FIND_SYMBOL_UNIQUE,
  SEARCH_ORG_FILE,
} from './fixtures/lain-code-outputs.js';

describe('parseFileSymbols (search_org por ruta)', () => {
  it('keeps only the definitions of THAT file in THAT repo, ordered by line', () => {
    const r = parseFileSymbols(SEARCH_ORG_FILE, 'saleor', 'saleor/warehouse/lock_objects.py', 200);
    expect(r?.symbols).toEqual([
      // Las líneas del archivo real (desde 1): 4, 8 y 12. El id global las cuenta desde 0.
      { name: 'stock_select_for_update_for_existing_qs', kind: 'function', line: 4 },
      { name: 'stock_qs_select_for_update', kind: 'function', line: 8 },
      { name: 'allocation_with_stock_qs_select_for_update', kind: 'function', line: 12 },
    ]);
    expect(r?.truncated).toBe(false);
  });

  it('declares a result that hit the requested limit as truncated', () => {
    const r = parseFileSymbols(SEARCH_ORG_FILE, 'saleor', 'saleor/warehouse/lock_objects.py', 5);
    expect(r?.truncated).toBe(true);
  });

  it('a repo that does not own the path yields no symbols, and non-JSON is null (not invented)', () => {
    expect(
      parseFileSymbols(SEARCH_ORG_FILE, 'storefront', 'saleor/warehouse/lock_objects.py', 200)
        ?.symbols,
    ).toEqual([]);
    expect(parseFileSymbols('not json', 'saleor', 'x', 10)).toBeNull();
  });
});

describe('parseSymbolCandidates (find_symbol)', () => {
  it('reads the node id, kind and path:line of every candidate', () => {
    expect(parseSymbolCandidates(FIND_SYMBOL_UNIQUE)).toEqual([
      {
        id: '31f53657-7bd5-5f8d-b28b-99cdd7bdbd1e',
        kind: 'function',
        path: 'saleor/warehouse/lock_objects.py',
        line: 8,
      },
    ]);
    const many = parseSymbolCandidates(FIND_SYMBOL_AMBIGUOUS);
    expect(many.map((c) => [c.path, c.kind])).toEqual([
      ['saleor/warehouse/management.py', 'function'],
      ['saleor/warehouse/models.py', 'method'],
    ]);
  });
});

describe('parseAssessChange', () => {
  it('reads the counts, the verdict, untested-ness and the first callers', () => {
    const r = parseAssessChange(ASSESS_UNTESTED_HIGH);
    expect(r).toMatchObject({ direct: 6, transitive: 87, risk: 'high', untested: true });
    expect(r.dependents).toHaveLength(6);
    expect(r.dependents[0]).toEqual({
      name: 'get_stocks',
      path: 'saleor/graphql/warehouse/bulk_mutations/stock_bulk_update.py',
    });
    expect(parseAssessChange(ASSESS_MEDIUM)).toMatchObject({
      direct: 1,
      transitive: 1,
      risk: 'medium',
    });
  });

  it('does not repeat "no test calls it" when its own caller list includes tests, and lists real callers first', () => {
    const r = parseAssessChange(ASSESS_TESTS_CALL_BUT_SAYS_UNTESTED);
    expect(r.untested).toBe(false);
    expect(r.direct).toBe(4);
    expect(r.dependents.map((d) => d.name)).toEqual([
      '_create_fulfillment_lines',
      'fulfill_order_lines',
    ]);
  });

  it('what it cannot read stays unknown instead of being guessed', () => {
    expect(parseAssessChange('something else entirely')).toEqual({
      direct: null,
      transitive: null,
      risk: 'unknown',
      untested: null,
      dependents: [],
    });
  });
});

describe('errors and capabilities', () => {
  it('turns a LAIN error into one sentence, and leaves normal answers alone', () => {
    expect(lainErrorLine(ASSESS_NOT_FOUND)).toMatch(/^Not found: Node not found for handle/);
    expect(lainErrorLine(ASSESS_MEDIUM)).toBeNull();
  });

  it('reads the commit a repo was indexed at', () => {
    expect(parseIndexedCommit(CAPABILITIES, 'saleor')).toBe(
      '487885d437feed94922cdbdf16a76552c120b550',
    );
    expect(parseIndexedCommit(CAPABILITIES, 'nope')).toBeNull();
    expect(parseIndexedCommit('garbage', 'saleor')).toBeNull();
  });
});
