/**
 * Scripted Mock Server for Parallax Demo Video & Use Cases
 * 
 * Provides deterministic, high-fidelity responses for:
 * 1. Scene 1 & 3: Org map (repos, services, endpoints, deterministic vs inferred confidence styling).
 * 2. Scene 2: Live streaming Nemotron investigation with engine tool calls,
 *    engine-verified claims badges, and "Show on map" camera focus.
 * 3. Scene 3: Code-level drilldown (files, functions, snippets, call stack stepper & call chain).
 * 4. Scene 4: PR Assessment blast radius report (findings, downstream impacted services, code impact).
 * 5. Scene 5: Audit drawer / Nemotron planning and execution tokens.
 * 6. Test guide & use cases:
 *    - "Which services consume the checkout API, and from which repos?"
 *    - "Which services consume saleor-api?"
 *    - "Does the storefront consume the product query from saleor-api?"
 *    - "Which GraphQL operations related to attributes does the dashboard use against the Saleor API?"
 *    - "Does saleor-api consume saleor-dashboard or saleor-storefront?"
 * 
 * Usage:
 *   pnpm --filter @parallax/api exec tsx scripts/demo-mock-server.ts [--port 8080]
 */

import Fastify from 'fastify';
import type {
  OrgEdge,
  OrgNode,
  OrgGraph,
  MapViewResponse,
  NodeDetail,
  ProjectedNode,
} from '@parallax/shared/org-map';

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

// ── 1. Static Org Graph Definition (Saleor Architecture) ─────────────────────

const NODES: OrgNode[] = [
  // Repositories
  {
    id: 'repo:saleor',
    label: 'saleor (API)',
    kind: 'repo',
    parent: null,
    meta: { repo: 'saleor', lainRepoId: 'saleor' },
  },
  {
    id: 'repo:saleor-dashboard',
    label: 'saleor-dashboard',
    kind: 'repo',
    parent: null,
    meta: { repo: 'saleor-dashboard', lainRepoId: 'saleor-dashboard' },
  },
  {
    id: 'repo:storefront',
    label: 'storefront',
    kind: 'repo',
    parent: null,
    meta: { repo: 'storefront', lainRepoId: 'storefront' },
  },

  // Services
  {
    id: 'svc:saleor-api',
    label: 'saleor-api',
    kind: 'service',
    parent: 'repo:saleor',
    meta: { service: 'saleor-api', repo: 'saleor' },
  },
  {
    id: 'svc:saleor-dashboard',
    label: 'saleor-dashboard',
    kind: 'service',
    parent: 'repo:saleor-dashboard',
    meta: { service: 'saleor-dashboard', repo: 'saleor-dashboard' },
  },
  {
    id: 'svc:saleor-storefront',
    label: 'saleor-storefront',
    kind: 'service',
    parent: 'repo:storefront',
    meta: { service: 'saleor-storefront', repo: 'storefront' },
  },

  // Service Groups under saleor-api
  {
    id: 'grp:checkout',
    label: 'Checkout API',
    kind: 'group',
    parent: 'svc:saleor-api',
    meta: { group: 'checkout', contracts: 4 },
  },
  {
    id: 'grp:catalog',
    label: 'Catalog & Products',
    kind: 'group',
    parent: 'svc:saleor-api',
    meta: { group: 'catalog', contracts: 3 },
  },
  {
    id: 'grp:attributes',
    label: 'Attributes & Metadata',
    kind: 'group',
    parent: 'svc:saleor-api',
    meta: { group: 'attributes', contracts: 3 },
  },

  // Endpoints under Checkout
  {
    id: 'ep:graphql:mutation:checkoutCreate',
    label: 'mutation checkoutCreate',
    kind: 'endpoint',
    parent: 'grp:checkout',
    contract: 'graphql',
    meta: {
      key: 'graphql:mutation:checkoutCreate',
      service: 'saleor-api',
      repo: 'saleor',
      path: 'saleor/graphql/checkout/mutations/checkout_create.py',
    },
  },
  {
    id: 'ep:graphql:mutation:checkoutPaymentCreate',
    label: 'mutation checkoutPaymentCreate',
    kind: 'endpoint',
    parent: 'grp:checkout',
    contract: 'graphql',
    meta: {
      key: 'graphql:mutation:checkoutPaymentCreate',
      service: 'saleor-api',
      repo: 'saleor',
      path: 'saleor/graphql/checkout/mutations/checkout_payment_create.py',
    },
  },
  {
    id: 'ep:graphql:mutation:checkoutShippingAddressUpdate',
    label: 'mutation checkoutShippingAddressUpdate',
    kind: 'endpoint',
    parent: 'grp:checkout',
    contract: 'graphql',
    meta: {
      key: 'graphql:mutation:checkoutShippingAddressUpdate',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
  {
    id: 'ep:graphql:query:checkout',
    label: 'query checkout',
    kind: 'endpoint',
    parent: 'grp:checkout',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:checkout',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },

  // Endpoints under Catalog
  {
    id: 'ep:graphql:query:product',
    label: 'query product',
    kind: 'endpoint',
    parent: 'grp:catalog',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:product',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
  {
    id: 'ep:graphql:query:products',
    label: 'query products',
    kind: 'endpoint',
    parent: 'grp:catalog',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:products',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
  {
    id: 'ep:graphql:query:category',
    label: 'query category',
    kind: 'endpoint',
    parent: 'grp:catalog',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:category',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },

  // Endpoints under Attributes
  {
    id: 'ep:graphql:query:attributes',
    label: 'query attributes',
    kind: 'endpoint',
    parent: 'grp:attributes',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:attributes',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
  {
    id: 'ep:graphql:query:attributeDetails',
    label: 'query attributeDetails',
    kind: 'endpoint',
    parent: 'grp:attributes',
    contract: 'graphql',
    meta: {
      key: 'graphql:query:attributeDetails',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
  {
    id: 'ep:graphql:mutation:attributeUpdate',
    label: 'mutation attributeUpdate',
    kind: 'endpoint',
    parent: 'grp:attributes',
    contract: 'graphql',
    meta: {
      key: 'graphql:mutation:attributeUpdate',
      service: 'saleor-api',
      repo: 'saleor',
    },
  },
];

const EDGES: OrgEdge[] = [
  // Proven deterministic edges (Solid lines, 1.0 confidence)
  {
    id: 'edge:storefront->checkoutCreate',
    source: 'svc:saleor-storefront',
    target: 'ep:graphql:mutation:checkoutCreate',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 4,
    deterministicCount: 4,
    inferredCount: 0,
    fields: ['checkout', 'errors', 'lines'],
    sites: [{ repo: 'storefront', path: 'src/checkout/useCheckout.ts', line: 42 }],
  },
  {
    id: 'edge:checkoutCreate->saleor-api',
    source: 'ep:graphql:mutation:checkoutCreate',
    target: 'svc:saleor-api',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:storefront->checkoutPaymentCreate',
    source: 'svc:saleor-storefront',
    target: 'ep:graphql:mutation:checkoutPaymentCreate',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 2,
    deterministicCount: 2,
    inferredCount: 0,
    fields: ['payment', 'errors'],
    sites: [{ repo: 'storefront', path: 'src/checkout/payment.ts', line: 88 }],
  },
  {
    id: 'edge:checkoutPaymentCreate->saleor-api',
    source: 'ep:graphql:mutation:checkoutPaymentCreate',
    target: 'svc:saleor-api',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:storefront->product',
    source: 'svc:saleor-storefront',
    target: 'ep:graphql:query:product',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 12,
    deterministicCount: 12,
    inferredCount: 0,
    fields: ['id', 'name', 'variants', 'pricing'],
    sites: [{ repo: 'storefront', path: 'src/views/Product/ProductView.tsx', line: 55 }],
  },
  {
    id: 'edge:product->saleor-api',
    source: 'ep:graphql:query:product',
    target: 'svc:saleor-api',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },

  // Inferred heuristic edges (Dashed lines, lower confidence)
  {
    id: 'edge:dashboard->checkout',
    source: 'svc:saleor-dashboard',
    target: 'ep:graphql:query:checkout',
    kind: 'consumes',
    provenance: 'inferred',
    confidence: 0.74,
    count: 2,
    deterministicCount: 0,
    inferredCount: 2,
    fields: ['lines', 'token', 'user'],
    sites: [{ repo: 'saleor-dashboard', path: 'src/orders/views/OrderDetails.tsx', line: 112 }],
  },
  {
    id: 'edge:checkout->saleor-api',
    source: 'ep:graphql:query:checkout',
    target: 'svc:saleor-api',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:dashboard->attributes',
    source: 'svc:saleor-dashboard',
    target: 'ep:graphql:query:attributes',
    kind: 'consumes',
    provenance: 'inferred',
    confidence: 0.58,
    count: 3,
    deterministicCount: 0,
    inferredCount: 3,
    fields: ['id', 'name', 'values'],
    sites: [{ repo: 'saleor-dashboard', path: 'src/attributes/views/AttributeList.tsx', line: 30 }],
  },
  {
    id: 'edge:attributes->saleor-api',
    source: 'ep:graphql:query:attributes',
    target: 'svc:saleor-api',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
];

const SALEOR_GRAPH: OrgGraph = { nodes: NODES, edges: EDGES };

// ── 2. Scripted Answers for Test Guide & Use Cases ───────────────────────────

interface ScriptedScenario {
  matches: (q: string) => boolean;
  progressSteps: Array<{
    type: 'round' | 'tool' | 'verify';
    round?: number;
    toolCallsUsed?: number;
    maxToolCalls?: number;
    forced?: boolean;
    tool?: string;
    summary?: string;
    ok?: boolean;
    ms?: number;
    claims?: number;
    delayMs: number;
  }>;
  response: Record<string, unknown>;
}

const SCENARIOS: ScriptedScenario[] = [
  // Scene 2 Video Pitch: "Which services consume the checkout API, and from which repos?"
  {
    matches: (q) => /checkout.*(?:consume|api|repo)|which services consume/i.test(q) && !/attributes|product|reverse/i.test(q),
    progressSteps: [
      {
        type: 'round',
        round: 1,
        toolCallsUsed: 0,
        maxToolCalls: 8,
        forced: false,
        delayMs: 600,
      },
      {
        type: 'tool',
        tool: 'get_service',
        summary: 'query saleor-api consumer bindings & endpoints',
        ok: true,
        ms: 142,
        delayMs: 1200,
      },
      {
        type: 'tool',
        tool: 'list_contracts',
        summary: 'filter GraphQL checkout mutations & queries',
        ok: true,
        ms: 88,
        delayMs: 1100,
      },
      {
        type: 'tool',
        tool: 'get_call_chain',
        summary: 'trace checkoutCreate mutation from storefront to saleor core',
        ok: true,
        ms: 165,
        delayMs: 1400,
      },
      {
        type: 'round',
        round: 2,
        toolCallsUsed: 3,
        maxToolCalls: 8,
        forced: false,
        delayMs: 600,
      },
      {
        type: 'verify',
        claims: 3,
        delayMs: 900,
      },
    ],
    response: {
      answer: `The **checkout API** provided by **saleor-api** (repo: \`saleor\`) is consumed across two separate repositories:

1. **saleor-storefront** (repo: \`storefront\`):
   - Consumes core checkout mutations: \`checkoutCreate\`, \`checkoutPaymentCreate\`, and \`checkoutShippingAddressUpdate\`.
   - Relationships are **proven by static analysis** with 100% confidence from GraphQL operation documents in \`src/checkout/\`.

2. **saleor-dashboard** (repo: \`saleor-dashboard\`):
   - Consumes administrative checkout queries (\`checkouts\`, \`checkoutDetails\`) for order fulfillment tracking.
   - Relationships are **inferred** with high confidence (0.74) based on administrative view controllers.

**Engine Verification:** The static analysis engine verified that \`saleor-api\` has **zero downstream dependencies** back into either storefront or dashboard (unidirectional service mesh).`,
      explanation_status: 'available',
      claims: [
        {
          claim: {
            kind: 'relation',
            consumer: 'saleor-storefront',
            provider: 'saleor-api',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: {
            uses: 8,
            endpoints: [
              'graphql:mutation:checkoutCreate',
              'graphql:mutation:checkoutPaymentCreate',
              'graphql:mutation:checkoutShippingAddressUpdate',
            ],
          },
          reason: 'Engine verified: 8 checkout operations in storefront calling saleor-api',
        },
        {
          claim: {
            kind: 'relation',
            consumer: 'saleor-dashboard',
            provider: 'saleor-api',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: {
            uses: 3,
            endpoints: ['graphql:query:checkouts', 'graphql:query:checkoutDetails'],
          },
          reason: 'Engine verified: 3 administrative checkout queries in dashboard calling saleor-api',
        },
        {
          claim: {
            kind: 'relation',
            consumer: 'saleor-api',
            provider: 'saleor-storefront',
            polarity: 'absent',
          },
          verdict: 'verified',
          engine: {
            uses: 0,
            endpoints: [],
          },
          reason: 'Engine verified: no reverse dependency from API to storefront',
        },
      ],
      claims_summary: {
        total: 3,
        verified: 3,
        contradicted: 0,
        unverifiable: 0,
        supported: 3,
        unsupported: 0,
      },
      map_focus: {
        seed: 'ep:graphql:mutation:checkoutCreate',
        ids: [
          'svc:saleor-api',
          'svc:saleor-storefront',
          'svc:saleor-dashboard',
          'ep:graphql:mutation:checkoutCreate',
          'ep:graphql:mutation:checkoutPaymentCreate',
          'grp:checkout',
        ],
        relations: [
          {
            consumer: 'saleor-storefront',
            provider: 'saleor-api',
            polarity: 'present',
            uses: 8,
            endpoints: ['graphql:mutation:checkoutCreate'],
            complete: true,
          },
        ],
        query: 'checkout',
      },
      conversation: { id: 'conv_demo_pitch', seq: 1 },
      budget: {
        maxToolCalls: 8,
        maxModelMs: 120000,
        toolCallsUsed: 3,
        modelMsUsed: 1940,
        exhausted: false,
        cutShort: false,
        rounds: 2,
        promptTokens: 18450,
        completionTokens: 382,
      },
      model: 'nvidia/nemotron-3-super-120b-a12b',
      tool_calls: [
        {
          id: 'call_get_service',
          tool: 'get_service',
          args: { service: 'saleor-api', snapshot: 'live' },
          output: 'Found 2 consumers: saleor-storefront (8 uses), saleor-dashboard (3 uses)',
        },
        {
          id: 'call_list_contracts',
          tool: 'list_contracts',
          args: { service: 'saleor-api', kind: 'graphql' },
          output: 'Contracts: checkoutCreate, checkoutPaymentCreate, checkoutShippingAddressUpdate',
        },
        {
          id: 'call_call_chain',
          tool: 'get_call_chain',
          args: { from: 'useCheckout', to: 'checkoutCreate', repo_id: 'storefront' },
          output: 'useCheckout.ts -> checkoutMutation -> checkoutCreate',
        },
      ],
    },
  },

  // Test Guide Case 2: "Does the storefront consume the product query from saleor-api?"
  {
    matches: (q) => /storefront.*product|product.*storefront/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool', tool: 'get_service', summary: 'inspect saleor-api product consumers', ok: true, ms: 95, delayMs: 700 },
      { type: 'verify', claims: 1, delayMs: 500 },
    ],
    response: {
      answer: `**Yes.** The static analysis engine proves that **saleor-storefront** consumes the \`graphql:query:product\` endpoint from **saleor-api**.

**Evidence:**
- \`src/views/Product/ProductView.tsx:55\` executes query \`ProductDetails\` requesting fields \`['id', 'name', 'variants', 'pricing']\`.
- Deterministic static binding with confidence **1.0**.`,
      explanation_status: 'available',
      claims: [
        {
          claim: {
            kind: 'relation',
            consumer: 'saleor-storefront',
            provider: 'saleor-api',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: { uses: 12, endpoints: ['graphql:query:product'] },
          reason: 'Engine verified: 12 calls in storefront to graphql:query:product',
        },
      ],
      claims_summary: { total: 1, verified: 1, contradicted: 0, unverifiable: 0, supported: 1, unsupported: 0 },
      map_focus: {
        seed: 'ep:graphql:query:product',
        ids: ['svc:saleor-api', 'svc:saleor-storefront', 'ep:graphql:query:product'],
        relations: [
          { consumer: 'saleor-storefront', provider: 'saleor-api', polarity: 'present', uses: 12, endpoints: ['graphql:query:product'], complete: true },
        ],
        query: 'product',
      },
      conversation: { id: 'conv_demo_product', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 1, modelMsUsed: 620, exhausted: false, cutShort: false, rounds: 1, promptTokens: 4120, completionTokens: 140 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  },

  // Test Guide Case 3: "Which GraphQL operations related to attributes does the dashboard use against the Saleor API?"
  {
    matches: (q) => /attribute.*dashboard|dashboard.*attribute/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool', tool: 'get_service', summary: 'search attribute endpoints in dashboard usages', ok: true, ms: 110, delayMs: 800 },
      { type: 'verify', claims: 3, delayMs: 500 },
    ],
    response: {
      answer: `The **saleor-dashboard** consumes **3 GraphQL operations** related to attributes against **saleor-api**:

1. \`graphql:query:attributes\` (in \`src/attributes/views/AttributeList.tsx\`)
2. \`graphql:query:attributeDetails\` (in \`src/attributes/views/AttributeDetails.tsx\`)
3. \`graphql:mutation:attributeUpdate\` (in \`src/attributes/mutations.ts\`)`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'relation', consumer: 'saleor-dashboard', provider: 'saleor-api', polarity: 'present' },
          verdict: 'verified',
          engine: { uses: 3, endpoints: ['graphql:query:attributes', 'graphql:query:attributeDetails', 'graphql:mutation:attributeUpdate'] },
          reason: 'Engine verified: 3 attribute operations recorded in dashboard',
        },
      ],
      claims_summary: { total: 1, verified: 1, contradicted: 0, unverifiable: 0, supported: 1, unsupported: 0 },
      map_focus: {
        seed: 'grp:attributes',
        ids: ['svc:saleor-api', 'svc:saleor-dashboard', 'grp:attributes', 'ep:graphql:query:attributes', 'ep:graphql:query:attributeDetails'],
        relations: [{ consumer: 'saleor-dashboard', provider: 'saleor-api', polarity: 'present', uses: 3, endpoints: ['graphql:query:attributes'], complete: true }],
        query: 'attributes',
      },
      conversation: { id: 'conv_demo_attributes', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 1, modelMsUsed: 710, exhausted: false, cutShort: false, rounds: 1, promptTokens: 6200, completionTokens: 180 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  },

  // Test Guide Case 4: "Does saleor-api consume saleor-dashboard or saleor-storefront?"
  {
    matches: (q) => /reverse|saleor-api consume|api consume/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool', tool: 'get_service', summary: 'check outgoing dependencies of saleor-api', ok: true, ms: 80, delayMs: 600 },
      { type: 'verify', claims: 2, delayMs: 500 },
    ],
    response: {
      answer: `**No.** \`saleor-api\` does not consume \`saleor-dashboard\` or \`saleor-storefront\`.

The static analysis engine confirms the dependency graph is strictly **unidirectional**: \`saleor-api\` acts purely as the upstream service provider.`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'relation', consumer: 'saleor-api', provider: 'saleor-dashboard', polarity: 'absent' },
          verdict: 'verified',
          engine: { uses: 0, endpoints: [] },
          reason: 'Engine verified: no dependency from api to dashboard',
        },
        {
          claim: { kind: 'relation', consumer: 'saleor-api', provider: 'saleor-storefront', polarity: 'absent' },
          verdict: 'verified',
          engine: { uses: 0, endpoints: [] },
          reason: 'Engine verified: no dependency from api to storefront',
        },
      ],
      claims_summary: { total: 2, verified: 2, contradicted: 0, unverifiable: 0, supported: 2, unsupported: 0 },
      map_focus: {
        seed: 'svc:saleor-api',
        ids: ['svc:saleor-api', 'svc:saleor-dashboard', 'svc:saleor-storefront'],
        relations: [],
        query: 'saleor-api',
      },
      conversation: { id: 'conv_demo_reverse', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 1, modelMsUsed: 520, exhausted: false, cutShort: false, rounds: 1, promptTokens: 3800, completionTokens: 110 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  },
];

// Fallback scenario
function fallbackScenario(question: string) {
  return {
    progressSteps: [
      { type: 'round' as const, round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool' as const, tool: 'get_service', summary: 'read service topology from engine', ok: true, ms: 120, delayMs: 700 },
      { type: 'verify' as const, claims: 1, delayMs: 500 },
    ],
    response: {
      answer: `Based on static analysis of the workspace architecture, **saleor-api** is the core provider service consumed by **saleor-storefront** and **saleor-dashboard** via GraphQL contracts.`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'relation', consumer: 'saleor-storefront', provider: 'saleor-api', polarity: 'present' },
          verdict: 'verified',
          engine: { uses: 24, endpoints: ['graphql:mutation:checkoutCreate', 'graphql:query:product'] },
          reason: 'Engine verified: active contracts found in storefront',
        },
      ],
      claims_summary: { total: 1, verified: 1, contradicted: 0, unverifiable: 0, supported: 1, unsupported: 0 },
      map_focus: {
        seed: 'svc:saleor-api',
        ids: ['svc:saleor-api', 'svc:saleor-storefront'],
        relations: [],
        query: question,
      },
      conversation: { id: 'conv_demo_gen', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 1, modelMsUsed: 800, exhausted: false, cutShort: false, rounds: 1, promptTokens: 5000, completionTokens: 120 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  };
}

// ── 3. Build Fastify App ─────────────────────────────────────────────────────

export async function buildDemoServer() {
  const app = Fastify({ logger: { level: 'info' } });

  // CORS support
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return reply.code(200).send();
    }
  });

  // Health
  app.get('/api/health', async () => ({
    status: 'ok',
    lainAdapter: 'mock-scripted',
    version: '0.13.0-demo',
  }));

  // WhoAmI
  app.get('/api/whoami', async () => ({
    orgId: 'ws_saleor',
    scopes: ['read', 'write', 'admin'],
    readOnly: false,
  }));

  // Orgs
  app.get('/api/orgs', async () => ({
    orgs: [
      {
        id: 'ws_saleor',
        name: 'Saleor',
        description: 'E-commerce platform: API + Dashboard + Storefront. Three repos, GraphQL contracts.',
        repoCount: 3,
      },
    ],
  }));

  // Workspaces
  app.get('/api/workspaces', async () => ({
    workspaces: [
      {
        id: 'ws_saleor',
        name: 'Saleor',
        description: 'E-commerce platform: API + Dashboard + Storefront',
        lainUrl: 'http://localhost:9999/mcp',
        repoCount: 3,
        repos: [
          { id: 'repo_saleor_api', uri: 'https://github.com/saleor/saleor.git', sha: 'a3184854', local: './test-repos/saleor' },
          { id: 'repo_saleor_dashboard', uri: 'https://github.com/saleor/saleor-dashboard.git', sha: 'e34cd91d', local: './test-repos/saleor-dashboard' },
          { id: 'repo_saleor_storefront', uri: 'https://github.com/saleor/storefront.git', sha: '05641e1f', local: './test-repos/storefront' },
        ],
      },
    ],
  }));

  app.get('/api/workspaces/:id', async () => ({
    workspace: {
      id: 'ws_saleor',
      name: 'Saleor',
      description: 'E-commerce platform: API + Dashboard + Storefront',
      lainUrl: 'http://localhost:9999/mcp',
      repoCount: 3,
      repos: [
        { id: 'repo_saleor_api', uri: 'https://github.com/saleor/saleor.git', sha: 'a3184854', local: './test-repos/saleor' },
        { id: 'repo_saleor_dashboard', uri: 'https://github.com/saleor/saleor-dashboard.git', sha: 'e34cd91d', local: './test-repos/saleor-dashboard' },
        { id: 'repo_saleor_storefront', uri: 'https://github.com/saleor/storefront.git', sha: '05641e1f', local: './test-repos/storefront' },
      ],
    },
  }));

  app.get('/api/workspaces/:id/ci', async () => ({
    mode: 'on-open-and-update',
    baseBranch: 'main',
    reportComments: true,
  }));

  app.get('/api/workspaces/:id/prs', async () => ({
    prs: [
      {
        provider: 'github',
        repoId: 'repo_saleor_api',
        repoUri: 'https://github.com/saleor/saleor.git',
        number: 1142,
        title: 'Add delivery note to checkout API',
        author: 'exsepue_bci',
        url: 'https://github.com/saleor/saleor/pull/1142',
        headSha: 'e4f8101a',
        baseBranch: 'main',
        updatedAt: new Date().toISOString(),
      },
    ],
  }));

  // Map View
  app.post('/api/workspaces/:id/map/view', async (req) => {
    const body = (req.body ?? {}) as {
      expand?: string[];
      filters?: {
        contract?: string;
        provenance?: 'deterministic' | 'inferred';
        minConfidence?: number;
        service?: string;
      };
      focus?: string;
    };

    const expand = new Set(body.expand ?? []);
    // Always expand top level repos and services by default for a rich initial view
    expand.add('repo:saleor');
    expand.add('repo:saleor-dashboard');
    expand.add('repo:storefront');
    expand.add('svc:saleor-api');

    let filteredNodes = NODES;
    let filteredEdges = EDGES;

    if (body.filters?.provenance) {
      filteredEdges = filteredEdges.filter((e) => e.provenance === body.filters?.provenance);
    }
    if (body.filters?.minConfidence !== undefined) {
      filteredEdges = filteredEdges.filter((e) => e.confidence >= (body.filters?.minConfidence ?? 0));
    }
    if (body.filters?.contract) {
      filteredNodes = filteredNodes.filter((n) => !n.contract || n.contract === body.filters?.contract);
    }

    // Build visible projected nodes
    const isVisible = (n: OrgNode): boolean => {
      if (n.parent === null) return true;
      return expand.has(n.parent);
    };

    const visibleNodes = filteredNodes.filter(isVisible);
    const visibleIds = new Set(visibleNodes.map((n) => n.id));

    const projected: ProjectedNode[] = visibleNodes.map((n) => {
      const children = filteredNodes.filter((c) => c.parent === n.id);
      return {
        ...n,
        childCount: children.length,
        expanded: expand.has(n.id),
        lazy: n.kind === 'endpoint' || n.kind === 'service',
      };
    });

    const activeEdges = filteredEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

    const response: MapViewResponse = {
      nodes: projected,
      edges: activeEdges,
      hiddenChildren: {},
      unknownExpand: [],
      focus: body.focus ? { seed: body.focus, ids: [body.focus] } : null,
      totals: {
        nodes: filteredNodes.length,
        edges: filteredEdges.length,
        shownNodes: projected.length,
        shownEdges: activeEdges.length,
      },
      meta: { source: 'lain', generatedAt: Date.now() },
    };

    return response;
  });

  // Map Node Details (Inspector drawer)
  app.get('/api/workspaces/:id/map/node', async (req) => {
    const { id } = req.query as { id: string };
    const node = NODES.find((n) => n.id === id);
    if (!node) {
      return { detail: null, meta: { source: 'lain' } };
    }

    const children = NODES.filter((n) => n.parent === id);
    const path: OrgNode[] = [];
    let cur = node.parent ? NODES.find((n) => n.id === node.parent) : null;
    while (cur) {
      path.unshift(cur);
      cur = cur.parent ? NODES.find((n) => n.id === cur.parent) : null;
    }

    // Consumers & Providers
    const incomingEdges = EDGES.filter((e) => e.target === id);
    const outgoingEdges = EDGES.filter((e) => e.source === id);

    const consumers = incomingEdges.map((edge) => {
      const peer = NODES.find((n) => n.id === edge.source) ?? node;
      return {
        edge,
        peer,
        links: [
          {
            endpoint: node,
            provenance: edge.provenance,
            confidence: edge.confidence,
            count: edge.count,
            fields: edge.fields ?? [],
            sites: edge.sites ?? [],
          },
        ],
        hiddenLinks: 0,
      };
    });

    const providers = outgoingEdges.map((edge) => {
      const peer = NODES.find((n) => n.id === edge.target) ?? node;
      return {
        edge,
        peer,
        links: [
          {
            endpoint: peer,
            provenance: edge.provenance,
            confidence: edge.confidence,
            count: edge.count,
            fields: edge.fields ?? [],
            sites: edge.sites ?? [],
          },
        ],
        hiddenLinks: 0,
      };
    });

    const detail: NodeDetail = {
      node,
      path,
      children,
      consumers,
      providers,
    };

    return { detail, meta: { source: 'lain' } };
  });

  // Map Briefing
  app.get('/api/workspaces/:id/map/briefing', async () => ({
    briefing: {
      totals: { repos: 3, services: 3, contracts: 10, relations: 4 },
      repos: [
        {
          id: 'repo:saleor',
          name: 'saleor (API)',
          lainRepoId: 'saleor',
          services: [
            {
              id: 'svc:saleor-api',
              name: 'saleor-api',
              contracts: 10,
              groups: [
                { key: 'checkout', label: 'Checkout API', count: 4 },
                { key: 'catalog', label: 'Catalog & Products', count: 3 },
                { key: 'attributes', label: 'Attributes & Metadata', count: 3 },
              ],
            },
          ],
        },
        {
          id: 'repo:saleor-dashboard',
          name: 'saleor-dashboard',
          lainRepoId: 'saleor-dashboard',
          services: [{ id: 'svc:saleor-dashboard', name: 'saleor-dashboard', contracts: 0, groups: [] }],
        },
        {
          id: 'repo:storefront',
          name: 'storefront',
          lainRepoId: 'storefront',
          services: [{ id: 'svc:saleor-storefront', name: 'saleor-storefront', contracts: 0, groups: [] }],
        },
      ],
      relations: [
        { from: 'saleor-storefront', to: 'saleor-api', uses: 8, deterministic: 8, inferred: 0, contractsUsed: 2 },
        { from: 'saleor-dashboard', to: 'saleor-api', uses: 3, deterministic: 0, inferred: 3, contractsUsed: 2 },
      ],
      hubs: [{ service: 'saleor-api', repo: 'saleor', consumerServices: 2, uses: 11 }],
      topOperations: [
        { key: 'graphql:query:product', service: 'saleor-api', group: 'catalog', uses: 12, consumers: 1 },
        { key: 'graphql:mutation:checkoutCreate', service: 'saleor-api', group: 'checkout', uses: 4, consumers: 1 },
        { key: 'graphql:query:attributes', service: 'saleor-api', group: 'attributes', uses: 3, consumers: 1 },
      ],
      gaps: [],
    },
    meta: { source: 'lain' },
  }));

  // Code Graph Root
  app.get('/api/workspaces/:id/graph', async () => ({
    graph: {
      repos: [
        {
          repo: 'saleor',
          truncated: false,
          nodes: [
            { id: 'f:checkout_create.py', name: 'checkout_create.py', type: 'File', kind: 'file' },
            { id: 'f:schema.graphql', name: 'schema.graphql', type: 'File', kind: 'file' },
            { id: 'fn:checkout_create', name: 'checkout_create', type: 'Function', kind: 'symbol' },
            { id: 'fn:process_payment', name: 'process_payment', type: 'Function', kind: 'symbol' },
          ],
        },
        {
          repo: 'storefront',
          truncated: false,
          nodes: [
            { id: 'f:useCheckout.ts', name: 'useCheckout.ts', type: 'File', kind: 'file' },
            { id: 'f:ProductView.tsx', name: 'ProductView.tsx', type: 'File', kind: 'file' },
          ],
        },
        {
          repo: 'saleor-dashboard',
          truncated: false,
          nodes: [
            { id: 'f:OrderDetails.tsx', name: 'OrderDetails.tsx', type: 'File', kind: 'file' },
            { id: 'f:AttributeList.tsx', name: 'AttributeList.tsx', type: 'File', kind: 'file' },
          ],
        },
      ],
    },
    source: 'lain',
    workspace: { id: 'ws_saleor', name: 'Saleor', repoCount: 3 },
  }));

  // Code Graph Children (drilling into code)
  app.get('/api/workspaces/:id/graph/children', async (req) => {
    const { repo, name } = req.query as { repo: string; type: string; name: string };
    if (name.includes('checkout')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:checkout_create', name: 'checkout_create', type: 'Function', kind: 'symbol' },
          { id: 'fn:clean_checkout', name: 'clean_checkout', type: 'Function', kind: 'symbol' },
          { id: 'c:Checkout', name: 'Checkout', type: 'Class', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:calculate_taxes', name: 'calculate_taxes', type: 'Function', kind: 'symbol' },
              { id: 'fn:save_checkout', name: 'save_checkout', type: 'Function', kind: 'symbol' },
            ],
          },
          {
            edge: 'Uses',
            nodes: [{ id: 'c:Checkout', name: 'Checkout', type: 'Class', kind: 'symbol' }],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }
    return {
      node: { repo, type: 'File', name },
      children: [],
      communications: [],
      source: 'lain',
    };
  });

  // Symbol Context & CallStackStepper
  app.get('/api/workspaces/:id/graph/symbol-context', async (req) => {
    const { repo, symbol } = req.query as { repo: string; symbol: string };
    if (symbol.includes('checkout') || symbol === 'checkout_create') {
      return {
        context: {
          symbol: 'checkout_create',
          repo: 'saleor',
          path: 'saleor/graphql/checkout/mutations/checkout_create.py',
          type: 'Function',
          anchorScore: 0.94,
          calledBy: ['handle_checkout_request', 'checkout_create_mutation'],
          calls: ['clean_checkout', 'calculate_taxes', 'save_checkout'],
          rawText: `## Explanation for 'checkout_create' (Function)\n**Path:** saleor/graphql/checkout/mutations/checkout_create.py\n- **Anchor Score:** 0.94\n- **Called by:** handle_checkout_request, checkout_create_mutation\n- **Calls:** clean_checkout, calculate_taxes, save_checkout`,
        },
        source: 'lain',
      };
    }
    return {
      context: {
        symbol,
        repo,
        path: `src/${symbol}.ts`,
        type: 'Function',
        anchorScore: 0.75,
        calledBy: ['root_handler'],
        calls: ['helper_fn'],
        rawText: `Explanation for '${symbol}'`,
      },
      source: 'lain',
    };
  });

  // Call Chain
  app.get('/api/workspaces/:id/graph/call-chain', async (req) => {
    const { from, to, repo } = req.query as { from: string; to: string; repo: string };
    return {
      chain: {
        from: from ?? 'checkout_create_mutation',
        to: to ?? 'calculate_taxes',
        repo: repo ?? 'saleor',
        chain: [from ?? 'checkout_create_mutation', 'checkout_create', to ?? 'calculate_taxes'],
        rawText: `${from} → checkout_create → ${to}`,
      },
      source: 'lain',
    };
  });

  // Code Snippet
  app.get('/api/workspaces/:id/graph/snippet', async (req) => {
    const { symbol } = req.query as { repo: string; symbol: string };
    return {
      snippet: {
        symbol: symbol ?? 'checkout_create',
        repo: 'saleor',
        path: 'saleor/graphql/checkout/mutations/checkout_create.py',
        text: `@traced_atomic_transaction()
def checkout_create(info, input_data):
    """Creates a new customer checkout session with taxes & shipping lines."""
    cleaned_input = clean_checkout_input(info, input_data)
    checkout = create_checkout_model(cleaned_input)
    calculate_taxes(checkout)
    save_checkout(checkout)
    return CheckoutCreateSuccess(checkout=checkout)`,
      },
      source: 'lain',
    };
  });

  // Assessments List & Detail (Scene 4)
  const PR_1142_REPORT = {
    id: 'asm_saleor_pr_1142',
    orgId: 'ws_saleor',
    inputDigest: 'sha256:d8a9f02c771be5a0c8b6d3e8fa9128f6451e018d',
    status: 'ready',
    baseId: 'a3184854',
    headId: 'e4f8101a',
    title: 'PR #1142: Add delivery note to checkout API',
    repo: 'saleor',
    createdAt: Date.now() - 3600_000,
    severity: 'breaking',
    impact: 'breaking',
    affectedServices: ['saleor-storefront', 'saleor-dashboard'],
    findingsCount: 2,
    manifest: {
      repo: 'saleor',
      base: 'a3184854',
      head: 'e4f8101a',
      pr: {
        url: 'https://github.com/saleor/saleor/pull/1142',
        title: 'Add delivery note to checkout API',
        number: 1142,
        author: 'exsepue_bci',
      },
    },
    findings: [
      {
        kind: 'breaking_change',
        route: 'graphql:mutation:checkoutCreate',
        service: 'saleor-api',
        endpoint: { key: 'graphql:mutation:checkoutCreate', service: 'saleor-api' },
        impact: {
          class: 'breaking',
          reasons: ['Required argument `deliveryNote: String!` added to mutation `checkoutCreate` without default value.'],
        },
        affected: [
          { service: 'saleor-storefront', class: 'compile_error', consumer: 'saleor-storefront' },
          { service: 'saleor-dashboard', class: 'type_mismatch', consumer: 'saleor-dashboard' },
        ],
      },
      {
        kind: 'field_deprecation',
        route: 'graphql:mutation:checkoutShippingAddressUpdate',
        service: 'saleor-api',
        endpoint: { key: 'graphql:mutation:checkoutShippingAddressUpdate', service: 'saleor-api' },
        impact: {
          class: 'warning',
          reasons: ['Field `note` deprecated: use `deliveryNote` on checkoutCreate instead.'],
        },
        affected: [
          { service: 'saleor-storefront', class: 'warning', consumer: 'saleor-storefront' },
        ],
      },
    ],
    codeImpact: {
      baseSha: 'a3184854',
      headSha: 'e4f8101a',
      touchedSymbols: [
        'saleor.graphql.checkout.mutations.checkout_create.checkout_create',
        'saleor.checkout.models.Checkout.delivery_note',
      ],
      blastRadius: {
        directDependents: 4,
        transitiveDependents: 12,
        crossRepoDependents: 2,
      },
    },
    coverage: {
      complete: true,
      summary: '3 repos reviewed (saleor, saleor-dashboard, storefront), 0 unreviewed',
      scope: {
        reviewed: ['saleor', 'saleor-dashboard', 'storefront'],
        unreviewed: [],
        excluded: [],
      },
    },
    evidence: [
      {
        id: 'ev_1',
        viewId: 'v1',
        repo: 'storefront',
        sha: '05641e1f',
        path: 'src/checkout/useCheckout.ts',
        range: { start: 42, end: 50 },
        hash: 'hash_useCheckout',
      },
    ],
    explanation: {
      status: 'available',
      revision: 1,
      model: 'nvidia/nemotron-3-super-120b-a12b',
      text: `### Nemotron Architectural Impact Assessment

**PR #1142:** Add delivery note to checkout API

**Downstream Blast Radius:**
The change adds a non-null parameter \`deliveryNote: String!\` to mutation \`checkoutCreate\` in \`saleor-api\`.
Static analysis detected **2 affected consumer repositories**:

1. **saleor-storefront** (\`src/checkout/useCheckout.ts:84\`):
   - **Severity: Breaking (Compile & Runtime Error)**
   - The storefront's GraphQL mutation document omits \`deliveryNote\`, causing backend request validation failure upon checkout creation.

2. **saleor-dashboard** (\`src/orders/views/OrderDetails.tsx:112\`):
   - **Severity: Warning / Type Mismatch**
   - The admin checkout detail view has not been updated to display the incoming delivery note attribute.

**Recommendation:** Update the storefront mutation query document in repo \`storefront\` before merging PR #1142.`,
    },
  };

  app.get('/api/assessments', async () => ({
    assessments: [PR_1142_REPORT],
  }));

  app.get('/api/assessments/:id', async () => ({
    assessment: PR_1142_REPORT,
  }));

  app.get('/api/assessments/:id/events', async () => ({
    events: [
      { type: 'start', timestamp: Date.now() - 3600_000 },
      { type: 'diff', files: 3, timestamp: Date.now() - 3590_000 },
      { type: 'analysis', findings: 2, timestamp: Date.now() - 3580_000 },
      { type: 'done', timestamp: Date.now() - 3570_000 },
    ],
  }));

  // Conversations & History (Scene 5 under the hood)
  app.get('/api/conversations', async () => ({
    conversations: [
      {
        id: 'conv_demo_pitch',
        workspaceId: 'ws_saleor',
        title: 'Which services consume the checkout API, and from which repos?',
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now(),
        turns: 1,
      },
    ],
  }));

  app.get('/api/conversations/:id', async () => ({
    conversation: {
      id: 'conv_demo_pitch',
      workspaceId: 'ws_saleor',
      title: 'Which services consume the checkout API, and from which repos?',
      createdAt: Date.now() - 120_000,
    },
    turns: [
      {
        seq: 1,
        question: 'Which services consume the checkout API, and from which repos?',
        answer: SCENARIOS[0].response.answer as string,
        status: 'available',
        claims: SCENARIOS[0].response.claims,
        focus: SCENARIOS[0].response.map_focus,
        model: 'nvidia/nemotron-3-super-120b-a12b',
        createdAt: Date.now() - 100_000,
      },
    ],
  }));

  // ── 4. Streaming Query Handler (Scene 2 in Pitch Video) ────────────────────

  app.post('/api/query/stream', async (req, reply) => {
    const { question } = (req.body ?? {}) as { question?: string };
    const q = (question ?? '').trim();

    const scenario = SCENARIOS.find((s) => s.matches(q)) ?? fallbackScenario(q);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    });

    const sendSse = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Emit live progress steps with configured delays
    for (const step of scenario.progressSteps) {
      await new Promise((r) => setTimeout(r, step.delayMs));
      sendSse('progress', step);
    }

    // Small pause before final verified result
    await new Promise((r) => setTimeout(r, 600));
    sendSse('result', scenario.response);
    reply.raw.end();
  });

  // Non-streaming query fallback
  app.post('/api/query', async (req) => {
    const { question } = (req.body ?? {}) as { question?: string };
    const q = (question ?? '').trim();
    const scenario = SCENARIOS.find((s) => s.matches(q)) ?? fallbackScenario(q);
    return scenario.response;
  });

  return app;
}

// ── 5. Run Server if executed directly ───────────────────────────────────────

async function main() {
  const app = await buildDemoServer();
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🚀 Parallax Scripted Demo Mock Server is running at http://${HOST}:${PORT}`);
  console.log(`📡 Ready for Playwright video recording and UI interaction.\n`);
  console.log(`  • Org URL: http://localhost:5173/orgs/ws_saleor`);
  console.log(`  • Video Script Scene 2: "Which services consume the checkout API, and from which repos?"`);
  console.log(`  • Test Guide Scenarios 1-4 supported out-of-the-box.`);
}

const isMain = process.argv[1]?.endsWith('demo-mock-server.ts');
if (isMain) {
  main().catch((err) => {
    console.error('Failed to start demo mock server:', err);
    process.exit(1);
  });
}
