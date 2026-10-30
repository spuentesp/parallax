import { describe, expect, it } from 'vitest';
import { RealLainAdapter } from '../src/lain-adapter/client.js';

describe('RealLainAdapter native Lain 0.13 tools', () => {
  it('forwards trace_flow and returns the engine result unchanged', async () => {
    const data = {
      from: { symbol: 'getOrder' },
      direction: 'downstream',
      seeds: ['getOrder'],
      paths: [],
      gaps: [],
      truncated: false,
      truncation_reasons: [],
      nodes_visited: 1,
      scope: { reviewed: [], unreviewed: [] },
      strategy: 'depth',
    };
    let requestBody: Record<string, unknown> = {};
    const adapter = new RealLainAdapter(
      {
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              structuredContent: { analyzer_version: '0.13.0', api_version: 1, data },
            },
          });
        },
      },
      '0.13.0',
    );
    const result = await adapter.traceFlow({
      snapshot: 'live',
      from: { symbol: 'getOrder' },
      strategy: 'depth',
      depth: 4,
      cap: 20,
    });
    expect(requestBody).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'trace_flow',
        arguments: {
          snapshot: 'live',
          from: { symbol: 'getOrder' },
          strategy: 'depth',
          depth: 4,
          cap: 20,
        },
      },
    });
    expect(result).toEqual(data);
  });

  it('forwards atomic contract context and service reference calls', async () => {
    const names: string[] = [];
    const adapter = new RealLainAdapter(
      {
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as {
            params: { name: string; arguments: Record<string, unknown> };
          };
          names.push(body.params.name);
          const data =
            body.params.name === 'apply_contract_context'
              ? { applied: true, dry_run: false, backup: '/tmp/repos.yaml.bak' }
              : { items: [], scope: { reviewed: [], unreviewed: [] } };
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              structuredContent: { analyzer_version: '0.13.0', api_version: 1, data },
            },
          });
        },
      },
      '0.13.0',
    );
    const applied = await adapter.applyContractContext({
      snapshot: 'live',
      dry_run: false,
      provides: [{ service: 'api', key: 'http:GET /orders' }],
    });
    const refs = await adapter.listServiceRefs({ snapshot: 'live', suggestions: true });
    expect(applied).toMatchObject({ applied: true, backup: '/tmp/repos.yaml.bak' });
    expect(refs.items).toEqual([]);
    expect(names).toEqual(['apply_contract_context', 'list_service_refs']);
  });
});
