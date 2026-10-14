import { describe, expect, it } from 'vitest';
import {
  DescribeSchemaResponse,
  GetCodeSnippetArgs,
  LoadPackageArgs,
  QueryGraphArgs,
  QueryGraphResponse,
} from '../src/lain/graph.js';

// Contrato del grafo crudo contra el motor verificado en vivo (lain 0.9.1,
// fixture contracts en :9997). Estos payloads son literales de esa sesión:
// si el motor cambia la forma, estos tests fallan antes que la UI.

// Payload real de `query_graph` con resultados (find path src/main.rs).
const realQueryGraph = {
  count: 6,
  legacy: false,
  meta: { exec_us: 1165, nodes_visited: 6 },
  nodes: [
    { id: '3e8e3e15-a495-5be8-a8f0-23c992d4a0a7', name: 'main.rs', type: 'File' },
    { id: '8e9a7d4f-fbc7-52e7-a78f-e44c3bfb2e24', name: 'orders', type: 'Module' },
    { id: '0a6ff55f-a00e-5d09-93f2-488f06f07751', name: 'main', type: 'Function' },
  ],
  occupancy: { active_agents: [] },
};

describe('QueryGraphArgs', () => {
  it('accepts the live call shape: query (not spec) + repo_id', () => {
    const parsed = QueryGraphArgs.parse({
      query: { ops: [{ op: 'find', type: 'Function', name: 'main' }] },
      repo_id: 'orders',
    });
    expect(parsed.repo_id).toBe('orders');
    expect(parsed.query.ops).toHaveLength(1);
  });

  it('rejects the documented-but-wrong `spec` argument name', () => {
    // docs/query-language.md de lain dice `spec`; este motor exige `query`.
    expect(QueryGraphArgs.safeParse({ spec: { ops: [{ op: 'find' }] } }).success).toBe(false);
  });

  it('rejects an empty ops pipeline', () => {
    expect(QueryGraphArgs.safeParse({ query: { ops: [] }, repo_id: 'orders' }).success).toBe(
      false,
    );
  });
});

describe('QueryGraphResponse', () => {
  it('parses a real payload with nodes', () => {
    const parsed = QueryGraphResponse.parse(realQueryGraph);
    expect(parsed.count).toBe(6);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.nodes[0]?.type).toBe('File');
  });

  it('normalizes a missing nodes array to [] (the engine omits it when empty)', () => {
    // Payload real de una consulta sin resultados: sin chave `nodes`.
    const empty = {
      count: 0,
      legacy: false,
      meta: { exec_us: 111, nodes_visited: 1 },
      occupancy: { active_agents: [] },
    };
    const parsed = QueryGraphResponse.parse(empty);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.count).toBe(0);
  });
});

describe('DescribeSchemaResponse', () => {
  it('parses the live schema with node and edge type catalogs', () => {
    const parsed = DescribeSchemaResponse.parse({
      node_types: [{ name: 'File', description: 'A source file', indexed: true }],
      edge_types: [
        {
          name: 'Contains',
          source_types: ['File', 'Module', 'Namespace'],
          target_types: ['Function'],
          indexed: true,
        },
      ],
    });
    expect(parsed.node_types[0]?.name).toBe('File');
    expect(parsed.edge_types[0]?.name).toBe('Contains');
  });
});

describe('snippet tool args', () => {
  it('requires path for get_code_snippet', () => {
    expect(GetCodeSnippetArgs.safeParse({ repo_id: 'orders' }).success).toBe(false);
    expect(GetCodeSnippetArgs.safeParse({ path: 'src/main.rs', repo_id: 'orders' }).success).toBe(
      true,
    );
  });

  it('requires package for load_package', () => {
    expect(LoadPackageArgs.safeParse({}).success).toBe(false);
    expect(LoadPackageArgs.safeParse({ package: 'raw' }).success).toBe(true);
  });
});
