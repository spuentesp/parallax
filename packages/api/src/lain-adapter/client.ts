import { LainCallError } from './errors.js';
import type { LainAdapter } from './types.js';

export interface LainClientConfig {
  readonly lainUrl: string;
  readonly apiVersion: '1';
  readonly timeoutMs?: number;
}

class NotImplementedError extends Error {
  constructor() {
    super('LainAdapter real client is not implemented in subproject 1; subproject 2 will fill it in');
    this.name = 'NotImplementedError';
  }
}

async function probeLain(url: string, timeoutMs: number): Promise<void> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `LainUnavailable: lain probe returned HTTP ${res.status}`,
      });
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw LainCallError.parse({
        code: 'LainUnavailable',
        message: `LainUnavailable: lain probe timed out at ${url}`,
      });
    }
    const isLainError = (e as { code?: string }).code === 'LainUnavailable';
    if (isLainError) throw e;
    throw LainCallError.parse({
      code: 'LainUnavailable',
      message: `LainUnavailable: cannot reach lain at ${url}: ${(e as Error).message}`,
    });
  } finally {
    clearTimeout(t);
  }
}

export async function createLainClient(config: LainClientConfig): Promise<LainAdapter> {
  const timeoutMs = config.timeoutMs ?? 10_000;
  await probeLain(config.lainUrl, timeoutMs);

  const notImpl = async (): Promise<never> => {
    throw new NotImplementedError();
  };

  const adapter: LainAdapter = {
    analyzerVersion: '0.0.0-unknown',
    apiVersion: '1',
    listServices: notImpl,
    getService: notImpl,
    prepareSnapshot: notImpl,
    getSnapshot: notImpl,
    diffContracts: notImpl,
    traceImpact: notImpl,
    getCoverage: notImpl,
    resolveEvidence: notImpl,
    readSource: notImpl,
  };
  return adapter;
}
