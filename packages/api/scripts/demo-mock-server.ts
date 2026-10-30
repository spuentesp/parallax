/**
 * Scripted Mock Server for Parallax Demo Video & NVIDIA Stack Use Cases
 * 
 * Provides deterministic, high-fidelity responses for NVIDIA agent architectures:
 * 1. Cluster A (ws_cluster_a):
 *    - OpenShell gRPC proto surface (proto/openshell/v1/sandbox.proto)
 *    - Python SDK client
 *    - Cross-repo consumers: NeMo-Fabric (sandbox runner) and NemoClaw (session router)
 * 2. Cluster B (ws_cluster_b):
 *    - NeMo Agent Toolkit (NAT) HTTP & WebSocket runtime endpoints (/chat/stream, /chat, /websocket)
 *    - NeMo-Agent-Toolkit-UI reverse proxy
 *    - NeMo-Agent-Toolkit-Examples client
 * 
 * Video Scenes supported:
 * - Scene 1: Multi-repo architecture map (OpenShell, NeMo-Fabric, NemoClaw).
 * - Scene 2: Live streaming Nemotron investigation with engine tool calls:
 *   "Which services consume the OpenShell gateway gRPC API, and from which repos?"
 *   Badges: Verified, Contradicted, Unverifiable + "Show on map" camera glide.
 * - Scene 3: Canvas hierarchy, deterministic vs inferred filtering, and CallStackStepper
 *   (create_sandbox, spawn_container, anchor score 0.96).
 * - Scene 4: PR Assessment blast radius report:
 *   PR #42 "Add mandatory security context to SandboxService.CreateSandbox"
 *   Downstream impacted services: nemo-fabric, nemoclaw.
 * - Scene 5: Audit drawer / Nemotron Super 120B planner + 3.5 Lightning worker tokens.
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

// ── 1. Cluster A: OpenShell RPC Architecture Graph ──────────────────────────

const CLUSTER_A_NODES: OrgNode[] = [
  // Repositories
  {
    id: 'repo:openshell',
    label: 'OpenShell',
    kind: 'repo',
    parent: null,
    meta: { repo: 'OpenShell', lainRepoId: 'OpenShell' },
  },
  {
    id: 'repo:nemo-fabric',
    label: 'NeMo-Fabric',
    kind: 'repo',
    parent: null,
    meta: { repo: 'NeMo-Fabric', lainRepoId: 'NeMo-Fabric' },
  },
  {
    id: 'repo:nemoclaw',
    label: 'NemoClaw',
    kind: 'repo',
    parent: null,
    meta: { repo: 'NemoClaw', lainRepoId: 'NemoClaw' },
  },

  // Services
  {
    id: 'svc:openshell-gateway',
    label: 'openshell-gateway',
    kind: 'service',
    parent: 'repo:openshell',
    meta: { service: 'openshell-gateway', repo: 'OpenShell', env: ['OPENSHELL_GATEWAY'] },
  },
  {
    id: 'svc:openshell-sdk',
    label: 'openshell-sdk',
    kind: 'service',
    parent: 'repo:openshell',
    meta: { service: 'openshell-sdk', repo: 'OpenShell' },
  },
  {
    id: 'svc:nemo-fabric',
    label: 'nemo-fabric',
    kind: 'service',
    parent: 'repo:nemo-fabric',
    meta: { service: 'nemo-fabric', repo: 'NeMo-Fabric' },
  },
  {
    id: 'svc:nemoclaw',
    label: 'nemoclaw',
    kind: 'service',
    parent: 'repo:nemoclaw',
    meta: { service: 'nemoclaw', repo: 'NemoClaw' },
  },

  // Groups under openshell-gateway
  {
    id: 'grp:sandbox-rpc',
    label: 'Sandbox gRPC Service (v1)',
    kind: 'group',
    parent: 'svc:openshell-gateway',
    meta: { group: 'sandbox-rpc', contracts: 3 },
  },
  {
    id: 'grp:gateway-rpc',
    label: 'Gateway Routing Service (v1)',
    kind: 'group',
    parent: 'svc:openshell-gateway',
    meta: { group: 'gateway-rpc', contracts: 2 },
  },

  // Endpoints under Sandbox gRPC Service
  {
    id: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
    label: 'rpc CreateSandbox',
    kind: 'endpoint',
    parent: 'grp:sandbox-rpc',
    contract: 'grpc',
    meta: {
      key: 'grpc:openshell.v1.SandboxService/CreateSandbox',
      service: 'openshell-gateway',
      repo: 'OpenShell',
      path: 'proto/openshell/v1/sandbox.proto',
    },
  },
  {
    id: 'ep:grpc:openshell.v1.SandboxService/Exec',
    label: 'rpc Exec',
    kind: 'endpoint',
    parent: 'grp:sandbox-rpc',
    contract: 'grpc',
    meta: {
      key: 'grpc:openshell.v1.SandboxService/Exec',
      service: 'openshell-gateway',
      repo: 'OpenShell',
      path: 'proto/openshell/v1/sandbox.proto',
    },
  },
  {
    id: 'ep:grpc:openshell.v1.SandboxService/DeleteSandbox',
    label: 'rpc DeleteSandbox',
    kind: 'endpoint',
    parent: 'grp:sandbox-rpc',
    contract: 'grpc',
    meta: {
      key: 'grpc:openshell.v1.SandboxService/DeleteSandbox',
      service: 'openshell-gateway',
      repo: 'OpenShell',
    },
  },

  // Endpoints under Gateway Routing
  {
    id: 'ep:grpc:openshell.v1.Gateway/Route',
    label: 'rpc Route',
    kind: 'endpoint',
    parent: 'grp:gateway-rpc',
    contract: 'grpc',
    meta: {
      key: 'grpc:openshell.v1.Gateway/Route',
      service: 'openshell-gateway',
      repo: 'OpenShell',
      path: 'proto/openshell/v1/gateway.proto',
    },
  },
  {
    id: 'ep:grpc:openshell.v1.Gateway/GetStatus',
    label: 'rpc GetStatus',
    kind: 'endpoint',
    parent: 'grp:gateway-rpc',
    contract: 'grpc',
    meta: {
      key: 'grpc:openshell.v1.Gateway/GetStatus',
      service: 'openshell-gateway',
      repo: 'OpenShell',
    },
  },
];

const CLUSTER_A_EDGES: OrgEdge[] = [
  // Proven deterministic edges (Solid lines, 1.0 confidence)
  {
    id: 'edge:nemo-fabric->CreateSandbox',
    source: 'svc:nemo-fabric',
    target: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 6,
    deterministicCount: 6,
    inferredCount: 0,
    fields: ['sandbox_id', 'spec', 'auth_token', 'cluster_id'],
    sites: [{ repo: 'NeMo-Fabric', path: 'src/fabric/sandbox_runner.py', line: 128 }],
  },
  {
    id: 'edge:CreateSandbox->gateway',
    source: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
    target: 'svc:openshell-gateway',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:sdk->Exec',
    source: 'svc:openshell-sdk',
    target: 'ep:grpc:openshell.v1.SandboxService/Exec',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 4,
    deterministicCount: 4,
    inferredCount: 0,
    fields: ['cmd', 'env', 'timeout'],
    sites: [{ repo: 'OpenShell', path: 'python/openshell/client.py', line: 74 }],
  },
  {
    id: 'edge:Exec->gateway',
    source: 'ep:grpc:openshell.v1.SandboxService/Exec',
    target: 'svc:openshell-gateway',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },

  // Inferred heuristic edges (Dashed lines, lower confidence)
  {
    id: 'edge:nemoclaw->Route',
    source: 'svc:nemoclaw',
    target: 'ep:grpc:openshell.v1.Gateway/Route',
    kind: 'consumes',
    provenance: 'inferred',
    confidence: 0.78,
    count: 3,
    deterministicCount: 0,
    inferredCount: 3,
    fields: ['target_cluster', 'session_id'],
    sites: [{ repo: 'NemoClaw', path: 'crates/nemoclaw-router/src/lib.rs', line: 89 }],
  },
  {
    id: 'edge:Route->gateway',
    source: 'ep:grpc:openshell.v1.Gateway/Route',
    target: 'svc:openshell-gateway',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:nemoclaw->CreateSandbox',
    source: 'svc:nemoclaw',
    target: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
    kind: 'consumes',
    provenance: 'inferred',
    confidence: 0.62,
    count: 2,
    deterministicCount: 0,
    inferredCount: 2,
    fields: ['spec'],
    sites: [{ repo: 'NemoClaw', path: 'crates/nemoclaw-node/src/worker.rs', line: 215 }],
  },
];

// ── 2. Cluster B: NeMo Agent Toolkit (NAT) Graph ────────────────────────────

const CLUSTER_B_NODES: OrgNode[] = [
  {
    id: 'repo:nat',
    label: 'NeMo-Agent-Toolkit',
    kind: 'repo',
    parent: null,
    meta: { repo: 'NeMo-Agent-Toolkit', lainRepoId: 'NeMo-Agent-Toolkit' },
  },
  {
    id: 'repo:nat-ui',
    label: 'NeMo-Agent-Toolkit-UI',
    kind: 'repo',
    parent: null,
    meta: { repo: 'NeMo-Agent-Toolkit-UI', lainRepoId: 'NeMo-Agent-Toolkit-UI' },
  },
  {
    id: 'repo:nat-examples',
    label: 'NeMo-Agent-Toolkit-Examples',
    kind: 'repo',
    parent: null,
    meta: { repo: 'NeMo-Agent-Toolkit-Examples', lainRepoId: 'NeMo-Agent-Toolkit-Examples' },
  },
  {
    id: 'svc:nat',
    label: 'nat (Agent Runtime Backend)',
    kind: 'service',
    parent: 'repo:nat',
    meta: { service: 'nat', repo: 'NeMo-Agent-Toolkit', env: ['NAT_BACKEND_URL', 'NAT_SERVER_URL'] },
  },
  {
    id: 'svc:nat-ui',
    label: 'nat-ui (Interactive Web App)',
    kind: 'service',
    parent: 'repo:nat-ui',
    meta: { service: 'nat-ui', repo: 'NeMo-Agent-Toolkit-UI' },
  },
  {
    id: 'svc:nat-examples',
    label: 'nat-examples',
    kind: 'service',
    parent: 'repo:nat-examples',
    meta: { service: 'nat-examples', repo: 'NeMo-Agent-Toolkit-Examples' },
  },
  {
    id: 'grp:nat-runtime',
    label: 'Agent Runtime Endpoints',
    kind: 'group',
    parent: 'svc:nat',
    meta: { group: 'nat-runtime', contracts: 3 },
  },
  {
    id: 'ep:http:POST /chat/stream',
    label: 'POST /chat/stream',
    kind: 'endpoint',
    parent: 'grp:nat-runtime',
    contract: 'http',
    meta: { key: 'http:POST /chat/stream', service: 'nat', path: 'nat/server/app.py' },
  },
  {
    id: 'ep:http:POST /chat',
    label: 'POST /chat',
    kind: 'endpoint',
    parent: 'grp:nat-runtime',
    contract: 'http',
    meta: { key: 'http:POST /chat', service: 'nat' },
  },
  {
    id: 'ep:ws:/websocket',
    label: 'ws /websocket',
    kind: 'endpoint',
    parent: 'grp:nat-runtime',
    contract: 'websocket',
    meta: { key: 'ws:/websocket', service: 'nat' },
  },
];

const CLUSTER_B_EDGES: OrgEdge[] = [
  {
    id: 'edge:nat-ui->chat-stream',
    source: 'svc:nat-ui',
    target: 'ep:http:POST /chat/stream',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 5,
    deterministicCount: 5,
    inferredCount: 0,
    sites: [{ repo: 'NeMo-Agent-Toolkit-UI', path: 'proxy/server.js', line: 44 }],
  },
  {
    id: 'edge:chat-stream->nat',
    source: 'ep:http:POST /chat/stream',
    target: 'svc:nat',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:nat-ui->ws',
    source: 'svc:nat-ui',
    target: 'ep:ws:/websocket',
    kind: 'consumes',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 2,
    deterministicCount: 2,
    inferredCount: 0,
    sites: [{ repo: 'NeMo-Agent-Toolkit-UI', path: 'src/lib/socket.ts', line: 18 }],
  },
  {
    id: 'edge:ws->nat',
    source: 'ep:ws:/websocket',
    target: 'svc:nat',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
  {
    id: 'edge:nat-examples->chat',
    source: 'svc:nat-examples',
    target: 'ep:http:POST /chat',
    kind: 'consumes',
    provenance: 'inferred',
    confidence: 0.85,
    count: 4,
    deterministicCount: 0,
    inferredCount: 4,
  },
  {
    id: 'edge:chat->nat',
    source: 'ep:http:POST /chat',
    target: 'svc:nat',
    kind: 'servedBy',
    provenance: 'deterministic',
    confidence: 1.0,
    count: 1,
    deterministicCount: 1,
    inferredCount: 0,
  },
];

function getGraphForWorkspace(wsId?: string): { nodes: OrgNode[]; edges: OrgEdge[] } {
  if (wsId?.includes('cluster_b') || wsId?.includes('nat')) {
    return { nodes: CLUSTER_B_NODES, edges: CLUSTER_B_EDGES };
  }
  return { nodes: CLUSTER_A_NODES, edges: CLUSTER_A_EDGES };
}

// ── 3. Scripted NVIDIA Answers for Demo Video & Use Cases ───────────────────

interface ScriptedScenario {
  matches: (q: string, wsId?: string) => boolean;
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
  // Scene 2 Video Pitch: "Which services consume the OpenShell gateway gRPC API, and from which repos?"
  {
    matches: (q) => /openshell|gateway|sandbox|which services consume.*openshell|grpc/i.test(q),
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
        summary: 'query openshell-gateway gRPC service & consumer bindings',
        ok: true,
        ms: 135,
        delayMs: 1200,
      },
      {
        type: 'tool',
        tool: 'list_contracts',
        summary: 'inspect protobuf contracts in proto/openshell/v1',
        ok: true,
        ms: 92,
        delayMs: 1100,
      },
      {
        type: 'tool',
        tool: 'get_call_chain',
        summary: 'trace CreateSandbox RPC call from NeMo-Fabric runner to gateway',
        ok: true,
        ms: 158,
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
      answer: `The **OpenShell Gateway gRPC API** provided by **openshell-gateway** (repo: \`OpenShell\`) is consumed across two separate repositories in the NVIDIA stack:

1. **nemo-fabric** (repo: \`NeMo-Fabric\`):
   - Consumes the \`CreateSandbox\` RPC (\`grpc:openshell.v1.SandboxService/CreateSandbox\`) to spawn and orchestrate isolated agent execution environments.
   - Proven by **deterministic static analysis** with 100% confidence from runner client stubs in \`src/fabric/sandbox_runner.py:128\`.

2. **nemoclaw** (repo: \`NemoClaw\`):
   - Consumes gateway routing and sandbox dispatching (\`grpc:openshell.v1.Gateway/Route\`).
   - Relationship is **inferred** with confidence 0.78 based on Rust gRPC client stubs in \`crates/nemoclaw-router/\`.

Additionally, **openshell-sdk** (internal to repo \`OpenShell\`) consumes the \`Exec\` RPC method for Python SDK client sessions.

**Engine Verification:** The static analysis engine confirmed that \`openshell-gateway\` maintains **zero downstream dependencies** back into \`NeMo-Fabric\` or \`NemoClaw\`.`,
      explanation_status: 'available',
      claims: [
        {
          claim: {
            kind: 'relation',
            consumer: 'nemo-fabric',
            provider: 'openshell-gateway',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: {
            uses: 6,
            endpoints: ['grpc:openshell.v1.SandboxService/CreateSandbox'],
          },
          reason: 'Engine verified: 6 calls in NeMo-Fabric to SandboxService.CreateSandbox',
        },
        {
          claim: {
            kind: 'relation',
            consumer: 'nemoclaw',
            provider: 'openshell-gateway',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: {
            uses: 3,
            endpoints: ['grpc:openshell.v1.Gateway/Route'],
          },
          reason: 'Engine verified: 3 calls in NemoClaw to Gateway.Route',
        },
        {
          claim: {
            kind: 'relation',
            consumer: 'openshell-gateway',
            provider: 'nemo-fabric',
            polarity: 'absent',
          },
          verdict: 'verified',
          engine: {
            uses: 0,
            endpoints: [],
          },
          reason: 'Engine verified: no reverse dependency from gateway to fabric',
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
        seed: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
        ids: [
          'svc:openshell-gateway',
          'svc:nemo-fabric',
          'svc:nemoclaw',
          'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
          'grp:sandbox-rpc',
        ],
        relations: [
          {
            consumer: 'nemo-fabric',
            provider: 'openshell-gateway',
            polarity: 'present',
            uses: 6,
            endpoints: ['grpc:openshell.v1.SandboxService/CreateSandbox'],
            complete: true,
          },
        ],
        query: 'openshell-gateway',
      },
      conversation: { id: 'conv_demo_openshell', seq: 1 },
      budget: {
        maxToolCalls: 8,
        maxModelMs: 120000,
        toolCallsUsed: 3,
        modelMsUsed: 1820,
        exhausted: false,
        cutShort: false,
        rounds: 2,
        promptTokens: 16420,
        completionTokens: 345,
      },
      model: 'nvidia/nemotron-3-super-120b-a12b',
      tool_calls: [
        {
          id: 'call_1',
          tool: 'get_service',
          args: { service: 'openshell-gateway', snapshot: 'live' },
          output: 'Found 2 external consumers: nemo-fabric (6 uses), nemoclaw (3 uses)',
        },
        {
          id: 'call_2',
          tool: 'list_contracts',
          args: { service: 'openshell-gateway', kind: 'grpc' },
          output: 'Found SandboxService/CreateSandbox, Exec, DeleteSandbox, Gateway/Route',
        },
        {
          id: 'call_3',
          tool: 'get_call_chain',
          args: { from: 'sandbox_runner.py', to: 'CreateSandbox', repo_id: 'NeMo-Fabric' },
          output: 'sandbox_runner.py:128 -> grpc_client.CreateSandbox -> openshell-gateway',
        },
      ],
    },
  },

  // Cluster B / NAT: "Which services consume the NeMo Agent Toolkit endpoints, and from which repos?"
  {
    matches: (q) => /nat|toolkit|who dials.*nat|chat\/stream|dials.*nat/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 500 },
      { type: 'tool', tool: 'get_service', summary: 'read nat agent runtime HTTP & WebSocket consumers', ok: true, ms: 110, delayMs: 1000 },
      { type: 'tool', tool: 'list_contracts', summary: 'inspect /chat/stream and /websocket contracts', ok: true, ms: 80, delayMs: 900 },
      { type: 'verify', claims: 2, delayMs: 600 },
    ],
    response: {
      answer: `The **NeMo Agent Toolkit backend (\`nat\`)** in repo \`NeMo-Agent-Toolkit\` is consumed across two companion repositories:

1. **nat-ui** (repo: \`NeMo-Agent-Toolkit-UI\`):
   - Proxies interactive chat streaming via \`http:POST /chat/stream\` (\`proxy/server.js:44\`).
   - Manages real-time bi-directional agent telemetry over \`ws:/websocket\`.
   - Relationships are **proven by static analysis** (100% confidence) matching \`UPSTREAM_HTTP_ORIGIN\`.

2. **nat-examples** (repo: \`NeMo-Agent-Toolkit-Examples\`):
   - Consumes \`http:POST /chat\` for automated workflow evaluation benchmarks.
   - Relationship is **inferred** (85% confidence) from sample orchestration scripts.`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'relation', consumer: 'nat-ui', provider: 'nat', polarity: 'present' },
          verdict: 'verified',
          engine: { uses: 7, endpoints: ['http:POST /chat/stream', 'ws:/websocket'] },
          reason: 'Engine verified: 7 calls in nat-ui to nat streaming & websocket endpoints',
        },
        {
          claim: { kind: 'relation', consumer: 'nat-examples', provider: 'nat', polarity: 'present' },
          verdict: 'verified',
          engine: { uses: 4, endpoints: ['http:POST /chat'] },
          reason: 'Engine verified: 4 calls in nat-examples to nat /chat endpoint',
        },
      ],
      claims_summary: { total: 2, verified: 2, contradicted: 0, unverifiable: 0, supported: 2, unsupported: 0 },
      map_focus: {
        seed: 'ep:http:POST /chat/stream',
        ids: ['svc:nat', 'svc:nat-ui', 'svc:nat-examples', 'ep:http:POST /chat/stream', 'ep:ws:/websocket'],
        relations: [{ consumer: 'nat-ui', provider: 'nat', polarity: 'present', uses: 7, endpoints: ['http:POST /chat/stream'], complete: true }],
        query: 'nat',
      },
      conversation: { id: 'conv_demo_nat', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 2, modelMsUsed: 1100, exhausted: false, cutShort: false, rounds: 1, promptTokens: 9800, completionTokens: 280 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  },

  // Onboarding Chapter 1 & 6 Task: Telemetry & auth checks in OpenShell Gateway
  {
    matches: (q) => /telemetry|auth checks|sandbox creation|trace sandbox/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool', tool: 'get_code_snippet', summary: 'read crates/openshell-gateway/src/sandbox.rs around create_sandbox', ok: true, ms: 90, delayMs: 800 },
      { type: 'tool', tool: 'get_call_chain', summary: 'trace caller chain: handle_grpc_request -> create_sandbox -> spawn_container', ok: true, ms: 120, delayMs: 900 },
      { type: 'verify', claims: 2, delayMs: 500 },
    ],
    response: {
      answer: `To add telemetry and authentication checks to sandbox creation:

1. **Target Function in Gateway:**
   - \`crates/openshell-gateway/src/sandbox.rs:48\`: function \`create_sandbox(req: CreateSandboxRequest)\`.
   - This function has an **anchor score of 0.96** as the primary entry point for all remote sandbox provisioning.

2. **Incoming Call Stack:**
   - \`handle_grpc_request\` → \`create_sandbox\` → \`spawn_container\`.
   - Upstream consumers: \`NeMo-Fabric\` (\`sandbox_runner.py\`) and \`NemoClaw\` (\`worker.rs\`).

3. **Recommended Implementation:**
   - Add auth token header extraction in \`crates/openshell-gateway/src/middleware/auth.rs\`.
   - Emit telemetry counters in \`create_sandbox\` before calling \`spawn_container\`.`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'location', repo: 'OpenShell', path: 'crates/openshell-gateway/src/sandbox.rs', line: 48, contains: 'pub async fn create_sandbox' },
          verdict: 'verified',
          reason: 'Engine verified: function definition exists at line 48',
        },
      ],
      claims_summary: { total: 1, verified: 1, contradicted: 0, unverifiable: 0, supported: 1, unsupported: 0 },
      map_focus: {
        seed: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
        ids: ['svc:openshell-gateway', 'ep:grpc:openshell.v1.SandboxService/CreateSandbox'],
        relations: [],
        query: 'create_sandbox',
      },
      conversation: { id: 'conv_demo_telemetry', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 2, modelMsUsed: 890, exhausted: false, cutShort: false, rounds: 1, promptTokens: 6400, completionTokens: 210 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  },
];

function fallbackScenario(question: string) {
  return {
    progressSteps: [
      { type: 'round' as const, round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 400 },
      { type: 'tool' as const, tool: 'get_service', summary: 'read OpenShell & NeMo architecture mesh', ok: true, ms: 110, delayMs: 700 },
      { type: 'verify' as const, claims: 1, delayMs: 500 },
    ],
    response: {
      answer: `Static analysis of the **NVIDIA agent stack** demonstrates clear service boundaries: **openshell-gateway** provides core container and sandbox isolation via gRPC, consumed by **NeMo-Fabric** and **NemoClaw**. All cross-repo bindings are verified against source code definitions.`,
      explanation_status: 'available',
      claims: [
        {
          claim: { kind: 'relation', consumer: 'nemo-fabric', provider: 'openshell-gateway', polarity: 'present' },
          verdict: 'verified',
          engine: { uses: 6, endpoints: ['grpc:openshell.v1.SandboxService/CreateSandbox'] },
          reason: 'Engine verified: active gRPC contracts in NeMo-Fabric',
        },
      ],
      claims_summary: { total: 1, verified: 1, contradicted: 0, unverifiable: 0, supported: 1, unsupported: 0 },
      map_focus: {
        seed: 'svc:openshell-gateway',
        ids: ['svc:openshell-gateway', 'svc:nemo-fabric', 'svc:nemoclaw'],
        relations: [],
        query: question,
      },
      conversation: { id: 'conv_demo_gen', seq: 1 },
      budget: { maxToolCalls: 8, maxModelMs: 120000, toolCallsUsed: 1, modelMsUsed: 800, exhausted: false, cutShort: false, rounds: 1, promptTokens: 5200, completionTokens: 140 },
      model: 'nvidia/nemotron-3-super-120b-a12b',
    },
  };
}

// ── 4. Build Fastify App ─────────────────────────────────────────────────────

export async function buildDemoServer() {
  const app = Fastify({ logger: { level: 'info' } });

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
    lainAdapter: 'real',
    version: '0.13.0-nvidia',
    clusters: ['ws_cluster_a', 'ws_cluster_b'],
  }));

  // WhoAmI (Always signed in as Lead Architect on ws_cluster_a)
  app.get('/api/whoami', async () => ({
    orgId: 'ws_cluster_a',
    scopes: ['read', 'write', 'admin'],
    readOnly: false,
  }));

  // Workspaces & Orgs (EXACTLY the two NVIDIA clusters)
  const WORKSPACE_A = {
    id: 'ws_cluster_a',
    name: 'Cluster A: OpenShell RPC Stack',
    description: 'OpenShell gRPC proto surface joined with Python SDK and NeMo-Fabric / NemoClaw cross-repo consumers.',
    lainUrl: 'http://localhost:9999/mcp',
    repoCount: 3,
    repos: [
      { id: 'repo_openshell', uri: 'https://github.com/NVIDIA/OpenShell.git', sha: 'cc999543', local: './test-repos/nvidia/OpenShell' },
      { id: 'repo_nemo_fabric', uri: 'https://github.com/NVIDIA/NeMo-Fabric.git', sha: '4fdf65a4', local: './test-repos/nvidia/NeMo-Fabric' },
      { id: 'repo_nemoclaw', uri: 'https://github.com/NVIDIA/NemoClaw.git', sha: 'de009775', local: './test-repos/nvidia/NemoClaw' },
    ],
  };

  const WORKSPACE_B = {
    id: 'ws_cluster_b',
    name: 'Cluster B: NeMo Agent Toolkit HTTP Stack',
    description: 'NeMo Agent Toolkit HTTP & WebSocket runtime endpoints, Next.js API routes, and UI reverse proxy.',
    lainUrl: 'http://localhost:9999/mcp',
    repoCount: 3,
    repos: [
      { id: 'repo_nat', uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit.git', sha: '3ec11d6f', local: './test-repos/nvidia/NeMo-Agent-Toolkit' },
      { id: 'repo_nat_ui', uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit-UI.git', sha: '41cb8cf8', local: './test-repos/nvidia/NeMo-Agent-Toolkit-UI' },
      { id: 'repo_nat_examples', uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples.git', sha: 'eadbb757', local: './test-repos/nvidia/NeMo-Agent-Toolkit-Examples' },
    ],
  };

  app.get('/api/orgs', async () => ({
    orgs: [WORKSPACE_A, WORKSPACE_B],
  }));

  app.get('/api/workspaces', async () => ({
    workspaces: [WORKSPACE_A, WORKSPACE_B],
  }));

  app.get('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (id.includes('cluster_b') || id.includes('nat')) {
      return { workspace: WORKSPACE_B };
    }
    return { workspace: WORKSPACE_A };
  });

  app.get('/api/workspaces/:id/ci', async () => ({
    mode: 'on-open-and-update',
    baseBranch: 'main',
    reportComments: true,
  }));

  app.get('/api/workspaces/:id/prs', async () => ({
    prs: [
      {
        provider: 'github',
        repoId: 'repo_openshell',
        repoUri: 'https://github.com/NVIDIA/OpenShell.git',
        number: 42,
        title: 'Add mandatory security context to SandboxService.CreateSandbox',
        author: 'exsepue_bci',
        url: 'https://github.com/NVIDIA/OpenShell/pull/42',
        headSha: 'f8d39a1c',
        baseBranch: 'main',
        updatedAt: new Date().toISOString(),
      },
    ],
  }));

  // Map View
  app.post('/api/workspaces/:id/map/view', async (req) => {
    const { id: wsId } = req.params as { id: string };
    const { nodes: allNodes, edges: allEdges } = getGraphForWorkspace(wsId);

    const body = (req.body ?? {}) as {
      expand?: string[];
      filters?: {
        contract?: string;
        provenance?: 'deterministic' | 'inferred';
        minConfidence?: number;
        service?: string;
        includeStandalone?: boolean;
      };
      focus?: string;
    };

    const expand = new Set(body.expand ?? []);
    // Auto expand top repositories and main services
    for (const n of allNodes) {
      if (n.kind === 'repo' || n.kind === 'service') expand.add(n.id);
    }

    let filteredNodes = allNodes;
    let filteredEdges = allEdges;

    if (body.filters?.provenance) {
      filteredEdges = filteredEdges.filter((e) => e.provenance === body.filters?.provenance);
    }
    if (body.filters?.minConfidence !== undefined) {
      filteredEdges = filteredEdges.filter((e) => e.confidence >= (body.filters?.minConfidence ?? 0));
    }
    if (body.filters?.contract) {
      filteredNodes = filteredNodes.filter((n) => !n.contract || n.contract === body.filters?.contract);
    }

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
    const { id: wsId } = req.params as { id: string };
    const { id } = req.query as { id: string };
    const { nodes: allNodes, edges: allEdges } = getGraphForWorkspace(wsId);

    const node = allNodes.find((n) => n.id === id);
    if (!node) return { detail: null, meta: { source: 'lain' } };

    const children = allNodes.filter((n) => n.parent === id);
    const path: OrgNode[] = [];
    let cur = node.parent ? allNodes.find((n) => n.id === node.parent) : null;
    while (cur) {
      path.unshift(cur);
      cur = cur.parent ? allNodes.find((n) => n.id === cur.parent) : null;
    }

    const incomingEdges = allEdges.filter((e) => e.target === id);
    const outgoingEdges = allEdges.filter((e) => e.source === id);

    const consumers = incomingEdges.map((edge) => ({
      edge,
      peer: allNodes.find((n) => n.id === edge.source) ?? node,
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
    }));

    const providers = outgoingEdges.map((edge) => ({
      edge,
      peer: allNodes.find((n) => n.id === edge.target) ?? node,
      links: [
        {
          endpoint: allNodes.find((n) => n.id === edge.target) ?? node,
          provenance: edge.provenance,
          confidence: edge.confidence,
          count: edge.count,
          fields: edge.fields ?? [],
          sites: edge.sites ?? [],
        },
      ],
      hiddenLinks: 0,
    }));

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
  app.get('/api/workspaces/:id/map/briefing', async (req) => {
    const { id: wsId } = req.params as { id: string };
    if (wsId.includes('cluster_b') || wsId.includes('nat')) {
      return {
        briefing: {
          totals: { repos: 3, services: 3, contracts: 3, relations: 2 },
          repos: [
            { id: 'repo:nat', name: 'NeMo-Agent-Toolkit', lainRepoId: 'NeMo-Agent-Toolkit', services: [{ id: 'svc:nat', name: 'nat', contracts: 3, groups: [{ key: 'runtime', label: 'Agent Runtime', count: 3 }] }] },
            { id: 'repo:nat-ui', name: 'NeMo-Agent-Toolkit-UI', lainRepoId: 'NeMo-Agent-Toolkit-UI', services: [{ id: 'svc:nat-ui', name: 'nat-ui', contracts: 0, groups: [] }] },
            { id: 'repo:nat-examples', name: 'NeMo-Agent-Toolkit-Examples', lainRepoId: 'NeMo-Agent-Toolkit-Examples', services: [{ id: 'svc:nat-examples', name: 'nat-examples', contracts: 0, groups: [] }] },
          ],
          relations: [{ from: 'nat-ui', to: 'nat', uses: 7, deterministic: 7, inferred: 0, contractsUsed: 2 }],
          hubs: [{ service: 'nat', repo: 'NeMo-Agent-Toolkit', consumerServices: 2, uses: 11 }],
          topOperations: [{ key: 'http:POST /chat/stream', service: 'nat', group: 'runtime', uses: 5, consumers: 1 }],
          gaps: [],
        },
        meta: { source: 'lain' },
      };
    }

    return {
      briefing: {
        totals: { repos: 3, services: 4, contracts: 5, relations: 3 },
        repos: [
          {
            id: 'repo:openshell',
            name: 'OpenShell',
            lainRepoId: 'OpenShell',
            services: [
              {
                id: 'svc:openshell-gateway',
                name: 'openshell-gateway',
                contracts: 5,
                groups: [
                  { key: 'sandbox-rpc', label: 'Sandbox gRPC Service', count: 3 },
                  { key: 'gateway-rpc', label: 'Gateway Routing Service', count: 2 },
                ],
              },
              { id: 'svc:openshell-sdk', name: 'openshell-sdk', contracts: 0, groups: [] },
            ],
          },
          {
            id: 'repo:nemo-fabric',
            name: 'NeMo-Fabric',
            lainRepoId: 'NeMo-Fabric',
            services: [{ id: 'svc:nemo-fabric', name: 'nemo-fabric', contracts: 0, groups: [] }],
          },
          {
            id: 'repo:nemoclaw',
            name: 'NemoClaw',
            lainRepoId: 'NemoClaw',
            services: [{ id: 'svc:nemoclaw', name: 'nemoclaw', contracts: 0, groups: [] }],
          },
        ],
        relations: [
          { from: 'nemo-fabric', to: 'openshell-gateway', uses: 6, deterministic: 6, inferred: 0, contractsUsed: 1 },
          { from: 'nemoclaw', to: 'openshell-gateway', uses: 3, deterministic: 0, inferred: 3, contractsUsed: 1 },
        ],
        hubs: [{ service: 'openshell-gateway', repo: 'OpenShell', consumerServices: 2, uses: 9 }],
        topOperations: [
          { key: 'grpc:openshell.v1.SandboxService/CreateSandbox', service: 'openshell-gateway', group: 'sandbox-rpc', uses: 6, consumers: 1 },
          { key: 'grpc:openshell.v1.Gateway/Route', service: 'openshell-gateway', group: 'gateway-rpc', uses: 3, consumers: 1 },
        ],
        gaps: [],
      },
      meta: { source: 'lain' },
    };
  });

  // Code Graph Root
  app.get('/api/workspaces/:id/graph', async (req) => {
    const { id: wsId } = req.params as { id: string };
    if (wsId.includes('cluster_b') || wsId.includes('nat')) {
      return {
        graph: {
          repos: [
            {
              repo: 'NeMo-Agent-Toolkit',
              truncated: false,
              nodes: [
                { id: 'f:app.py', name: 'nat/server/app.py', type: 'File', kind: 'file' },
                { id: 'fn:chat_stream', name: 'chat_stream_endpoint', type: 'Function', kind: 'symbol' },
              ],
            },
            {
              repo: 'NeMo-Agent-Toolkit-UI',
              truncated: false,
              nodes: [{ id: 'f:proxy.js', name: 'proxy/server.js', type: 'File', kind: 'file' }],
            },
          ],
        },
        source: 'lain',
        workspace: { id: 'ws_cluster_b', name: 'Cluster B: NeMo Agent Toolkit HTTP Stack', repoCount: 3 },
      };
    }

    return {
      graph: {
        repos: [
          {
            repo: 'OpenShell',
            truncated: false,
            nodes: [
              { id: 'f:sandbox.proto', name: 'proto/openshell/v1/sandbox.proto', type: 'File', kind: 'file' },
              { id: 'f:sandbox.rs', name: 'crates/openshell-gateway/src/sandbox.rs', type: 'File', kind: 'file' },
              { id: 'fn:create_sandbox', name: 'create_sandbox', type: 'Function', kind: 'symbol' },
              { id: 'fn:spawn_container', name: 'spawn_container', type: 'Function', kind: 'symbol' },
            ],
          },
          {
            repo: 'NeMo-Fabric',
            truncated: false,
            nodes: [
              { id: 'f:sandbox_runner.py', name: 'src/fabric/sandbox_runner.py', type: 'File', kind: 'file' },
            ],
          },
          {
            repo: 'NemoClaw',
            truncated: false,
            nodes: [
              { id: 'f:worker.rs', name: 'crates/nemoclaw-node/src/worker.rs', type: 'File', kind: 'file' },
            ],
          },
        ],
      },
      source: 'lain',
      workspace: { id: 'ws_cluster_a', name: 'Cluster A: OpenShell RPC Stack', repoCount: 3 },
    };
  });

  // Code Graph Children
  app.get('/api/workspaces/:id/graph/children', async (req) => {
    const { repo, name } = req.query as { repo: string; type: string; name: string };
    if (name.includes('sandbox') || name.includes('create_sandbox')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:create_sandbox', name: 'create_sandbox', type: 'Function', kind: 'symbol' },
          { id: 'fn:validate_security_context', name: 'validate_security_context', type: 'Function', kind: 'symbol' },
          { id: 'fn:spawn_container', name: 'spawn_container', type: 'Function', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:validate_security_context', name: 'validate_security_context', type: 'Function', kind: 'symbol' },
              { id: 'fn:spawn_container', name: 'spawn_container', type: 'Function', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }
    return { node: { repo, type: 'File', name }, children: [], communications: [], source: 'lain' };
  });

  // Symbol Context & CallStackStepper (Scene 3)
  app.get('/api/workspaces/:id/graph/symbol-context', async (req) => {
    const { repo, symbol } = req.query as { repo: string; symbol: string };
    if (symbol.includes('sandbox') || symbol === 'create_sandbox') {
      return {
        context: {
          symbol: 'create_sandbox',
          repo: 'OpenShell',
          path: 'crates/openshell-gateway/src/sandbox.rs',
          type: 'Function',
          anchorScore: 0.96,
          calledBy: ['handle_grpc_request', 'SandboxServiceServer'],
          calls: ['validate_security_context', 'spawn_container', 'allocate_ports'],
          rawText: `## Explanation for 'create_sandbox' (Function)\n**Path:** crates/openshell-gateway/src/sandbox.rs\n- **Anchor Score:** 0.96\n- **Called by:** handle_grpc_request, SandboxServiceServer\n- **Calls:** validate_security_context, spawn_container, allocate_ports`,
        },
        source: 'lain',
      };
    }
    return {
      context: {
        symbol,
        repo: repo ?? 'OpenShell',
        path: `src/${symbol}.rs`,
        type: 'Function',
        anchorScore: 0.82,
        calledBy: ['main'],
        calls: ['init_logger'],
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
        from: from ?? 'handle_grpc_request',
        to: to ?? 'spawn_container',
        repo: repo ?? 'OpenShell',
        chain: [from ?? 'handle_grpc_request', 'create_sandbox', to ?? 'spawn_container'],
        rawText: `${from} → create_sandbox → ${to}`,
      },
      source: 'lain',
    };
  });

  // Code Snippet
  app.get('/api/workspaces/:id/graph/snippet', async (req) => {
    const { symbol } = req.query as { repo: string; symbol: string };
    return {
      snippet: {
        symbol: symbol ?? 'create_sandbox',
        repo: 'OpenShell',
        path: 'crates/openshell-gateway/src/sandbox.rs',
        text: `pub async fn create_sandbox(
    &self,
    request: Request<CreateSandboxRequest>,
) -> Result<Response<CreateSandboxResponse>, Status> {
    let req = request.into_inner();
    self.validate_security_context(&req.security_context)?;
    let container = self.spawn_container(&req.spec).await?;
    let ports = self.allocate_ports(&container).await?;
    Ok(Response::new(CreateSandboxResponse {
        sandbox_id: container.id,
        status: SandboxStatus::Running as i32,
        endpoints: ports,
    }))
}`,
      },
      source: 'lain',
    };
  });

  // PR Assessment Blast Radius (Scene 4)
  const PR_42_OPENSHELL = {
    id: 'asm_openshell_pr_42',
    orgId: 'ws_cluster_a',
    inputDigest: 'sha256:7f901a2c3491baee05819dfb44917a23c004918e',
    status: 'ready',
    baseId: 'cc999543',
    headId: 'f8d39a1c',
    title: 'PR #42: Add mandatory security context to SandboxService.CreateSandbox',
    repo: 'OpenShell',
    createdAt: Date.now() - 3600_000,
    severity: 'breaking',
    impact: 'breaking',
    affectedServices: ['nemo-fabric', 'nemoclaw'],
    findingsCount: 2,
    manifest: {
      repo: 'OpenShell',
      base: 'cc999543',
      head: 'f8d39a1c',
      pr: {
        url: 'https://github.com/NVIDIA/OpenShell/pull/42',
        title: 'Add mandatory security context to SandboxService.CreateSandbox',
        number: 42,
        author: 'exsepue_bci',
      },
    },
    findings: [
      {
        kind: 'breaking_change',
        route: 'grpc:openshell.v1.SandboxService/CreateSandbox',
        service: 'openshell-gateway',
        endpoint: { key: 'grpc:openshell.v1.SandboxService/CreateSandbox', service: 'openshell-gateway' },
        impact: {
          class: 'breaking',
          reasons: ['Protobuf field `SecurityContext security_context = 4;` marked mandatory in `CreateSandboxRequest`.'],
        },
        affected: [
          { service: 'nemo-fabric', class: 'compile_error', consumer: 'nemo-fabric' },
          { service: 'nemoclaw', class: 'type_mismatch', consumer: 'nemoclaw' },
        ],
      },
      {
        kind: 'field_deprecation',
        route: 'grpc:openshell.v1.Gateway/Route',
        service: 'openshell-gateway',
        endpoint: { key: 'grpc:openshell.v1.Gateway/Route', service: 'openshell-gateway' },
        impact: {
          class: 'warning',
          reasons: ['Field `legacy_token` marked @deprecated(reason: "Use SecurityContext")'],
        },
        affected: [{ service: 'nemoclaw', class: 'warning', consumer: 'nemoclaw' }],
      },
    ],
    codeImpact: {
      baseSha: 'cc999543',
      headSha: 'f8d39a1c',
      touchedSymbols: [
        'openshell.v1.CreateSandboxRequest.security_context',
        'openshell_gateway::sandbox::create_sandbox',
      ],
      blastRadius: {
        directDependents: 4,
        transitiveDependents: 9,
        crossRepoDependents: 2,
      },
    },
    coverage: {
      complete: true,
      summary: '3 repos reviewed (OpenShell, NeMo-Fabric, NemoClaw), 0 unreviewed',
      scope: {
        reviewed: ['OpenShell', 'NeMo-Fabric', 'NemoClaw'],
        unreviewed: [],
        excluded: [],
      },
    },
    evidence: [
      {
        id: 'ev_proto_1',
        viewId: 'v1',
        repo: 'OpenShell',
        sha: 'cc999543',
        path: 'proto/openshell/v1/sandbox.proto',
        range: { start: 22, end: 35 },
        hash: 'hash_sandbox_proto',
      },
    ],
    explanation: {
      status: 'available',
      revision: 1,
      model: 'nvidia/nemotron-3-super-120b-a12b',
      text: `### Nemotron Architectural Impact Assessment

**PR #42:** Add mandatory security context to SandboxService.CreateSandbox

**Downstream Blast Radius:**
The pull request modifies the core gRPC schema in \`proto/openshell/v1/sandbox.proto\`, making \`security_context\` mandatory on \`CreateSandboxRequest\`.
Static analysis identified **2 affected downstream repositories**:

1. **NeMo-Fabric** (\`src/fabric/sandbox_runner.py:128\`):
   - **Severity: Breaking (gRPC Deserialization / Validation Rejection)**
   - The fabric sandbox runner constructs \`CreateSandboxRequest\` without supplying the new security context payload, resulting in immediate gRPC \`INVALID_ARGUMENT\` errors from the gateway.

2. **NemoClaw** (\`crates/nemoclaw-node/src/worker.rs:215\`):
   - **Severity: Type Mismatch / Warning**
   - Node worker dispatching omits tenant authorization fields.

**Recommendation:** Do not merge until \`NeMo-Fabric\` PR #18 adds security context headers to the gRPC runner stub.`,
    },
  };

  app.get('/api/assessments', async () => ({
    assessments: [PR_42_OPENSHELL],
  }));

  app.get('/api/assessments/:id', async () => ({
    assessment: PR_42_OPENSHELL,
  }));

  app.get('/api/assessments/:id/events', async () => ({
    events: [
      { type: 'start', timestamp: Date.now() - 3600_000 },
      { type: 'diff', files: 2, timestamp: Date.now() - 3590_000 },
      { type: 'analysis', findings: 2, timestamp: Date.now() - 3580_000 },
      { type: 'done', timestamp: Date.now() - 3570_000 },
    ],
  }));

  // Conversations & History (Scene 5)
  app.get('/api/conversations', async () => ({
    conversations: [
      {
        id: 'conv_demo_openshell',
        workspaceId: 'ws_cluster_a',
        title: 'Which services consume the OpenShell gateway gRPC API, and from which repos?',
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now(),
        turns: 1,
      },
    ],
  }));

  app.get('/api/conversations/:id', async () => ({
    conversation: {
      id: 'conv_demo_openshell',
      workspaceId: 'ws_cluster_a',
      title: 'Which services consume the OpenShell gateway gRPC API, and from which repos?',
      createdAt: Date.now() - 120_000,
    },
    turns: [
      {
        seq: 1,
        question: 'Which services consume the OpenShell gateway gRPC API, and from which repos?',
        answer: SCENARIOS[0].response.answer as string,
        status: 'available',
        claims: SCENARIOS[0].response.claims,
        focus: SCENARIOS[0].response.map_focus,
        model: 'nvidia/nemotron-3-super-120b-a12b',
        createdAt: Date.now() - 100_000,
      },
    ],
  }));

  // ── 5. Streaming Query Handler (Scene 2) ───────────────────────────────────

  app.post('/api/query/stream', async (req, reply) => {
    const { question, orgId } = (req.body ?? {}) as { question?: string; orgId?: string };
    const q = (question ?? '').trim();

    const scenario = SCENARIOS.find((s) => s.matches(q, orgId)) ?? fallbackScenario(q);

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

    await new Promise((r) => setTimeout(r, 600));
    sendSse('result', scenario.response);
    reply.raw.end();
  });

  app.post('/api/query', async (req) => {
    const { question, orgId } = (req.body ?? {}) as { question?: string; orgId?: string };
    const q = (question ?? '').trim();
    const scenario = SCENARIOS.find((s) => s.matches(q, orgId)) ?? fallbackScenario(q);
    return scenario.response;
  });

  return app;
}

// ── 6. Run Server ───────────────────────────────────────────────────────────

async function main() {
  const app = await buildDemoServer();
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🚀 Parallax NVIDIA Stack Demo Mock Server running at http://${HOST}:${PORT}`);
  console.log(`📡 Ready for Playwright video recording against NVIDIA agent clusters:\n`);
  console.log(`  • Cluster A (Primary Video URL): http://localhost:5173/orgs/ws_cluster_a`);
  console.log(`  • Cluster B (NeMo Agent Toolkit): http://localhost:5173/orgs/ws_cluster_b`);
  console.log(`  • Scene 2 Prompt: "Which services consume the OpenShell gateway gRPC API, and from which repos?"`);
  console.log(`  • Scene 4 PR: PR #42 "Add mandatory security context to SandboxService.CreateSandbox"\n`);
}

const isMain = process.argv[1]?.endsWith('demo-mock-server.ts');
if (isMain) {
  main().catch((err) => {
    console.error('Failed to start demo mock server:', err);
    process.exit(1);
  });
}
