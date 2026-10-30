/**
 * Scripted Mock Server for Parallax Demo Video & NVIDIA Stack Use Cases
 * 
 * Provides deterministic, high-fidelity responses for NVIDIA agent architectures:
 * 1. Cluster A (ws_cluster_a):
 *    - OpenShell gRPC proto surface (proto/openshell/v1/sandbox.proto)
 *    - Python SDK client
 *    - Cross-repo consumers: NeMo-Fabric (sandbox runner) and NemoClaw (session router)
 *    - DEEP DEPENDENCY CALL STACK:
 *      NeMo-Fabric Client -> gRPC Transport -> Gateway Handler -> Domain Service ->
 *      Session Manager -> Repository/DAL -> ORM Table Model (SandboxSessionTable)
 * 2. Cluster B (ws_cluster_b):
 *    - NeMo Agent Toolkit (NAT) HTTP & WebSocket runtime endpoints (/chat/stream, /chat, /websocket)
 *    - NeMo-Agent-Toolkit-UI reverse proxy
 *    - NeMo-Agent-Toolkit-Examples client
 * 
 * Video Scenes supported:
 * - Scene 1: Multi-repo architecture map (OpenShell, NeMo-Fabric, NemoClaw).
 * - Scene 2: Live streaming Nemotron investigation with engine tool calls:
 *   - "Which services consume the OpenShell gateway gRPC API, and from which repos?"
 *   - "Show the call stack between a very deep dependency: from the ORM table to the client that consumes the endpoint"
 *   Badges: Verified, Contradicted, Unverifiable + "Show on map" camera glide.
 * - Scene 3: Canvas hierarchy, deterministic vs inferred filtering, and CallStackStepper
 *   (Full 8-frame traversal with [Step back] and [Step into] from dispatch_agent_job to SandboxSessionTable).
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

// ── 3. Deep Dependency Chain Definitions ────────────────────────────────────

/**
 * Full 8-layer call stack between consumer client down to the database ORM table:
 * 1. dispatch_agent_job         (NeMo-Fabric Client Application)
 * 2. run_sandbox_container       (NeMo-Fabric Runner Workflow)
 * 3. grpc_client.create_sandbox  (OpenShell Python SDK Client Stub)
 * 4. handle_create_sandbox_rpc   (OpenShell Gateway RPC Controller)
 * 5. create_sandbox              (OpenShell Core Domain Logic)
 * 6. provision_session           (NemoClaw Session Lifecycle Manager)
 * 7. insert_session_state        (NemoClaw Data Access Layer / Repository)
 * 8. SandboxSessionTable::mutate (NemoClaw Database ORM Model / `sandbox_sessions` table)
 */
const DEEP_CALL_CHAIN = [
  'dispatch_agent_job',
  'run_sandbox_container',
  'grpc_client.create_sandbox',
  'handle_create_sandbox_rpc',
  'create_sandbox',
  'provision_session',
  'insert_session_state',
  'SandboxSessionTable::mutate',
];

interface SymbolDefinition {
  symbol: string;
  repo: string;
  path: string;
  type: string;
  anchorScore: number;
  calledBy: string[];
  calls: string[];
  snippet: string;
  explanation: string;
}

const SYMBOL_DIRECTORY: Record<string, SymbolDefinition> = {
  dispatch_agent_job: {
    symbol: 'dispatch_agent_job',
    repo: 'NeMo-Fabric',
    path: 'src/fabric/sandbox_runner.py',
    type: 'Function',
    anchorScore: 0.88,
    calledBy: ['WorkflowScheduler.on_job_received', 'main'],
    calls: ['run_sandbox_container', 'validate_job_spec'],
    snippet: `def dispatch_agent_job(job_spec: AgentJobSpec) -> JobExecutionResult:
    """Entry point in NeMo-Fabric agent scheduler for remote job dispatching."""
    validate_job_spec(job_spec)
    session = run_sandbox_container(job_spec.environment, job_spec.security_context)
    return monitor_job_execution(session.id)`,
    explanation: 'High-level client dispatcher in NeMo-Fabric that initiates agent job workflows.',
  },
  run_sandbox_container: {
    symbol: 'run_sandbox_container',
    repo: 'NeMo-Fabric',
    path: 'src/fabric/sandbox_runner.py',
    type: 'Function',
    anchorScore: 0.91,
    calledBy: ['dispatch_agent_job'],
    calls: ['grpc_client.create_sandbox'],
    snippet: `def run_sandbox_container(env: EnvironmentSpec, sec_ctx: SecurityContext):
    """Invokes OpenShell gRPC client to provision isolated container."""
    client = OpenShellClient(gateway_url=settings.OPENSHELL_GATEWAY)
    return client.create_sandbox(spec=env.to_proto(), security_context=sec_ctx)`,
    explanation: 'NeMo-Fabric runner workflow that prepares sandbox environment and delegates to RPC client.',
  },
  'grpc_client.create_sandbox': {
    symbol: 'grpc_client.create_sandbox',
    repo: 'OpenShell',
    path: 'python/openshell/client.py',
    type: 'Method',
    anchorScore: 0.94,
    calledBy: ['run_sandbox_container'],
    calls: ['handle_create_sandbox_rpc'],
    snippet: `def create_sandbox(self, spec: SandboxSpec, security_context: SecurityContext):
    """Python SDK client stub sending gRPC CreateSandboxRequest to Gateway."""
    req = pb.CreateSandboxRequest(spec=spec, security_context=security_context)
    return self._stub.CreateSandbox(req, timeout=self.timeout)`,
    explanation: 'Client-side gRPC transport stub connecting client application to remote Gateway.',
  },
  handle_create_sandbox_rpc: {
    symbol: 'handle_create_sandbox_rpc',
    repo: 'OpenShell',
    path: 'crates/openshell-gateway/src/server.rs',
    type: 'Function',
    anchorScore: 0.95,
    calledBy: ['grpc_client.create_sandbox', 'SandboxServiceServer'],
    calls: ['create_sandbox'],
    snippet: `async fn handle_create_sandbox_rpc(
    &self,
    request: Request<CreateSandboxRequest>,
) -> Result<Response<CreateSandboxResponse>, Status> {
    let req = request.into_inner();
    let sandbox = self.engine.create_sandbox(req).await?;
    Ok(Response::new(sandbox.into_proto()))
}`,
    explanation: 'Server-side gRPC request boundary in OpenShell Gateway validating incoming network payload.',
  },
  create_sandbox: {
    symbol: 'create_sandbox',
    repo: 'OpenShell',
    path: 'crates/openshell-gateway/src/sandbox.rs',
    type: 'Function',
    anchorScore: 0.96,
    calledBy: ['handle_create_sandbox_rpc'],
    calls: ['provision_session', 'spawn_container', 'validate_security_context'],
    snippet: `pub async fn create_sandbox(&self, req: CreateSandboxRequest) -> Result<Sandbox, GatewayError> {
    self.validate_security_context(&req.security_context)?;
    let session = self.session_mgr.provision_session(&req.tenant_id, &req.spec).await?;
    let container = self.runtime.spawn_container(&req.spec).await?;
    Ok(Sandbox::new(session.id, container))` ,
    explanation: 'Core gateway orchestration engine that provisions both session state and execution containers.',
  },
  provision_session: {
    symbol: 'provision_session',
    repo: 'NemoClaw',
    path: 'crates/openshell-gateway/src/session.rs',
    type: 'Function',
    anchorScore: 0.92,
    calledBy: ['create_sandbox'],
    calls: ['insert_session_state', 'generate_session_token'],
    snippet: `pub async fn provision_session(&self, tenant_id: &str, spec: &SandboxSpec) -> Result<Session, SessionError> {
    let token = generate_session_token(tenant_id);
    let record = SessionRecord::new(tenant_id, spec, token);
    self.repository.insert_session_state(&record).await
}`,
    explanation: 'Session management coordinator in NemoClaw handling tenant tokens and lifecycle state.',
  },
  insert_session_state: {
    symbol: 'insert_session_state',
    repo: 'NemoClaw',
    path: 'crates/nemoclaw-state/src/repository.rs',
    type: 'Function',
    anchorScore: 0.89,
    calledBy: ['provision_session'],
    calls: ['SandboxSessionTable::mutate', 'SandboxSessionTable::commit'],
    snippet: `pub async fn insert_session_state(&self, session: &SessionRecord) -> Result<Session, DbError> {
    let mut table = SandboxSessionTable::load(&self.db_pool).await?;
    table.mutate(|row| {
        row.id = session.id;
        row.tenant_id = session.tenant_id.clone();
        row.state = SessionState::Provisioning;
        row.created_at = Utc::now();
    }).await?;
    table.commit().await
}`,
    explanation: 'Data Access Layer (DAL) repository handling atomic transaction encapsulation.',
  },
  'SandboxSessionTable::mutate': {
    symbol: 'SandboxSessionTable::mutate',
    repo: 'NemoClaw',
    path: 'crates/nemoclaw-state/src/models/session_table.rs',
    type: 'Struct',
    anchorScore: 0.97,
    calledBy: ['insert_session_state'],
    calls: ['SessionORM::execute_insert', 'SqliteConnection::query'],
    snippet: `#[derive(Debug, Clone, Table, Queryable, Insertable)]
#[diesel(table_name = sandbox_sessions)]
pub struct SandboxSessionTable {
    pub id: Uuid,
    pub tenant_id: String,
    pub state: String,
    pub allocated_ports: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl SandboxSessionTable {
    pub async fn mutate<F>(&mut self, mutator: F) -> Result<(), DbError>
    where F: FnOnce(&mut Self) {
        mutator(self);
        SessionORM::execute_insert(self).await
    }
}`,
    explanation: 'Underlying ORM Table model for the `sandbox_sessions` relational table in NemoClaw.',
  },
};

// ── 4. Scripted NVIDIA Answers for Demo Video & Use Cases ───────────────────

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
  // Deep Call Stack Scenario: From ORM Table up to the Client that consumes the endpoint
  {
    matches: (q) => /call stack|deep dependency|orm|table|client.*endpoint|trace.*orm|stack.*client/i.test(q),
    progressSteps: [
      { type: 'round', round: 1, toolCallsUsed: 0, maxToolCalls: 8, forced: false, delayMs: 500 },
      { type: 'tool', tool: 'get_call_chain', summary: 'trace end-to-end call path between dispatch_agent_job and SandboxSessionTable', ok: true, ms: 180, delayMs: 1200 },
      { type: 'tool', tool: 'get_context', summary: 'inspect ORM entity SandboxSessionTable and caller hierarchy', ok: true, ms: 140, delayMs: 1100 },
      { type: 'tool', tool: 'get_call_sites', summary: 'verify cross-repo gRPC invocation in NeMo-Fabric sandbox runner', ok: true, ms: 125, delayMs: 1300 },
      { type: 'round', round: 2, toolCallsUsed: 3, maxToolCalls: 8, forced: false, delayMs: 600 },
      { type: 'verify', claims: 4, delayMs: 900 },
    ],
    response: {
      answer: `### End-to-End Architectural Call Stack (Client Consumer ➔ Database ORM Table)

The analysis engine followed an **8-layer deep dependency chain** across 3 repositories in the NVIDIA agent stack:

\`\`\`
[1] NeMo-Fabric (Client App)        : dispatch_agent_job()
  ↳ [2] NeMo-Fabric (Workflow)       : run_sandbox_container()
    ↳ [3] OpenShell SDK (Transport)   : grpc_client.create_sandbox()
      ═══════ Network Boundary: gRPC CreateSandbox RPC ═══════
      ↳ [4] OpenShell Gateway (Controller): handle_create_sandbox_rpc()
        ↳ [5] OpenShell Core (Domain)       : create_sandbox()
          ↳ [6] NemoClaw (Session Manager)    : provision_session()
            ↳ [7] NemoClaw (Repository / DAL)  : insert_session_state()
              ↳ [8] NemoClaw (ORM Model Table)  : SandboxSessionTable::mutate()
\`\`\`

#### Architectural Highlights:
1. **Consumer Origin (\`NeMo-Fabric\`):**
   - \`dispatch_agent_job\` in \`src/fabric/sandbox_runner.py:110\` triggers container provisioning via the Python SDK stub.
2. **Process / Network Edge:**
   - Crossed at \`grpc:openshell.v1.SandboxService/CreateSandbox\`, passing Protobuf specs to \`crates/openshell-gateway/src/server.rs\`.
3. **Database / ORM Anchor (\`NemoClaw\`):**
   - The gateway's \`create_sandbox\` delegates session persistence to \`provision_session\` ➔ \`insert_session_state\` ➔ \`SandboxSessionTable::mutate\` in \`crates/nemoclaw-state/src/models/session_table.rs\`.
   - **Anchor Score: 0.97.** The relational table \`sandbox_sessions\` is the grounding root for all agent container tracking.`,
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
          engine: { uses: 6, endpoints: ['grpc:openshell.v1.SandboxService/CreateSandbox'] },
          reason: 'Engine verified: dispatch_agent_job calls CreateSandbox across process boundary',
        },
        {
          claim: {
            kind: 'location',
            repo: 'NeMo-Fabric',
            path: 'src/fabric/sandbox_runner.py',
            line: 110,
            contains: 'def dispatch_agent_job',
          },
          verdict: 'verified',
          reason: 'Engine verified: client entry point definition',
        },
        {
          claim: {
            kind: 'location',
            repo: 'NemoClaw',
            path: 'crates/nemoclaw-state/src/models/session_table.rs',
            line: 34,
            contains: 'pub struct SandboxSessionTable',
          },
          verdict: 'verified',
          reason: 'Engine verified: ORM table struct declaration in repository',
        },
        {
          claim: {
            kind: 'relation',
            consumer: 'nemoclaw',
            provider: 'openshell-gateway',
            polarity: 'present',
          },
          verdict: 'verified',
          engine: { uses: 3, endpoints: ['grpc:openshell.v1.Gateway/Route'] },
          reason: 'Engine verified: session manager integrates with gateway state',
        },
      ],
      claims_summary: {
        total: 4,
        verified: 4,
        contradicted: 0,
        unverifiable: 0,
        supported: 4,
        unsupported: 0,
      },
      map_focus: {
        seed: 'ep:grpc:openshell.v1.SandboxService/CreateSandbox',
        ids: [
          'svc:nemo-fabric',
          'svc:openshell-gateway',
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
        query: 'deep-call-stack',
      },
      conversation: { id: 'conv_demo_deep_stack', seq: 1 },
      budget: {
        maxToolCalls: 8,
        maxModelMs: 120000,
        toolCallsUsed: 3,
        modelMsUsed: 1910,
        exhausted: false,
        cutShort: false,
        rounds: 2,
        promptTokens: 18200,
        completionTokens: 490,
      },
      model: 'nvidia/nemotron-3-super-120b-a12b',
      tool_calls: [
        {
          id: 'call_chain_1',
          tool: 'get_call_chain',
          args: { from: 'dispatch_agent_job', to: 'SandboxSessionTable', repo_id: 'OpenShell' },
          output: DEEP_CALL_CHAIN.join(' → '),
        },
        {
          id: 'call_context_1',
          tool: 'get_context',
          args: { symbol: 'SandboxSessionTable', repo_id: 'NemoClaw' },
          output: 'ORM Table struct for sandbox_sessions table with callers in repository.rs',
        },
        {
          id: 'call_sites_1',
          tool: 'get_call_sites',
          args: { symbol: 'CreateSandbox', repo_id: 'OpenShell' },
          output: 'Called by NeMo-Fabric/src/fabric/sandbox_runner.py:128',
        },
      ],
    },
  },

  // Scene 2 Video Pitch: "Which services consume the OpenShell gateway gRPC API, and from which repos?"
  {
    matches: (q) => /openshell|gateway|sandbox|which services consume.*openshell|grpc/i.test(q) && !/orm|table|stack|deep/i.test(q),
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

  // Cluster B / NAT Scenario
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

// ── 5. Build Fastify App ─────────────────────────────────────────────────────

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

  // Workspaces & Orgs
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

  // Code Graph Root (Including Client, Gateway, and ORM Table Nodes)
  app.get('/api/workspaces/:id/graph', async (req) => {
    const { id: wsId } = req.params as { id: string };
    const { repo: filterRepo } = (req.query ?? {}) as { repo?: string };

    if (wsId.includes('cluster_b') || wsId.includes('nat')) {
      const allRepos = [
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
      ];
      const sortedRepos = filterRepo
        ? [...allRepos].sort((a, b) => (a.repo === filterRepo ? -1 : b.repo === filterRepo ? 1 : 0))
        : allRepos;
      return {
        graph: { repos: sortedRepos },
        source: 'lain',
        workspace: { id: 'ws_cluster_b', name: 'Cluster B: NeMo Agent Toolkit HTTP Stack', repoCount: 3 },
      };
    }

    const allRepos = [
      {
        repo: 'NeMo-Fabric',
        truncated: false,
        nodes: [
          { id: 'f:sandbox_runner.py', name: 'src/fabric/sandbox_runner.py', type: 'File', kind: 'file' },
          { id: 'fn:dispatch_agent_job', name: 'dispatch_agent_job', type: 'Function', kind: 'symbol' },
          { id: 'fn:run_sandbox_container', name: 'run_sandbox_container', type: 'Function', kind: 'symbol' },
        ],
      },
      {
        repo: 'OpenShell',
        truncated: false,
        nodes: [
          { id: 'f:client.py', name: 'python/openshell/client.py', type: 'File', kind: 'file' },
          { id: 'f:sandbox.proto', name: 'proto/openshell/v1/sandbox.proto', type: 'File', kind: 'file' },
          { id: 'f:sandbox.rs', name: 'crates/openshell-gateway/src/sandbox.rs', type: 'File', kind: 'file' },
          { id: 'fn:handle_create_sandbox_rpc', name: 'handle_create_sandbox_rpc', type: 'Function', kind: 'symbol' },
          { id: 'fn:create_sandbox', name: 'create_sandbox', type: 'Function', kind: 'symbol' },
        ],
      },
      {
        repo: 'NemoClaw',
        truncated: false,
        nodes: [
          { id: 'f:session.rs', name: 'crates/openshell-gateway/src/session.rs', type: 'File', kind: 'file' },
          { id: 'f:repository.rs', name: 'crates/nemoclaw-state/src/repository.rs', type: 'File', kind: 'file' },
          { id: 'f:session_table.rs', name: 'crates/nemoclaw-state/src/models/session_table.rs', type: 'File', kind: 'file' },
          { id: 'fn:provision_session', name: 'provision_session', type: 'Function', kind: 'symbol' },
          { id: 'fn:insert_session_state', name: 'insert_session_state', type: 'Function', kind: 'symbol' },
          { id: 'c:SandboxSessionTable', name: 'SandboxSessionTable::mutate', type: 'Struct', kind: 'symbol' },
        ],
      },
    ];

    const sortedRepos = filterRepo
      ? [...allRepos].sort((a, b) => (a.repo === filterRepo ? -1 : b.repo === filterRepo ? 1 : 0))
      : allRepos;

    return {
      graph: { repos: sortedRepos },
      source: 'lain',
      workspace: { id: 'ws_cluster_a', name: 'Cluster A: OpenShell RPC Stack', repoCount: 3 },
    };
  });

  // Code Graph Children (drilling into files & communication relations)
  app.get('/api/workspaces/:id/graph/children', async (req) => {
    const { repo, name } = req.query as { repo: string; type: string; name: string };

    if (name.includes('sandbox_runner') || name.includes('dispatch_agent_job')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:dispatch_agent_job', name: 'dispatch_agent_job', type: 'Function', kind: 'symbol' },
          { id: 'fn:run_sandbox_container', name: 'run_sandbox_container', type: 'Function', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:run_sandbox_container', name: 'run_sandbox_container', type: 'Function', kind: 'symbol' },
              { id: 'fn:grpc_client.create_sandbox', name: 'grpc_client.create_sandbox', type: 'Method', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    if (name.includes('client.py') || name.includes('grpc_client')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:grpc_client.create_sandbox', name: 'grpc_client.create_sandbox', type: 'Method', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:handle_create_sandbox_rpc', name: 'handle_create_sandbox_rpc', type: 'Function', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    if (name.includes('sandbox.rs') || name.includes('create_sandbox')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:handle_create_sandbox_rpc', name: 'handle_create_sandbox_rpc', type: 'Function', kind: 'symbol' },
          { id: 'fn:create_sandbox', name: 'create_sandbox', type: 'Function', kind: 'symbol' },
          { id: 'fn:spawn_container', name: 'spawn_container', type: 'Function', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:provision_session', name: 'provision_session', type: 'Function', kind: 'symbol' },
              { id: 'fn:spawn_container', name: 'spawn_container', type: 'Function', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    if (name.includes('session.rs') || name.includes('provision_session')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:provision_session', name: 'provision_session', type: 'Function', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Calls',
            nodes: [
              { id: 'fn:insert_session_state', name: 'insert_session_state', type: 'Function', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    if (name.includes('repository.rs') || name.includes('insert_session_state')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'fn:insert_session_state', name: 'insert_session_state', type: 'Function', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Uses',
            nodes: [
              { id: 'c:SandboxSessionTable', name: 'SandboxSessionTable::mutate', type: 'Struct', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    if (name.includes('session_table') || name.includes('SandboxSessionTable')) {
      return {
        node: { repo, type: 'File', name },
        children: [
          { id: 'c:SandboxSessionTable', name: 'SandboxSessionTable::mutate', type: 'Struct', kind: 'symbol' },
        ],
        communications: [
          {
            edge: 'Uses',
            nodes: [
              { id: 'fn:insert_session_state', name: 'insert_session_state', type: 'Function', kind: 'symbol' },
            ],
          },
        ],
        hasCommunication: true,
        source: 'lain',
      };
    }

    return { node: { repo, type: 'File', name }, children: [], communications: [], source: 'lain' };
  });

  // Symbol Context & CallStackStepper (Supports Full 8-Step Navigation)
  app.get('/api/workspaces/:id/graph/symbol-context', async (req) => {
    const { repo, symbol } = req.query as { repo: string; symbol: string };
    const sym = SYMBOL_DIRECTORY[symbol] || Object.values(SYMBOL_DIRECTORY).find((s) => s.symbol.includes(symbol));

    if (sym) {
      return {
        context: {
          symbol: sym.symbol,
          repo: sym.repo,
          path: sym.path,
          type: sym.type,
          anchorScore: sym.anchorScore,
          calledBy: sym.calledBy,
          calls: sym.calls,
          rawText: `## Explanation for '${sym.symbol}' (${sym.type})\n**Path:** ${sym.path}\n- **Anchor Score:** ${sym.anchorScore.toFixed(2)}\n- **Called by:** ${sym.calledBy.join(', ')}\n- **Calls:** ${sym.calls.join(', ')}\n\n${sym.explanation}`,
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
        calledBy: ['dispatch_agent_job'],
        calls: ['SandboxSessionTable::mutate'],
        rawText: `Explanation for '${symbol}'`,
      },
      source: 'lain',
    };
  });

  // Call Chain (Supports 8-Hop Deep Call Stack)
  app.get('/api/workspaces/:id/graph/call-chain', async (req) => {
    const { from, to, repo } = req.query as { from: string; to: string; repo: string };

    const fromIdx = DEEP_CALL_CHAIN.findIndex((s) => s.toLowerCase().includes(from?.toLowerCase() ?? ''));
    const toIdx = DEEP_CALL_CHAIN.findIndex((s) => s.toLowerCase().includes(to?.toLowerCase() ?? ''));

    let chain = DEEP_CALL_CHAIN;
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
      chain = DEEP_CALL_CHAIN.slice(fromIdx, toIdx + 1);
    } else if (fromIdx !== -1 && toIdx !== -1 && fromIdx > toIdx) {
      chain = DEEP_CALL_CHAIN.slice(toIdx, fromIdx + 1).reverse();
    }

    return {
      chain: {
        from: from ?? 'dispatch_agent_job',
        to: to ?? 'SandboxSessionTable::mutate',
        repo: repo ?? 'OpenShell',
        chain,
        rawText: chain.join(' → '),
      },
      source: 'lain',
    };
  });

  // Code Snippet (Shows real code for the deep stack symbols)
  app.get('/api/workspaces/:id/graph/snippet', async (req) => {
    const { symbol, path: filePath } = (req.query ?? {}) as { repo?: string; symbol?: string; path?: string };
    const sym =
      (symbol && (SYMBOL_DIRECTORY[symbol] || Object.values(SYMBOL_DIRECTORY).find((s) => s.symbol.includes(symbol)))) ||
      (filePath && Object.values(SYMBOL_DIRECTORY).find((s) => s.path.includes(filePath) || filePath.includes(s.path)));

    if (sym) {
      return {
        snippet: {
          symbol: sym.symbol,
          repo: sym.repo,
          path: sym.path,
          text: sym.snippet,
        },
        source: 'lain',
      };
    }

    return {
      snippet: {
        symbol: symbol ?? filePath ?? 'create_sandbox',
        repo: 'OpenShell',
        path: filePath ?? 'crates/openshell-gateway/src/sandbox.rs',
        text: SYMBOL_DIRECTORY.create_sandbox.snippet,
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
        'nemoclaw_state::models::session_table::SandboxSessionTable',
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
   - Node worker dispatching omits tenant authorization fields before calling \`SandboxSessionTable::mutate\`.

**Recommendation:** Do not merge until \`NeMo-Fabric\` adds security context headers in \`dispatch_agent_job\`.`,
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
        id: 'conv_demo_deep_stack',
        workspaceId: 'ws_cluster_a',
        title: 'Trace call stack from ORM table to client endpoint consumer',
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now(),
        turns: 1,
      },
    ],
  }));

  app.get('/api/conversations/:id', async () => ({
    conversation: {
      id: 'conv_demo_deep_stack',
      workspaceId: 'ws_cluster_a',
      title: 'Trace call stack from ORM table to client endpoint consumer',
      createdAt: Date.now() - 120_000,
    },
    turns: [
      {
        seq: 1,
        question: 'Show the call stack between a very deep dependency: from the ORM table to the client that consumes the endpoint',
        answer: SCENARIOS[0].response.answer as string,
        status: 'available',
        claims: SCENARIOS[0].response.claims,
        focus: SCENARIOS[0].response.map_focus,
        model: 'nvidia/nemotron-3-super-120b-a12b',
        createdAt: Date.now() - 100_000,
      },
    ],
  }));

  // ── 6. Streaming Query Handler ─────────────────────────────────────────────

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

// ── 7. Run Server ───────────────────────────────────────────────────────────

async function main() {
  const app = await buildDemoServer();
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🚀 Parallax NVIDIA Stack Demo Mock Server running at http://${HOST}:${PORT}`);
  console.log(`📡 Ready for Playwright video recording against NVIDIA agent clusters:\n`);
  console.log(`  • Cluster A (Primary Video URL): http://localhost:5173/orgs/ws_cluster_a`);
  console.log(`  • Deep Call Stack Query: "Show the call stack between a very deep dependency: from the ORM table to the client"`);
  console.log(`  • Call Stack Stepper: Traverses 8 frames between dispatch_agent_job and SandboxSessionTable::mutate`);
  console.log(`  • Scene 4 PR: PR #42 "Add mandatory security context to SandboxService.CreateSandbox"\n`);
}

const isMain = process.argv[1]?.endsWith('demo-mock-server.ts');
if (isMain) {
  main().catch((err) => {
    console.error('Failed to start demo mock server:', err);
    process.exit(1);
  });
}
