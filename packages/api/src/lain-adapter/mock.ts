import type {
  CheckBindingArgs,
  CheckBindingResponse,
  DescribeSchemaArgs,
  DescribeSchemaResponse,
  DiffContractsArgs,
  DiffContractsResponse,
  ExplainSymbolArgs,
  GetCallSitesArgs,
  GetCodeSnippetArgs,
  GetContractArgs,
  GetContractResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  LainTextResponse,
  ListContractsArgs,
  ListContractsResponse,
  ListServicesArgs,
  ListServicesResponse,
  ListUnresolvedArgs,
  ListUnresolvedResponse,
  LoadPackageArgs,
  LoadPackageResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  QueryGraphArgs,
  QueryGraphResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  TraceImpactArgs,
  TraceImpactResponse,
} from '@parallax/shared/lain';
import {
  analyzerVersion,
  apiVersion,
  getServiceById,
  s1RemoveCustomerId,
  s2AddCurrency,
  services,
} from '@parallax/shared/test/lain-fixtures';
import type { CodeTool } from '../agent/code-tools.js';
import { LainCallError } from './errors.js';
import { getLainMockCalls, recordMockCall, resetLainMock } from './record.js';
import type { LainAdapter } from './types.js';

interface PendingSnapshot {
  snapshot: string;
  state: 'pending' | 'ready' | 'failed';
  readyAt: number;
}

const snapshots = new Map<string, PendingSnapshot>();
let snapshotCounter = 0;

function pickScenario(snapshot: string | undefined) {
  if (!snapshot) return s1RemoveCustomerId;
  if (snapshot.includes('s2')) return s2AddCurrency;
  return s1RemoveCustomerId;
}

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

export function createLainMock(): LainAdapter {
  return {
    analyzerVersion,
    apiVersion,

    async listServices(req: ListServicesArgs): Promise<ListServicesResponse> {
      recordMockCall({ tool: 'list_services', snapshot: req.snapshot, args: req });
      const filtered = req.repo
        ? services.filter((s: { repo: string }) => s.repo === req.repo)
        : services;
      return {
        items: filtered,
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      };
    },

    async getService(req: GetServiceArgs): Promise<GetServiceResponse> {
      recordMockCall({ tool: 'get_service', snapshot: req.snapshot, args: req });
      try {
        return getServiceById(req.service);
      } catch {
        throw LainCallError.parse({
          code: 'NotImplemented',
          message: `unknown service: ${req.service}`,
          doc: SPEC_DOC,
        });
      }
    },

    async prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse> {
      recordMockCall({ tool: 'prepare_snapshot', args: req });
      const id = `snap_${(++snapshotCounter).toString(16).padStart(16, '0')}`;
      snapshots.set(id, { snapshot: id, state: 'pending', readyAt: Date.now() + 100 });
      return { snapshot: id, state: 'pending' as const };
    },

    async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
      recordMockCall({ tool: 'get_snapshot', snapshot: req.snapshot, args: req });
      const s = snapshots.get(req.snapshot);
      if (!s) {
        throw LainCallError.parse({
          code: 'SnapshotNotReady',
          message: 'unknown snapshot',
          snapshot: req.snapshot,
        });
      }
      if (Date.now() < s.readyAt) {
        return { snapshot: s.snapshot, state: 'pending' };
      }
      s.state = 'ready';
      return { snapshot: s.snapshot, state: 'ready' };
    },

    async diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse> {
      recordMockCall({ tool: 'diff_contracts', args: req });
      return pickScenario(req.head).diffContracts;
    },

    async traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse> {
      recordMockCall({ tool: 'trace_impact', snapshot: req.snapshot, args: req });
      return pickScenario(req.snapshot).traceImpact;
    },

    async getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse> {
      recordMockCall({ tool: 'get_coverage', snapshot: req.snapshot, args: req });
      return pickScenario(req.snapshot).coverage;
    },

    async resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse> {
      recordMockCall({ tool: 'resolve_evidence', snapshot: req.snapshot, args: req });
      return {
        items: req.refs.map((ref) => ({
          exists: true,
          ref,
          snippet: `// mock evidence for ${ref}`,
        })),
      };
    },

    async readSource(req: ReadSourceArgs): Promise<ReadSourceResponse> {
      recordMockCall({ tool: 'read_source', snapshot: req.snapshot, args: req });
      const lineCount = Math.max(1, req.end - req.start);
      const text = Array.from(
        { length: lineCount },
        (_, i) => `${req.path}:${req.start + i + 1}: mock line`,
      ).join('\n');
      return {
        text,
        path: req.path,
        start: req.start,
        end: req.end,
        commit: s1RemoveCustomerId.baseSha,
        total_lines: req.end + 40,
        source: req.snapshot,
      };
    },

    async listContracts(req: ListContractsArgs): Promise<ListContractsResponse> {
      recordMockCall({ tool: 'list_contracts', snapshot: req.snapshot, args: req });
      return {
        items: [
          {
            endpoint: { key: 'http:GET /api/orders/{}', service: 'orders' },
            has_schema: true,
            bound_consumers: 1,
          },
          {
            endpoint: { key: 'http:GET /invoices/{}', service: 'billing' },
            has_schema: false,
            bound_consumers: 1,
          },
        ],
      };
    },

    async getContract(req: GetContractArgs): Promise<GetContractResponse> {
      recordMockCall({ tool: 'get_contract', snapshot: req.snapshot, args: req });
      return { items: [{ key: req.key, service: req.service, consumers: [] }] };
    },

    async listUnresolved(req: ListUnresolvedArgs): Promise<ListUnresolvedResponse> {
      recordMockCall({ tool: 'list_unresolved', snapshot: req.snapshot, args: req });
      return {
        items: [],
        ambiguous: [],
        scope: { configured_only: true, reviewed: [], unreviewed: [] },
      };
    },

    async checkBinding(req: CheckBindingArgs): Promise<CheckBindingResponse> {
      recordMockCall({ tool: 'check_binding', snapshot: req.snapshot, args: req });
      return {
        valid: true,
        method_match: true,
        template_match: 'exact',
        reasons: [],
        bindings_entry: [
          `- consumer:`,
          `    repo: ${req.consumer.split(':')[0]}`,
          `    path: mock/path.graphql`,
          `    symbol: graphql-call:${req.endpoint.key.replace(/^graphql:/, '')}`,
          `    key: "${req.endpoint.key}"`,
          `  provider:`,
          `    service: ${req.endpoint.service}`,
          `    key: "${req.endpoint.key}"`,
        ].join('\n'),
      };
    },

    // Grafo crudo: un diminuto grafo de mentira FIJO (no se sintetiza nada en
    // runtime) con la forma exacta del motor, incluida la omisión de `nodes`
    // cuando count=0. Sirve para probar el builder sin servidor.
    async queryGraph(req: QueryGraphArgs): Promise<QueryGraphResponse> {
      recordMockCall({ tool: 'query_graph', args: req });
      const ops = req.query.ops as Array<Record<string, unknown>>;
      const find = (ops.find((o) => o.op === 'find') ?? {}) as {
        type?: string | string[];
        name?: string | { exact?: string };
      };
      const connect = (ops.find((o) => o.op === 'connect') ?? {}) as {
        edge?: string | string[];
        direction?: string;
      };
      const limit = (ops.find((o) => o.op === 'limit') ?? {}) as { count?: number };
      // El builder envía {exact}; el motor también acepta string plano.
      const name = typeof find.name === 'object' ? (find.name.exact ?? '') : (find.name ?? '');

      const rootTypes = ['File', 'Namespace', 'Module', 'HttpRoute', 'Topic'];
      const types = Array.isArray(find.type) ? find.type : find.type ? [find.type] : [];
      let nodes: QueryGraphResponse['nodes'] = [];

      if (!name && types.length > 0 && types.some((t) => rootTypes.includes(t))) {
        // Raíz: estructura de alto nivel del repo orders.
        nodes = [
          { id: 'n-file-main', name: 'main.rs', type: 'File' },
          { id: 'n-ns-src', name: 'src', type: 'Namespace' },
          { id: 'n-mod-orders', name: 'orders', type: 'Module' },
          { id: 'n-route-post', name: 'POST /api/orders', type: 'HttpRoute' },
          { id: 'n-topic', name: 'kafka/orders.created', type: 'Topic' },
        ].filter((n) => types.includes(n.type));
      } else if (find.type === 'File' && name === 'main.rs') {
        const edge = Array.isArray(connect.edge) ? connect.edge[0] : connect.edge;
        if (edge === 'Contains' && connect.direction === 'outgoing') {
          nodes = [
            { id: 'n-fn-main', name: 'main', type: 'Function' },
            { id: 'n-mod-orders', name: 'orders', type: 'Module' },
          ];
        }
      } else if (find.type === 'Function' && name === 'create_order') {
        const edge = Array.isArray(connect.edge) ? connect.edge[0] : connect.edge;
        if (edge === 'Uses' && connect.direction === 'both') {
          nodes = [{ id: 'n-struct-create', name: 'CreateOrder', type: 'Struct' }];
        } else if (edge === 'CallsHttp' && connect.direction === 'both') {
          nodes = [{ id: 'n-route-post', name: 'POST /api/orders', type: 'HttpRoute' }];
        }
      }
      // El motor omite `nodes` entero cuando no hay resultados.
      if (limit.count !== undefined && nodes.length > limit.count) {
        nodes = nodes.slice(0, limit.count);
      }
      return { count: nodes.length, legacy: false, nodes };
    },

    async describeSchema(_req: DescribeSchemaArgs): Promise<DescribeSchemaResponse> {
      recordMockCall({ tool: 'describe_schema', args: _req });
      return {
        node_types: [
          { name: 'File', indexed: true },
          { name: 'Namespace', indexed: true },
          { name: 'Module', indexed: true },
          { name: 'Package', indexed: true },
          { name: 'Function', indexed: true },
          { name: 'Method', indexed: true },
          { name: 'Struct', indexed: true },
          { name: 'Enum', indexed: true },
          { name: 'Trait', indexed: true },
          { name: 'Class', indexed: true },
          { name: 'Interface', indexed: true },
          { name: 'HttpRoute', indexed: true },
          { name: 'Topic', indexed: true },
          { name: 'Schema', indexed: true },
        ],
        edge_types: [
          { name: 'Contains', indexed: true },
          { name: 'Calls', indexed: true },
          { name: 'Uses', indexed: true },
          { name: 'Imports', indexed: false },
          { name: 'Produces', indexed: true },
          { name: 'Consumes', indexed: true },
          { name: 'CallsHttp', indexed: true },
        ],
      };
    },

    async loadPackage(req: LoadPackageArgs): Promise<LoadPackageResponse> {
      recordMockCall({ tool: 'load_package', args: req });
      return { package: req.package, loaded: true, already_loaded: true };
    },

    async getCodeSnippet(req: GetCodeSnippetArgs): Promise<LainTextResponse> {
      recordMockCall({ tool: 'get_code_snippet', args: req });
      return {
        text: `File: mock/${req.path}\nShowing lines 1-2\n\n   1: mock line 1\n   2: mock line 2`,
      };
    },

    async explainSymbol(req: ExplainSymbolArgs): Promise<LainTextResponse> {
      recordMockCall({ tool: 'explain_symbol', args: req });
      return {
        text: [
          `## Explanation for '${req.symbol}' (Function)`,
          `**Path:** mock/${req.symbol}.rs`,
          '',
          '### Source',
          '```',
          `fn ${req.symbol}() {}`,
          '```',
        ].join('\n'),
      };
    },

    async codeTool(tool: CodeTool, args: Record<string, unknown>): Promise<LainTextResponse> {
      recordMockCall({ tool, args });
      return { text: `## ${tool}\n\n(mock) ${JSON.stringify(args)}` };
    },

    async getCallSites(req: GetCallSitesArgs): Promise<LainTextResponse> {
      recordMockCall({ tool: 'get_call_sites', args: req });
      return { text: `No call sites found for '${req.symbol}' (${req.symbol} is a leaf)` };
    },
  };
}

export { getLainMockCalls, resetLainMock };
