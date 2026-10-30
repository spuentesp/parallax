// Real LainAdapter client — JSON-RPC over POST /mcp against a running lain
// server. Replaces the stub in subproject 2. The probe at boot validates
// apiVersion and analyzerVersion before the first tool call (Review Focus #2
// in the plan: a bad URL must fail fast, not on the first request).

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
import { type CodeTool, isCodeTool } from '../agent/code-tools.js';
import { LainCallError } from './errors.js';
import { isProductCodeTool, type ProductCodeTool } from './product-tools.js';
import type { LainAdapter } from './types.js';

export interface LainClientConfig {
  readonly lainUrl: string;
  readonly apiVersion: '1';
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpEnvelope {
  _meta?: Record<string, unknown>;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

function _pickRateLimit(headers: Headers): {
  remainingRequests?: number;
  remainingTokens?: number;
  overLimit?: boolean;
} {
  const num = (k: string): number | undefined => {
    const v = headers.get(k);
    return v === null || v === '' ? undefined : Number(v);
  };
  const result: {
    remainingRequests?: number;
    remainingTokens?: number;
    overLimit?: boolean;
  } = {};
  const rr = num('x-ratelimit-remaining-requests');
  if (rr !== undefined) result.remainingRequests = rr;
  const rt = num('x-ratelimit-remaining-tokens');
  if (rt !== undefined) result.remainingTokens = rt;
  result.overLimit = headers.get('x-ratelimit-over-limit') === 'yes';
  return result;
}

export class RealLainAdapter implements LainAdapter {
  private version: string;

  get analyzerVersion(): string {
    return this.version;
  }
  readonly apiVersion: '1';

  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private nextId = 1;

  constructor(config: LainClientConfig, analyzerVersion: string) {
    this.url = config.lainUrl;
    this.apiVersion = config.apiVersion;
    this.version = analyzerVersion;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request(tool: string, args: Record<string, unknown>): Promise<McpEnvelope> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= this.maxRetries) {
      attempt++;
      const id = this.nextId++;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name: tool, arguments: args },
          }),
          signal: ctl.signal,
        });
        if (res.status === 429) {
          clearTimeout(timer);
          const retryAfter = res.headers.get('retry-after');
          const delayMs = retryAfter ? Number(retryAfter) * 1000 : 1000 * attempt;
          lastError = LainCallError.parse({
            code: 'LainUnavailable',
            message: `HTTP 429 from lain`,
          });
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        if (res.status === 503 || res.status >= 500) {
          clearTimeout(timer);
          lastError = LainCallError.parse({
            code: 'LainUnavailable',
            message: `lain returned HTTP ${res.status}`,
          });
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw LainCallError.parse({
            code: 'LainUnavailable',
            message: `lain returned HTTP ${res.status}: ${text.slice(0, 200)}`,
          });
        }
        const body = (await res.json()) as JsonRpcResponse;
        if (body.error) {
          throw LainCallError.parse({
            code: 'LainUnavailable',
            message: `JSON-RPC error ${body.error.code}: ${body.error.message}`,
          });
        }
        const envelope = body.result as McpEnvelope | undefined;
        if (!envelope) {
          throw LainCallError.parse({
            code: 'LainUnavailable',
            message: 'no result in JSON-RPC response',
          });
        }
        clearTimeout(timer);
        return envelope;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof Error && e.name === 'AbortError') {
          lastError = LainCallError.parse({
            code: 'LainUnavailable',
            message: `lain call timed out at ${tool}`,
          });
          continue;
        }
        const isLainError = (e as { code?: string }).code !== undefined;
        if (isLainError) throw e;
        lastError = LainCallError.parse({
          code: 'LainUnavailable',
          message: `lain call failed: ${(e as Error).message}`,
        });
        if (attempt > this.maxRetries) throw lastError;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : LainCallError.parse({ code: 'LainUnavailable', message: 'exhausted retries' });
  }

  // Real lain wraps the payload in { _meta, content: [{ text: "<JSON>" }] }.
  // The `text` field is a JSON string with analyzer_version, api_version,
  // data, meta. We return `data` (the domain payload) plus `_meta`.
  private parsePayload<T>(tool: string, envelope: McpEnvelope): T {
    // Prefer structuredContent (already parsed); fall back to content[0].text.
    let parsed: Record<string, unknown> | undefined;
    if (envelope.structuredContent && typeof envelope.structuredContent === 'object') {
      parsed = envelope.structuredContent as Record<string, unknown>;
    } else if (envelope.content?.[0]?.text) {
      try {
        parsed = JSON.parse(envelope.content[0].text) as Record<string, unknown>;
      } catch {
        throw LainCallError.parse({
          code: 'LainUnavailable',
          message: `lain returned unparseable content[0].text for ${tool}`,
        });
      }
    }
    if (!parsed) {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `lain returned no parseable payload for ${tool}`,
      });
    }
    if (parsed.error !== undefined && parsed.error !== null) {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `lain returned error in envelope: ${JSON.stringify(parsed.error)}`,
      });
    }
    if (parsed.api_version !== undefined && String(parsed.api_version) !== this.apiVersion) {
      throw LainCallError.parse({
        code: 'ToolSchemaMismatch',
        message: `unsupported lain api_version: ${String(parsed.api_version)}`,
        tool,
        detail: `expected api_version ${this.apiVersion}`,
      });
    }
    if (typeof parsed.analyzer_version === 'string' && parsed.analyzer_version.length > 0) {
      this.version = parsed.analyzer_version;
    }
    // Return the domain payload; version metadata stays on the adapter.
    const data = parsed.data ?? parsed;
    return data as T;
  }

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const envelope = await this.request(tool, args);
    return this.parsePayload<T>(tool, envelope);
  }

  // Tools del paquete raw que devuelven markdown plano (get_code_snippet,
  // explain_symbol, get_call_sites): no hay JSON que parsear, se devuelve el
  // texto tal cual envuelto en {text}.
  private async callText(tool: string, args: Record<string, unknown>): Promise<LainTextResponse> {
    const envelope = await this.request(tool, args);
    const text = envelope.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `lain returned no text payload for ${tool}`,
      });
    }
    return { text };
  }

  async listServices(req: ListServicesArgs): Promise<ListServicesResponse> {
    return this.call<ListServicesResponse>(
      'list_services',
      req as unknown as Record<string, unknown>,
    );
  }

  async getService(req: GetServiceArgs): Promise<GetServiceResponse> {
    return this.call<GetServiceResponse>('get_service', req as unknown as Record<string, unknown>);
  }

  async prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse> {
    return this.call<PrepareSnapshotResponse>(
      'prepare_snapshot',
      req as unknown as Record<string, unknown>,
    );
  }

  async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
    return this.call<GetSnapshotResponse>(
      'get_snapshot',
      req as unknown as Record<string, unknown>,
    );
  }

  async diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse> {
    return this.call<DiffContractsResponse>('diff_contracts', {
      base: req.base,
      head: req.head,
      ...(req.service ? { service: req.service } : {}),
      ...(req.repo ? { repo: req.repo } : {}),
      ...(req.cap !== undefined ? { cap: req.cap } : {}),
      ...(req.min_impact ? { min_impact: req.min_impact } : {}),
    });
  }

  async traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse> {
    return this.call<TraceImpactResponse>(
      'trace_impact',
      req as unknown as Record<string, unknown>,
    );
  }

  async getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse> {
    return this.call<GetCoverageResponse>(
      'get_coverage',
      req as unknown as Record<string, unknown>,
    );
  }

  async resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse> {
    return this.call<ResolveEvidenceResponse>(
      'resolve_evidence',
      req as unknown as Record<string, unknown>,
    );
  }

  async readSource(req: ReadSourceArgs): Promise<ReadSourceResponse> {
    return this.call<ReadSourceResponse>('read_source', req as unknown as Record<string, unknown>);
  }

  async listContracts(req: ListContractsArgs): Promise<ListContractsResponse> {
    return this.call<ListContractsResponse>(
      'list_contracts',
      req as unknown as Record<string, unknown>,
    );
  }

  async getContract(req: GetContractArgs): Promise<GetContractResponse> {
    return this.call<GetContractResponse>(
      'get_contract',
      req as unknown as Record<string, unknown>,
    );
  }

  async listUnresolved(req: ListUnresolvedArgs): Promise<ListUnresolvedResponse> {
    return this.call<ListUnresolvedResponse>(
      'list_unresolved',
      req as unknown as Record<string, unknown>,
    );
  }

  async checkBinding(req: CheckBindingArgs): Promise<CheckBindingResponse> {
    return this.call<CheckBindingResponse>(
      'check_binding',
      req as unknown as Record<string, unknown>,
    );
  }

  async queryGraph(req: QueryGraphArgs): Promise<QueryGraphResponse> {
    // El argumento es `query` (los docs de lain dicen `spec`, mal para este
    // build). Se envía verbatim: el pipeline lo valida el motor.
    const res = await this.call<QueryGraphResponse>('query_graph', {
      query: req.query,
      ...(req.repo_id ? { repo_id: req.repo_id } : {}),
    });
    // El motor omite `nodes` entero cuando count=0: se normaliza a [] sin
    // inventar nada (un vacío sigue siendo un vacío).
    return { ...res, nodes: res.nodes ?? [] };
  }

  async describeSchema(req: DescribeSchemaArgs): Promise<DescribeSchemaResponse> {
    return this.call<DescribeSchemaResponse>(
      'describe_schema',
      req as unknown as Record<string, unknown>,
    );
  }

  async loadPackage(req: LoadPackageArgs): Promise<LoadPackageResponse> {
    return this.call<LoadPackageResponse>('load_package', { package: req.package });
  }

  async getCodeSnippet(req: GetCodeSnippetArgs): Promise<LainTextResponse> {
    return this.callText('get_code_snippet', {
      path: req.path,
      ...(req.repo_id ? { repo_id: req.repo_id } : {}),
      ...(req.line !== undefined ? { line: req.line } : {}),
      ...(req.context_lines !== undefined ? { context_lines: req.context_lines } : {}),
    });
  }

  async explainSymbol(req: ExplainSymbolArgs): Promise<LainTextResponse> {
    return this.callText('explain_symbol', {
      symbol: req.symbol,
      ...(req.repo_id ? { repo_id: req.repo_id } : {}),
    });
  }

  async getCallSites(req: GetCallSitesArgs): Promise<LainTextResponse> {
    return this.callText('get_call_sites', {
      symbol: req.symbol,
      ...(req.repo_id ? { repo_id: req.repo_id } : {}),
    });
  }

  async codeTool(
    tool: CodeTool | ProductCodeTool,
    args: Record<string, unknown>,
  ): Promise<LainTextResponse> {
    // Defensa en profundidad: sólo herramientas de lectura de la lista.
    if (!isCodeTool(tool) && !isProductCodeTool(tool)) {
      throw LainCallError.parse({ code: 'LainUnavailable', message: `not a code tool: ${tool}` });
    }
    return this.callText(tool, args);
  }
}

export async function createLainClient(config: LainClientConfig): Promise<LainAdapter> {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const adapter = new RealLainAdapter(config, 'unknown');

  // Discover the contract surface, opting in when the server starts with core only.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const retries = config.maxRetries ?? (process.env.NODE_ENV === 'test' ? 0 : 10);
    const listTools = async (): Promise<string[]> => {
      let attempts = 0;
      while (true) {
        try {
          const res = await fetchImpl(config.lainUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
              params: {},
            }),
            signal: ctl.signal,
          });
          if (!res.ok) {
            throw LainCallError.parse({
              code: 'LainUnavailable',
              message: `lain handshake returned HTTP ${res.status}`,
            });
          }
          const body = (await res.json()) as JsonRpcResponse;
          if (body.error) {
            throw LainCallError.parse({
              code: 'LainUnavailable',
              message: `lain handshake JSON-RPC error: ${body.error.message}`,
            });
          }
          const result = body.result as { tools?: Array<{ name: string }> };
          return (result.tools ?? []).map((t) => t.name);
        } catch (e) {
          attempts++;
          if (attempts > retries || ctl.signal.aborted) {
            throw e;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    };
    let toolNames = await listTools();
    const expected = [
      'list_services',
      'get_service',
      'list_contracts',
      'get_contract',
      'list_unresolved',
      'check_binding',
      'prepare_snapshot',
      'get_snapshot',
      'diff_contracts',
      'trace_impact',
      'get_coverage',
      'resolve_evidence',
      'read_source',
    ];
    if (expected.some((t) => !toolNames.includes(t)) && toolNames.includes('load_package')) {
      await adapter.loadPackage({ package: 'contracts' });
      toolNames = await listTools();
    }
    const missing = expected.filter((t) => !toolNames.includes(t));
    const [firstMissing] = missing;
    if (firstMissing !== undefined) {
      throw LainCallError.parse({
        code: 'ToolSchemaMismatch',
        message: `lain tools/list is missing: ${missing.join(', ')}`,
        tool: firstMissing,
        detail: `expected 13 contract tools, got ${toolNames.length}`,
      });
    }
  } catch (e) {
    clearTimeout(timer);
    const isLainError = (e as { code?: string }).code !== undefined;
    if (isLainError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `lain handshake timed out at ${config.lainUrl}`,
      });
    }
    throw LainCallError.parse({
      code: 'LainUnavailable',
      message: `cannot reach lain at ${config.lainUrl}: ${(e as Error).message}`,
    });
  } finally {
    clearTimeout(timer);
  }

  // Read the contract envelope before exposing the adapter: assessment digests
  // must include the actual analyzer version even on the first request.
  await adapter.listServices({ snapshot: 'live' });
  if (adapter.analyzerVersion === 'unknown') {
    throw LainCallError.parse({
      code: 'ToolSchemaMismatch',
      message: 'lain list_services is missing analyzer_version',
      tool: 'list_services',
      detail: 'assessment identity requires the analyzer version',
    });
  }

  // query_graph vive en el paquete `raw`, que no viene cargado por defecto.
  // Se opta por él (y por arch/workspace, que aportan las vistas de capas) de
  // forma defensiva: la carga es idempotente (already_loaded) y un fallo aquí
  // no debe tumbar el arranque — las tools de contratos siguen funcionando.
  for (const pkg of ['raw', 'arch', 'workspace']) {
    try {
      await adapter.loadPackage({ package: pkg });
    } catch {
      // Server sin ese paquete o ya sin sesión: se ignora (INV 3: nada inventado).
    }
  }
  return adapter;
}

// One handshake per LAIN endpoint, not per request. Failures are not cached,
// so a server that comes up later is picked up on the next call.
const clientPool = new Map<string, Promise<LainAdapter>>();

export function getLainClient(config: LainClientConfig): Promise<LainAdapter> {
  const key = config.lainUrl;
  const cached = clientPool.get(key);
  if (cached) return cached;
  const created = createLainClient(config);
  created.catch(() => clientPool.delete(key));
  clientPool.set(key, created);
  return created;
}

export function resetLainClientPool(): void {
  clientPool.clear();
}
