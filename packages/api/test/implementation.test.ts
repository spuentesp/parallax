// "¿Qué código implementa este endpoint?": los textos son los que LAIN 0.13.0
// devolvió de verdad para CheckoutShippingAddressUpdate en Saleor.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findImplementation,
  nameVariants,
  parseRegistrations,
  parseSymbols,
} from '../src/implementation.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

const FIND_TWO = `## find_symbol: CheckoutShippingAddressUpdate

Found 2 matches. Disambiguate with the \`path_hint\` argument:

1. \`0def89de-d0b8-5a3e-99bc-4c4c1ebdb9f4\` class saleor/graphql/checkout/mutations/checkout_shipping_address_update.py:46 anchor=0.00
2. \`7906e5e5-1612-5576-951b-7e7fc84db007\` schema saleor/graphql/schema.graphql:30462 anchor=0.00
`;
const FIND_ONE = `## find_symbol: checkout_lines_update

Use this: \`a6c9cb94-7d6b-56c5-88e9-d870ef3d26b0\`  (path=\`saleor/tests/e2e/checkout/utils/checkout_lines_update.py\`, type=function)

1. \`a6c9cb94-7d6b-56c5-88e9-d870ef3d26b0\` function saleor/tests/e2e/checkout/utils/checkout_lines_update.py:62 anchor=0.00
`;
const CALLERS = `## Cross-Runtime Callers for: CheckoutShippingAddressUpdate

### HTTP Routes
- No HTTP routes call this handler

### gRPC Services
- No gRPC services implement this handler

### GraphQL Resolvers
- **CheckoutBillingAddressUpdate** (saleor/graphql/checkout/mutations/checkout_billing_address_update.py)
- **CheckoutMutations** (saleor/graphql/checkout/schema.py)
`;

describe('parsers', () => {
  it('reads the numbered symbol lines (several matches, and the single-match form)', () => {
    expect(parseSymbols(FIND_TWO)).toEqual([
      {
        id: '0def89de-d0b8-5a3e-99bc-4c4c1ebdb9f4',
        type: 'class',
        name: '',
        path: 'saleor/graphql/checkout/mutations/checkout_shipping_address_update.py',
        line: 46,
      },
      {
        id: '7906e5e5-1612-5576-951b-7e7fc84db007',
        type: 'schema',
        name: '',
        path: 'saleor/graphql/schema.graphql',
        line: 30462,
      },
    ]);
    expect(parseSymbols(FIND_ONE)).toHaveLength(1);
    expect(parseSymbols('Error: Not found')).toEqual([]);
  });

  it('reads where the handler is registered, only from the GraphQL section', () => {
    expect(parseRegistrations(CALLERS)).toEqual([
      {
        name: 'CheckoutBillingAddressUpdate',
        path: 'saleor/graphql/checkout/mutations/checkout_billing_address_update.py',
      },
      { name: 'CheckoutMutations', path: 'saleor/graphql/checkout/schema.py' },
    ]);
    expect(
      parseRegistrations('### GraphQL Resolvers\n- No GraphQL fields use this resolver\n'),
    ).toEqual([]);
  });

  it("tries the framework's naming conventions, not just the literal name", () => {
    expect(nameVariants('graphql:mutation:checkoutShippingAddressUpdate')).toEqual([
      'CheckoutShippingAddressUpdate',
      'checkoutShippingAddressUpdate',
      'checkout_shipping_address_update',
    ]);
    expect(nameVariants('http:GET /api/orders/{}')).toEqual([]);
  });
});

function engine(map: Record<string, string>, calls: Array<{ tool: string; args: object }> = []) {
  return {
    ...createLainMock(),
    codeTool: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === 'find_symbol')
        return { text: map[String(args.name)] ?? 'Error: Not found: nothing' };
      return { text: CALLERS };
    },
  } as unknown as LainAdapter;
}

describe('findImplementation', () => {
  it('finds the class that implements a mutation, skips the SDL, and says where it is registered', async () => {
    const calls: Array<{ tool: string; args: object }> = [];
    const r = await findImplementation(engine({ CheckoutShippingAddressUpdate: FIND_TWO }, calls), {
      key: 'graphql:mutation:checkoutShippingAddressUpdate',
      repo: 'saleor',
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      type: 'class',
      line: 46,
      name: 'CheckoutShippingAddressUpdate',
    });
    expect(r.candidates[0]?.path).toMatch(/checkout_shipping_address_update\.py$/);
    expect(r.registeredIn.map((x) => x.name)).toEqual([
      'CheckoutBillingAddressUpdate',
      'CheckoutMutations',
    ]);
    expect(r.basis).toBe('name_match');
    // La búsqueda va al repo pedido y el escalado de repo_id se respeta.
    expect(calls.find((c) => c.tool === 'get_cross_runtime_callers')?.args).toMatchObject({
      node_id: '0def89de-d0b8-5a3e-99bc-4c4c1ebdb9f4',
      repo_id: 'saleor',
    });
  });

  it('never offers tests or schema files as the implementation', async () => {
    const r = await findImplementation(engine({ checkout_lines_update: FIND_ONE }), {
      key: 'graphql:mutation:checkoutLinesUpdate',
      repo: 'saleor',
    });
    expect(r.candidates).toEqual([]);
    expect(r.registeredIn).toEqual([]);
  });

  it('says it found nothing instead of inventing a handler', async () => {
    const r = await findImplementation(engine({}), { key: 'graphql:query:ghost', repo: 'saleor' });
    expect(r.candidates).toEqual([]);
    expect(r.error).toBeUndefined();
    expect(r.tried).toEqual(['Ghost', 'ghost']);
  });

  it('a contract with no searchable name is declined, not guessed', async () => {
    const r = await findImplementation(engine({}), {
      key: 'http:GET /api/orders/{}',
      repo: 'saleor',
    });
    expect(r.error).toMatch(/no searchable name/);
  });

  it('an engine failure is reported as an error', async () => {
    const bad = {
      ...createLainMock(),
      codeTool: async () => {
        throw new Error('lain down');
      },
    } as unknown as LainAdapter;
    const r = await findImplementation(bad, { key: 'graphql:mutation:x', repo: 'saleor' });
    expect(r.error).toBe('lain down');
  });
});

describe('GET /map/implementation', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const H = { authorization: 'Bearer t' };
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-impl-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 't', orgId: 'o', scopes: ['read'] },
        { token: 'w', orgId: 'o', scopes: ['read', 'write'] },
      ],
      webBundlePath: dir,
    });
    app.lainClientFor = async () => engine({ CheckoutShippingAddressUpdate: FIND_TWO });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function ws(lainUrl?: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { authorization: 'Bearer w' },
      payload: { name: 'ws', ...(lainUrl ? { lainUrl } : {}) },
    });
    const id = (r.json() as { workspace: { id: string } }).workspace.id;
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/repos`,
      headers: { authorization: 'Bearer w' },
      payload: { uri: 'https://github.com/saleor/saleor.git' },
    });
    return id;
  }
  const url = (id: string, repo = 'saleor') =>
    `/api/workspaces/${id}/map/implementation?key=${encodeURIComponent('graphql:mutation:checkoutShippingAddressUpdate')}&repo=${repo}`;

  it('answers for a repo of the workspace (read-only token is enough)', async () => {
    const id = await ws('http://lain.test');
    const r = await app.inject({ method: 'GET', url: url(id), headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      source: 'lain',
      result: { basis: 'name_match', candidates: [{ line: 46 }] },
    });
  });

  it('refuses a repo that is not part of the workspace, and an unknown workspace', async () => {
    const id = await ws('http://lain.test');
    expect(
      (await app.inject({ method: 'GET', url: url(id, 'other'), headers: H })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: url('nope'), headers: H })).statusCode).toBe(
      404,
    );
  });

  it('a workspace without LAIN is "unconfigured"', async () => {
    const id = await ws();
    expect((await app.inject({ method: 'GET', url: url(id), headers: H })).json()).toEqual({
      source: 'unconfigured',
    });
  });
});
