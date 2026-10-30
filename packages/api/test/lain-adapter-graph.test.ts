import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainClient, resetLainClientPool } from '../src/lain-adapter/client.js';
import { createLainMock, getLainMockCalls, resetLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

// Tools del grafo crudo: el cliente debe hablar `query` (no `spec`), envolver
// el markdown de las tools de lectura como {text} y no romper con la omisión
// de `nodes` cuando el resultado está vacío.

function rpcResult(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const CONTRACT_TOOLS = [
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
  'trace_flow',
  'apply_contract_context',
  'list_service_refs',
  'get_coverage',
  'resolve_evidence',
  'read_source',
].map((name) => ({ name }));

function bootMocks(fetchSpy: ReturnType<typeof vi.spyOn>): void {
  // Discovery, version probe, then optional graph packages.
  fetchSpy.mockResolvedValueOnce(rpcResult({ tools: CONTRACT_TOOLS }));
  fetchSpy.mockResolvedValueOnce(
    rpcResult({
      structuredContent: {
        analyzer_version: '0.11.0',
        api_version: 1,
        data: { items: [], scope: { configured_only: true, reviewed: [], unreviewed: [] } },
      },
    }),
  );
  for (const pkg of ['raw', 'arch', 'workspace']) {
    fetchSpy.mockResolvedValueOnce(
      rpcResult({ content: [{ text: JSON.stringify({ package: pkg, already_loaded: true }) }] }),
    );
  }
}

describe('LainAdapter graph methods (real client)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLainClientPool();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    resetLainClientPool();
  });

  async function connected(): Promise<LainAdapter> {
    bootMocks(fetchSpy);
    return createLainClient({ lainUrl: 'http://lain.test:9999/mcp', apiVersion: '1' });
  }

  it('queryGraph sends the ops pipeline under `query` + repo_id', async () => {
    const a = await connected();
    fetchSpy.mockResolvedValueOnce(
      rpcResult({
        content: [
          {
            text: JSON.stringify({
              count: 2,
              legacy: false,
              nodes: [
                { id: 'x', name: 'main.rs', type: 'File' },
                { id: 'y', name: 'main', type: 'Function' },
              ],
            }),
          },
        ],
      }),
    );
    const res = await a.queryGraph({
      query: { ops: [{ op: 'find', path: 'src/main.rs' }] },
      repo_id: 'orders',
    });
    expect(res.count).toBe(2);
    expect(res.nodes[1]?.type).toBe('Function');

    const last = fetchSpy.mock.calls.at(-1)?.[1] as { body: string };
    const body = JSON.parse(last.body) as {
      params: {
        name: string;
        arguments: { query: { ops: unknown[] }; repo_id: string; spec?: unknown };
      };
    };
    expect(body.params.name).toBe('query_graph');
    expect(body.params.arguments.repo_id).toBe('orders');
    expect(body.params.arguments.query.ops).toEqual([{ op: 'find', path: 'src/main.rs' }]);
    expect(body.params.arguments.spec).toBeUndefined();
  });

  it('queryGraph normalizes an empty payload (engine omits nodes) to []', async () => {
    const a = await connected();
    fetchSpy.mockResolvedValueOnce(
      rpcResult({ content: [{ text: JSON.stringify({ count: 0, legacy: false }) }] }),
    );
    const res = await a.queryGraph({
      query: { ops: [{ op: 'find', type: 'Function', name: 'nope' }] },
      repo_id: 'orders',
    });
    expect(res.count).toBe(0);
    expect(res.nodes).toEqual([]);
  });

  it('getCodeSnippet wraps the plain-text payload as {text}', async () => {
    const a = await connected();
    fetchSpy.mockResolvedValueOnce(
      rpcResult({ content: [{ text: 'File: /abs/create.rs\nShowing lines 1-3' }] }),
    );
    const res = await a.getCodeSnippet({ path: 'src/orders/create.rs', repo_id: 'orders' });
    expect(res.text).toContain('File:');
  });

  it('explainSymbol wraps markdown and getCallSites reports leaves verbatim', async () => {
    const a = await connected();
    fetchSpy.mockResolvedValueOnce(
      rpcResult({
        content: [{ text: "## Explanation for 'main' (Function)\n**Path:** src/main.rs" }],
      }),
    );
    const explained = await a.explainSymbol({ symbol: 'main', repo_id: 'orders' });
    expect(explained.text).toContain('**Path:** src/main.rs');

    fetchSpy.mockResolvedValueOnce(
      rpcResult({ content: [{ text: "No call sites found for 'main' (main is a leaf)" }] }),
    );
    const sites = await a.getCallSites({ symbol: 'main', repo_id: 'orders' });
    expect(sites.text).toContain('is a leaf');
  });

  it('describeSchema returns the node/edge catalogs', async () => {
    const a = await connected();
    fetchSpy.mockResolvedValueOnce(
      rpcResult({
        content: [
          {
            text: JSON.stringify({
              node_types: [{ name: 'File' }],
              edge_types: [{ name: 'Contains' }],
            }),
          },
        ],
      }),
    );
    const schema = await a.describeSchema({});
    expect(schema.node_types[0]?.name).toBe('File');
    expect(schema.edge_types[0]?.name).toBe('Contains');
  });
});

describe('LainAdapter mock graph methods', () => {
  beforeEach(() => resetLainMock());

  it('queryGraph serves the fixture graph and records the call', async () => {
    const mock = createLainMock();
    const res = await mock.queryGraph({
      query: {
        ops: [
          { op: 'find', type: ['File', 'Namespace', 'Module', 'HttpRoute', 'Topic'] },
          { op: 'limit', count: 200 },
        ],
      },
      repo_id: 'orders',
    });
    expect(res.count).toBeGreaterThan(0);
    expect(getLainMockCalls().some((c) => c.tool === 'query_graph')).toBe(true);
  });

  it('explainSymbol and getCodeSnippet round-trip a path', async () => {
    const mock = createLainMock();
    const explained = await mock.explainSymbol({ symbol: 'create_order', repo_id: 'orders' });
    const path = /\*\*Path:\*\*\s*(.+)/.exec(explained.text)?.[1]?.trim();
    expect(path).toBe('mock/create_order.rs');
    const snippet = await mock.getCodeSnippet({ path: path ?? '', repo_id: 'orders' });
    expect(snippet.text).toContain('mock line');
  });

  it('loadPackage is idempotent-friendly (already_loaded)', async () => {
    const mock = createLainMock();
    const res = await mock.loadPackage({ package: 'raw' });
    expect(res.already_loaded).toBe(true);
    expect(res.loaded).toBe(true);
  });
});
