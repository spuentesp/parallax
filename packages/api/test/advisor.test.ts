import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  correlate,
  decodeGlobalId,
  derivedKeyFromNodeName,
  fetchAllContracts,
  fetchAllUnresolved,
  groupProviderContracts,
} from '../src/advisor/correlate.js';
import type { AdvisorEngine } from '../src/advisor/index.js';
import { runAdvisor } from '../src/advisor/index.js';
import {
  buildBindingCandidates,
  buildEnvProposals,
  buildProvidesGraphqlProposals,
} from '../src/advisor/propose.js';
import { parseGraphqlDocument, scanRepo } from '../src/advisor/scan.js';
import type { AdvisorSignal, ContractItem, UnresolvedItem } from '../src/advisor/types.js';
import { emitAdvisorYaml } from '../src/advisor/yaml.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-advisor-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('parseGraphqlDocument', () => {
  it('derives graphql:op:rootField with variables and directives', () => {
    const doc = `
query ProductDetails($slug: String!) @cached {
  product(slug: $slug) { id name }
}
`;
    const parsed = parseGraphqlDocument(doc);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]).toMatchObject({
      operationType: 'query',
      operationName: 'ProductDetails',
      rootField: 'product',
    });
  });

  it('uses the real field behind an alias', () => {
    const parsed = parseGraphqlDocument(
      'mutation { updated: checkoutLinesUpdate(id: "1") { ok } }',
    );
    expect(parsed.operations[0]?.rootField).toBe('checkoutLinesUpdate');
  });

  it('parses multi-operation documents and reports line numbers', () => {
    const doc = [
      'query CheckoutFind { checkout { id } }',
      '',
      'mutation CheckoutCreate { checkoutCreate { id } }',
    ].join('\n');
    const parsed = parseGraphqlDocument(doc);
    expect(parsed.operations.map((o) => `${o.operationType}:${o.rootField}`)).toEqual([
      'query:checkout',
      'mutation:checkoutCreate',
    ]);
    expect(parsed.operations[0]?.line).toBe(1);
    expect(parsed.operations[1]?.line).toBe(3);
  });

  it('does not treat words inside strings or descriptions as operations', () => {
    const doc = `
"""Describes a query { weird } selection"""
type Query {
  search(term: String): String
}
`;
    const parsed = parseGraphqlDocument(doc);
    expect(parsed.operations).toHaveLength(0);
    expect(parsed.isSdl).toBe(true);
  });

  it('flags fragment-only documents as neither operations nor SDL', () => {
    const parsed = parseGraphqlDocument('fragment OrderDetails on Order { id number }');
    expect(parsed.operations).toHaveLength(0);
    expect(parsed.fragments).toEqual(['OrderDetails']);
    expect(parsed.isSdl).toBe(false);
  });

  it('detects directive-only SDL copies', () => {
    const parsed = parseGraphqlDocument(
      '"""\ndoc\n"""\ndirective @lockSchema(schema: String!) on FIELD',
    );
    expect(parsed.isSdl).toBe(true);
  });
});

describe('decodeGlobalId', () => {
  it('decodes the URL-encoded node name inside the GlobalId', () => {
    const decoded = decodeGlobalId(
      'storefront:Function:src/checkout/graphql/checkout.graphql:graphql-call%3Amutation%3AcheckoutLinesUpdate:205',
    );
    expect(decoded).toMatchObject({
      repo: 'storefront',
      path: 'src/checkout/graphql/checkout.graphql',
      name: 'graphql-call:mutation:checkoutLinesUpdate',
      line: 205,
    });
    expect(derivedKeyFromNodeName(decoded?.name ?? '')).toBe(
      'graphql:mutation:checkoutLinesUpdate',
    );
  });

  it('returns null for non-consumer ids', () => {
    expect(derivedKeyFromNodeName('GET /graphql/')).toBeNull();
  });
});

describe('scanRepo', () => {
  it('finds every §4 signal and reads through gitignored output', () => {
    const root = tmpFixture({
      '.gitignore': 'gql/\nsrc/checkout/graphql/generated/\n.env\n/node_modules\n',
      'src/graphql/ProductDetails.graphql':
        'query ProductDetails($slug: String!) {\n  product(slug: $slug) { id }\n}\n',
      'src/graphql/OrderDetailsFragment.graphql': 'fragment OrderDetails on Order { id }\n',
      'src/lib/saleor/client.ts': [
        'async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {',
        '  return fetch(url, init);',
        '}',
        'export function saleorFetch() {',
        '  const url = process.env.NEXT_PUBLIC_SALEOR_API_URL;',
        '  return fetchWithTimeout(url, {});',
        '}',
      ].join('\n'),
      'src/checkout/graphql/codegen.ts': 'export default { schema: "schema.graphql" };\n',
      // gitignored pero el advisor lo escanea igual
      'src/checkout/graphql/generated/checkout.graphql':
        'mutation checkoutComplete { checkoutComplete { ok } }\n',
    });
    const signals = scanRepo({ id: 'storefront', root });
    const kinds = new Set(signals.map((s) => s.kind));
    expect(kinds).toContain('graphql_operations');
    expect(kinds).toContain('fragment_only_document');
    expect(kinds).toContain('env_base_url');
    expect(kinds).toContain('wrapped_fetcher');
    expect(kinds).toContain('codegen_config');
    expect(kinds).toContain('gitignored_generated');

    const env = signals.find((s) => s.kind === 'env_base_url');
    expect(env?.envVar).toBe('NEXT_PUBLIC_SALEOR_API_URL');
    expect(env?.file).toBe('src/lib/saleor/client.ts');
    expect(env?.line).toBe(5);

    const fetcher = signals.find((s) => s.kind === 'wrapped_fetcher');
    expect(fetcher?.detail).toContain('fetchWithTimeout');

    // El output gitignored aporta su operación: es un ciego del walker de LAIN.
    const generated = signals.find((s) => s.file.includes('generated/'));
    expect(generated?.kind).toBe('graphql_operations');
    expect(generated?.derivedKey).toBe('graphql:mutation:checkoutComplete');

    const ignored = signals.filter((s) => s.kind === 'gitignored_generated');
    expect(ignored.map((s) => s.detail).join(' ')).toContain('src/checkout/graphql/generated');
  });

  it('does not propose SDL for repos that only consume', () => {
    const root = tmpFixture({
      'schema.graphql': 'schema {\n  query: Query\n}\ntype Query { shop: Shop }\n',
    });
    const signals = scanRepo({ id: 'saleor', root });
    expect(signals.filter((s) => s.kind === 'sdl_copy')).toHaveLength(1);
    expect(signals.filter((s) => s.kind === 'graphql_operations')).toHaveLength(0);
  });
});

describe('paginación obligatoria', () => {
  const page = (items: unknown[], cursor: string | null) =>
    ({ items, cursor, ambiguous: [], scope: {} }) as never;

  it('follows the cursor to exhaustion on list_unresolved', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const engine = {
      listUnresolved: async (req: Record<string, unknown>) => {
        calls.push(req);
        if (!req.cursor) {
          return page([{ reason: 'graphql_no_op', consumer: { id: 'a:b:c:d:1' } }], 'c1');
        }
        return page([{ reason: 'no_match', consumer: { id: 'a:b:c:d:2' } }], null);
      },
    };
    const items = await fetchAllUnresolved(engine as never, { snapshot: 'live' });
    expect(items).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.cursor).toBe('c1');
    expect(calls[0]?.limit).toBe(1000);
  });

  it('follows the cursor to exhaustion on list_contracts', async () => {
    const engine = {
      listContracts: async (req: { cursor?: string }) =>
        req.cursor
          ? page([{ endpoint: { key: 'graphql:query:product', service: 'saleor-api' } }], null)
          : page([{ endpoint: { key: 'graphql:query:shop', service: 'saleor-api' } }], 'k1'),
    };
    const items = await fetchAllContracts(engine as never, { snapshot: 'live' });
    expect(items.map((i) => i.endpoint.key)).toEqual([
      'graphql:query:shop',
      'graphql:query:product',
    ]);
  });
});

describe('correlate', () => {
  const opSignal: AdvisorSignal = {
    kind: 'graphql_operations',
    repo: 'storefront',
    file: 'src/graphql/ProductDetails.graphql',
    line: 1,
    derivedKey: 'graphql:query:product',
    operationType: 'query',
    rootField: 'product',
  };
  const unresolved: UnresolvedItem[] = [
    {
      reason: 'graphql_no_op',
      consumer: {
        id: 'storefront:Function:src/graphql/ProductDetails.graphql:graphql-call%3Aquery%3Aproduct:1',
        repo: 'storefront',
      },
    },
    {
      reason: 'no_match',
      consumer: { id: 'storefront:HttpClientCall:scripts/x.mjs:GET /:3', repo: 'storefront' },
    },
  ];
  const contracts: ContractItem[] = [
    {
      endpoint: { key: 'graphql:query:product', service: 'saleor-api' },
      bound_consumers: 20,
      providers: [{ repo: 'saleor', path: 'saleor/graphql/schema.graphql', line: 412 }],
    },
    {
      endpoint: { key: 'graphql:query:product', service: 'saleor-dashboard' },
      bound_consumers: 0,
      providers: [{ repo: 'saleor-dashboard', path: 'schema.graphql', line: 431 }],
    },
  ];

  it('matches unresolved graphql_no_op items to scanned signals', () => {
    const correlation = correlate([opSignal], unresolved, contracts);
    expect(correlation.graphqlNoOp.total).toBe(1);
    expect(correlation.graphqlNoOp.matchedToSignals).toBe(1);
    expect(correlation.graphqlNoOp.unmatched).toHaveLength(0);
    expect(correlation.byReason).toEqual({ graphql_no_op: 1, no_match: 1 });
  });

  it('exposes the provider groups that trigger graphql_no_op', () => {
    const correlation = correlate([opSignal], unresolved, contracts);
    expect(correlation.duplicatedKeys).toEqual(['graphql:query:product']);
    const groups = correlation.providerGroups.find((g) => g.key === 'graphql:query:product');
    expect(groups?.groups.map((g) => g.service)).toEqual(['saleor-api', 'saleor-dashboard']);
  });

  it('groups contracts per key and service', () => {
    const byKey = groupProviderContracts(contracts);
    expect(byKey.get('graphql:query:product')).toHaveLength(2);
  });
});

describe('buildProvidesGraphqlProposals', () => {
  const services = [
    { service: 'saleor-api', repo: 'saleor' },
    { service: 'saleor-dashboard', repo: 'saleor-dashboard' },
  ];

  it('proposes only for repos with SDL copies AND consumption signals', () => {
    const signals: AdvisorSignal[] = [
      // provider real: SDL pero sin consumo → nada
      { kind: 'sdl_copy', repo: 'saleor', file: 'saleor/graphql/schema.graphql' },
      // consumer con SDL copiado + operaciones → propuesta
      { kind: 'sdl_copy', repo: 'saleor-dashboard', file: 'schema.graphql' },
      { kind: 'sdl_copy', repo: 'saleor-dashboard', file: 'schema-main.graphql' },
      { kind: 'codegen_config', repo: 'saleor-dashboard', file: 'codegen-main.ts' },
      {
        kind: 'graphql_operations',
        repo: 'saleor-dashboard',
        file: 'src/foo.graphql',
        derivedKey: 'graphql:query:foo',
      },
    ];
    const proposals = buildProvidesGraphqlProposals(signals, services);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      service: 'saleor-dashboard',
      repo: 'saleor-dashboard',
      provides_graphql: false,
    });
    expect(proposals[0]?.evidence.sdlCopies).toEqual(['schema-main.graphql', 'schema.graphql']);
    expect(proposals.map((p) => p.repo)).not.toContain('saleor');
  });
});

describe('buildEnvProposals', () => {
  const envSignal: AdvisorSignal = {
    kind: 'env_base_url',
    repo: 'storefront',
    file: 'src/lib/saleor/client.ts',
    line: 5,
    envVar: 'NEXT_PUBLIC_SALEOR_API_URL',
  };

  it('proposes only for vars that correlate with env_unmapped items', () => {
    const correlation = correlate(
      [envSignal],
      [
        {
          reason: 'env_unmapped',
          consumer: {
            id: 'storefront:Function:src/lib/saleor/client.ts:anon:1',
            repo: 'storefront',
          },
          url_expr: 'process.env.NEXT_PUBLIC_SALEOR_API_URL',
          target_service: 'saleor-api',
        },
      ],
      [],
    );
    const { proposals, noGap } = buildEnvProposals(
      [envSignal],
      correlation,
      [{ service: 'saleor-api', repo: 'saleor' }],
      ['storefront'],
    );
    expect(proposals).toEqual([
      {
        kind: 'env',
        service: 'saleor-api',
        repo: 'saleor',
        env: ['NEXT_PUBLIC_SALEOR_API_URL'],
        evidence: { usage: [{ file: 'src/lib/saleor/client.ts', line: 5 }], unresolvedItems: 1 },
      },
    ]);
    expect(noGap).toHaveLength(0);
  });

  it('reports already-declared vars as no-gap instead of inventing a proposal', () => {
    const correlation = correlate([envSignal], [], []);
    const { proposals, noGap } = buildEnvProposals([envSignal], correlation, [], ['storefront']);
    expect(proposals).toHaveLength(0);
    expect(noGap).toHaveLength(1);
    expect(noGap[0]?.envVar).toBe('NEXT_PUBLIC_SALEOR_API_URL');
  });
});

// Motor falso para runAdvisor: dos llaves graphql con dos proveedores,
// consumidores storefront sin resolver, y check_binding configurable.
function fakeEngine(opts: {
  checkBinding: AdvisorEngine['checkBinding'];
  unresolved?: unknown[];
  contracts?: ContractItem[];
}): AdvisorEngine {
  const unresolved = opts.unresolved ?? [
    {
      reason: 'graphql_no_op',
      consumer: {
        id: 'storefront:Function:src/graphql/ProductDetails.graphql:graphql-call%3Aquery%3Aproduct:1',
        repo: 'storefront',
        path: 'src/graphql/ProductDetails.graphql',
        line: 1,
      },
    },
  ];
  const contracts = opts.contracts ?? [
    {
      endpoint: { key: 'graphql:query:product', service: 'saleor-api' },
      bound_consumers: 20,
      providers: [{ repo: 'saleor', path: 'saleor/graphql/schema.graphql', line: 412 }],
    },
    {
      endpoint: { key: 'graphql:query:product', service: 'saleor-dashboard' },
      bound_consumers: 0,
      providers: [{ repo: 'saleor-dashboard', path: 'schema.graphql', line: 431 }],
    },
  ];
  return {
    listServices: async () =>
      ({
        items: [
          {
            service: 'saleor-api',
            repo: 'saleor',
            endpoints: 0,
            consumer_services: 0,
            unresolved_inbound: 0,
            paths: [],
          },
          {
            service: 'saleor-dashboard',
            repo: 'saleor-dashboard',
            endpoints: 0,
            consumer_services: 0,
            unresolved_inbound: 0,
            paths: [],
          },
          {
            service: 'saleor-storefront',
            repo: 'storefront',
            endpoints: 0,
            consumer_services: 0,
            unresolved_inbound: 0,
            paths: [],
          },
        ],
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      }) as never,
    listUnresolved: async () =>
      ({
        items: unresolved,
        ambiguous: [],
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      }) as never,
    listContracts: async () =>
      ({
        items: contracts,
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      }) as never,
    checkBinding: opts.checkBinding,
  };
}

// Raíz del repo, no cwd: Stryker corre los tests en .stryker-tmp/sandbox-*, y
// desde ahí `../../test-repos` no existe. Las checkouts son locales (gitignored).
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
const CHECKOUT_ROOT = join(REPO_ROOT, 'test-repos');

describe('runAdvisor (end-to-end con motor falso)', () => {
  const fixtureRepos = [
    { id: 'saleor', root: join(CHECKOUT_ROOT, 'saleor') },
    { id: 'saleor-dashboard', root: join(CHECKOUT_ROOT, 'saleor-dashboard') },
    { id: 'storefront', root: join(CHECKOUT_ROOT, 'storefront') },
  ];

  it('degrades gracefully when the engine rejects GraphQL bindings', async () => {
    const engine = fakeEngine({
      checkBinding: async () => {
        // El error real del cliente es un objeto plano, no una instancia de Error.
        throw {
          code: 'LainUnavailable',
          message:
            'lain returned error in envelope: {"code":"invalid_argument","message":"topic endpoints not supported in 0.9"}',
        };
      },
    });
    const report = await runAdvisor(engine, fixtureRepos.slice(1), 'live');
    expect(report.capability.graphqlBindings).toBe('unsupported');
    expect(report.proposals.applicableBindings).toBe(0);
    expect(report.proposals.bindings.length).toBeGreaterThan(0);
    expect(report.proposals.bindings.every((b) => b.status === 'blocked')).toBe(true);
    expect(report.yaml).not.toMatch(/^bindings:/m);
    expect(report.yaml).toContain('provides_graphql: false');
  }, 60_000);

  it('keeps bindings_entry verbatim when check_binding says valid', async () => {
    const entry = [
      '- consumer:',
      '    repo: storefront',
      '    path: src/graphql/ProductDetails.graphql',
      '    symbol: graphql-call:query:product',
      '    key: "graphql:query:product"',
      '  provider:',
      '    service: saleor-api',
      '    key: "graphql:query:product"',
    ].join('\n');
    const engine = fakeEngine({
      checkBinding: async () => ({
        valid: true,
        reasons: [],
        method_match: true,
        template_match: 'exact',
        bindings_entry: entry,
      }),
    });
    const report = await runAdvisor(engine, fixtureRepos.slice(1), 'live');
    expect(report.capability.graphqlBindings).toBe('supported');
    expect(report.proposals.applicableBindings).toBe(1);
    expect(report.yaml).toContain(entry);
  }, 60_000);

  it('never presents invalid bindings as applicable', async () => {
    const engine = fakeEngine({
      checkBinding: async () => ({
        valid: false,
        reasons: ['already_bound'],
        method_match: true,
        template_match: 'exact',
      }),
    });
    const report = await runAdvisor(engine, fixtureRepos.slice(1), 'live');
    expect(report.proposals.applicableBindings).toBe(0);
    expect(report.proposals.bindings[0]?.status).toBe('rejected');
    expect(report.proposals.bindings[0]?.verdict?.reasons).toEqual(['already_bound']);
    expect(report.yaml).not.toMatch(/^bindings:/m);
  }, 60_000);
});

describe('emitAdvisorYaml', () => {
  it('emits the §6 shape with services fields and verbatim bindings', () => {
    const yaml = emitAdvisorYaml({
      providesGraphql: [
        {
          kind: 'provides_graphql',
          service: 'saleor-dashboard',
          repo: 'saleor-dashboard',
          provides_graphql: false,
          evidence: { sdlCopies: ['schema.graphql'], consumption: ['codegen-main.ts'] },
        },
      ],
      env: [
        {
          kind: 'env',
          service: 'saleor-api',
          repo: 'saleor',
          env: ['NEXT_PUBLIC_SALEOR_API_URL'],
          evidence: { usage: [], unresolvedItems: 2 },
        },
      ],
      bindings: [
        {
          kind: 'binding',
          consumer: {
            repo: 'storefront',
            path: 'src/graphql/ProductDetails.graphql',
            symbol: 'graphql-call:query:product',
            key: 'graphql:query:product',
          },
          provider: { service: 'saleor-api', key: 'graphql:query:product' },
          consumerId:
            'storefront:Function:src/graphql/ProductDetails.graphql:graphql-call%3Aquery%3Aproduct:1',
          evidence: {},
          status: 'applicable',
          verdict: { valid: true, reasons: [] },
          bindingsEntry: [
            '- consumer:',
            '    repo: storefront',
            '    path: src/graphql/ProductDetails.graphql',
            '    symbol: graphql-call:query:product',
            '    key: "graphql:query:product"',
            '  provider:',
            '    service: saleor-api',
            '    key: "graphql:query:product"',
          ].join('\n'),
        },
      ],
      capability: { graphqlBindings: 'supported', detail: 'ok', probe: null },
    });
    expect(yaml).toContain('services:');
    expect(yaml).toContain('  - name: saleor-dashboard');
    expect(yaml).toContain('    provides_graphql: false');
    expect(yaml).toContain('    env: ["NEXT_PUBLIC_SALEOR_API_URL"]');
    expect(yaml).toContain('bindings:');
    expect(yaml).toContain('    symbol: graphql-call:query:product');
    // el entry verbatim va con su guion inicial, sin reescribir
    expect(yaml).toMatch(/^bindings:\n- consumer:/m);
  });
});

describe('binding candidates', () => {
  it('dedupes call-sites sharing repo+path+symbol and excludes SDL-copy providers', () => {
    const unresolved: UnresolvedItem[] = [
      {
        reason: 'graphql_no_op',
        consumer: { id: 'storefront:Function:a.graphql:graphql-call%3Aquery%3Aproduct:10' },
      },
      {
        reason: 'graphql_no_op',
        consumer: { id: 'storefront:Function:a.graphql:graphql-call%3Aquery%3Aproduct:20' },
      },
    ];
    const correlation = correlate([], unresolved, [
      {
        endpoint: { key: 'graphql:query:product', service: 'saleor-api' },
        bound_consumers: 5,
        providers: [{ repo: 'saleor' }],
      },
      {
        endpoint: { key: 'graphql:query:product', service: 'saleor-dashboard' },
        bound_consumers: 0,
        providers: [{ repo: 'saleor-dashboard' }],
      },
    ]);
    const candidates = buildBindingCandidates(
      unresolved,
      correlation,
      new Set(['saleor-dashboard']),
      [{ service: 'saleor-api', repo: 'saleor' }],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.provider.service).toBe('saleor-api');
    expect(candidates[0]?.consumer.symbol).toBe('graphql-call:query:product');
  });
});
