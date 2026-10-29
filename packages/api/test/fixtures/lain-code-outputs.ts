// Salidas REALES de LAIN 0.13 sobre Saleor (3 repos), capturadas con sonda directa el
// 2026-10-29: los parsers se prueban contra lo que el motor contesta de verdad, no contra
// lo que imaginamos que contesta.

export const SEARCH_ORG_FILE = JSON.stringify([
  {
    global_id:
      'saleor:Function:saleor/warehouse/lock_objects.py:allocation_with_stock_qs_select_for_update:11',
    kind: 'Function',
    name: 'allocation_with_stock_qs_select_for_update',
    path: 'saleor/warehouse/lock_objects.py',
    repo_id: 'saleor',
  },
  {
    global_id: 'saleor:File:saleor/warehouse/lock_objects.py:lock_objects.py:0',
    kind: 'File',
    name: 'lock_objects.py',
    path: 'saleor/warehouse/lock_objects.py',
    repo_id: 'saleor',
  },
  {
    global_id: 'saleor:Function:saleor/warehouse/lock_objects.py:stock_qs_select_for_update:7',
    kind: 'Function',
    name: 'stock_qs_select_for_update',
    path: 'saleor/warehouse/lock_objects.py',
    repo_id: 'saleor',
  },
  {
    global_id:
      'saleor:Function:saleor/warehouse/lock_objects.py:stock_select_for_update_for_existing_qs:3',
    kind: 'Function',
    name: 'stock_select_for_update_for_existing_qs',
    path: 'saleor/warehouse/lock_objects.py',
    repo_id: 'saleor',
  },
  // Otro archivo con un nombre parecido en el mismo repo: no es de este archivo.
  {
    global_id: 'saleor:Function:saleor/order/lock_objects.py:order_qs_select_for_update:6',
    kind: 'Function',
    name: 'order_qs_select_for_update',
    path: 'saleor/order/lock_objects.py',
    repo_id: 'saleor',
  },
]);

export const FIND_SYMBOL_UNIQUE = `## find_symbol: stock_qs_select_for_update

Use this: \`31f53657-7bd5-5f8d-b28b-99cdd7bdbd1e\`  (path=\`saleor/warehouse/lock_objects.py\`, type=function)

1. \`31f53657-7bd5-5f8d-b28b-99cdd7bdbd1e\` function saleor/warehouse/lock_objects.py:8 anchor=0.55
`;

export const FIND_SYMBOL_AMBIGUOUS = `## find_symbol: decrease_stock

Use this: \`637f9baa-8ef1-5e5e-9985-4bae57059820\`  (path=\`saleor/warehouse/management.py\`, type=function)

1. \`637f9baa-8ef1-5e5e-9985-4bae57059820\` function saleor/warehouse/management.py:586 anchor=0.61
2. \`005bde1b-f4d4-53a1-9894-77d79be1a139\` method saleor/warehouse/models.py:547 anchor=0.20
`;

export const ASSESS_UNTESTED_HIGH = `## assess_change: stock_qs_select_for_update

## Direct dependents

Call sites for 'stock_qs_select_for_update' (6 found):
- **get_stocks** (saleor/graphql/warehouse/bulk_mutations/stock_bulk_update.py) calls it at line 369
- **_get_stock_for_preorder_allocation** (saleor/warehouse/management.py) calls it at line 1070
- **decrease_stock** (saleor/warehouse/management.py) calls it at line 610
- **increase_stock** (saleor/warehouse/management.py) calls it at line 474
- **stock_bulk_update** (saleor/warehouse/management.py) calls it at line 73
- **reserve_stocks** (saleor/warehouse/reservations.py) calls it at line 113

## Transitive reach

  - update_stocks (Function) in saleor/graphql/warehouse/bulk_mutations/stock_bulk_update.py [depth 2]

## Test coverage

No test calls this symbol, directly or through its callers.

## Risk summary

Direct: 6; transitive: 87; verdict: **high**.
`;

export const ASSESS_MEDIUM = `## assess_change: get_stocks

## Direct dependents

Call sites for 'get_stocks' (1 found):
- **update_stocks** (saleor/graphql/warehouse/bulk_mutations/stock_bulk_update.py) calls it at line 300

## Test coverage

No test calls this symbol, directly or through its callers.

## Risk summary

Direct: 1; transitive: 1; verdict: **medium**.
`;

// El motor dice "ninguna prueba llega aquí" pese a que su propia lista incluye llamadores de
// pruebas (decrease_stock en Saleor, capturado el 2026-10-29).
export const ASSESS_TESTS_CALL_BUT_SAYS_UNTESTED = `## assess_change: decrease_stock

## Direct dependents

Call sites for 'decrease_stock' (4 found):
- **_create_fulfillment_lines** (saleor/order/actions.py) calls it at line 1211
- **fulfill_order_lines** (saleor/order/actions.py) calls it at line 1086
- **test_decrease_stock** (saleor/warehouse/tests/test_stock_management.py) calls it at line 930
- **test_decrease_stock_partially** (saleor/warehouse/tests/test_stock_management.py) calls it at line 1038

## Test coverage

No test calls this symbol, directly or through its callers.

## Risk summary

Direct: 4; transitive: 11; verdict: **high**.
`;

export const ASSESS_NOT_FOUND =
  'Error: Not found: Node not found for handle: no_such_symbol_xyz — the graph indexes committed code, so a symbol added since the last commit will not appear until it is committed and re-indexed';

export const CAPABILITIES = JSON.stringify({
  repositories: [
    { id: 'saleor', last_indexed_commit: '487885d437feed94922cdbdf16a76552c120b550' },
    { id: 'storefront', last_indexed_commit: 'a'.repeat(40) },
  ],
});
