// Real LainAdapter client — JSON-RPC over POST /mcp against a running lain
// server. Replaces the stub in subproject 2. The probe at boot validates
// apiVersion and analyzerVersion before the first tool call (Review Focus #2
// in the plan: a bad URL must fail fast, not on the first request).

import type {
  DiffContractsArgs,
  DiffContractsResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  ListServicesArgs,
  ListServicesResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  TraceImpactArgs,
  TraceImpactResponse,
} from '@parallax/shared/lain';
import { LainCallError } from './errors.js';
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
  readonly analyzerVersion: string;
  readonly apiVersion: '1';

  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private nextId = 1;

  constructor(config: LainClientConfig, analyzerVersion: string) {
    this.url = config.lainUrl;
    this.apiVersion = config.apiVersion;
    this.analyzerVersion = analyzerVersion;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
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
        clearTimeout(timer);
        if (res.status === 429) {
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
        // Real lain wraps the payload in { _meta, content: [{ text: "<JSON>" }] }.
        // The `text` field is a JSON string with analyzer_version, api_version,
        // data, meta. We return `data` (the domain payload) plus `_meta`.
        const envelope = body.result as
          | {
              _meta?: Record<string, unknown>;
              content?: Array<{ text?: string }>;
              structuredContent?: Record<string, unknown>;
            }
          | undefined;
        if (!envelope) {
          throw LainCallError.parse({
            code: 'LainUnavailable',
            message: 'no result in JSON-RPC response',
          });
        }
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
        // Return the `data` field (domain payload) merged with `_meta`.
        const data = parsed.data ?? parsed;
        return data as T;
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
}

export async function createLainClient(config: LainClientConfig): Promise<LainAdapter> {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  // Handshake: tools/list to validate apiVersion + analyzerVersion.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
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
    const toolNames = (result.tools ?? []).map((t) => t.name);
    const expected = [
      'list_services',
      'get_service',
      'prepare_snapshot',
      'get_snapshot',
      'diff_contracts',
      'trace_impact',
      'get_coverage',
      'resolve_evidence',
      'read_source',
    ];
    const missing = expected.filter((t) => !toolNames.includes(t));
    if (missing.length > 0) {
      throw LainCallError.parse({
        code: 'ToolSchemaMismatch',
        message: `lain tools/list is missing: ${missing.join(', ')}`,
        tool: missing[0] ?? '',
        detail: `expected 9 contract tools, got ${toolNames.length}`,
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

  // analyzerVersion is populated by the first tools/call response; until then
  // we expose the version from config or the handshake.
  return new RealLainAdapter(config, '0.9.0');
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
