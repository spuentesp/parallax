import { describe, expect, it } from 'vitest';
import {
  buildGraphChildren,
  buildGraphRoot,
  classifyNode,
  deriveLainRepoId,
  resolveSymbolSnippet,
} from '../src/code-graph.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

describe('classifyNode', () => {
  it('groups node types into the four UI families', () => {
    expect(classifyNode('File')).toBe('container');
    expect(classifyNode('Namespace')).toBe('container');
    expect(classifyNode('Module')).toBe('container');
    expect(classifyNode('Function')).toBe('symbol');
    expect(classifyNode('Method')).toBe('symbol');
    expect(classifyNode('Struct')).toBe('symbol');
    expect(classifyNode('HttpRoute')).toBe('route');
    expect(classifyNode('Topic')).toBe('route');
    expect(classifyNode('Schema')).toBe('schema');
    expect(classifyNode('SomethingNew')).toBe('other');
  });
});

describe('deriveLainRepoId', () => {
  it('takes the basename of the local checkout', () => {
    expect(deriveLainRepoId({ uri: 'fixture://contracts/orders', local: './test-repos/contracts-fixture/orders' })).toBe(
      'orders',
    );
    expect(deriveLainRepoId({ uri: 'https://github.com/x/y.git', local: './test-repos/y' })).toBe('y');
  });

  it('falls back to the URI basename without .git', () => {
    expect(deriveLainRepoId({ uri: 'https://github.com/saleor/saleor.git' })).toBe('saleor');
    expect(deriveLainRepoId({ uri: 'fixture://contracts/billing', local: null })).toBe('billing');
  });
});

describe('buildGraphRoot (mock engine)', () => {
  it('returns the high-level structure per repo, typed and classified', async () => {
    const root = await buildGraphRoot(createLainMock(), ['orders']);
    expect(root.repos).toHaveLength(1);
    const orders = root.repos[0];
    expect(orders?.error).toBeUndefined();
    const types = new Set(orders?.nodes.map((n) => n.type));
    expect(types.has('File')).toBe(true);
    expect(types.has('HttpRoute')).toBe(true);
    expect(types.has('Topic')).toBe(true);
    expect(orders?.nodes.find((n) => n.name === 'main.rs')?.kind).toBe('container');
    expect(orders?.nodes.find((n) => n.name === 'POST /api/orders')?.kind).toBe('route');
    expect(orders?.truncated).toBe(false);
  });

  it('marks truncation when the repo returns exactly the limit', async () => {
    const root = await buildGraphRoot(createLainMock(), ['orders'], 5);
    expect(root.repos[0]?.nodes).toHaveLength(5);
    expect(root.repos[0]?.truncated).toBe(true);
  });

  it('surfaces a per-repo error instead of failing the whole workspace', async () => {
    const broken = {
      ...createLainMock(),
      queryGraph: async () => {
        throw new Error('Config error: repo not found');
      },
    } as LainAdapter;
    const root = await buildGraphRoot(broken, ['missing']);
    expect(root.repos[0]?.nodes).toEqual([]);
    expect(root.repos[0]?.error).toContain('repo not found');
  });
});

describe('buildGraphChildren (mock engine)', () => {
  it('expands a File into its contained symbols via Contains outgoing', async () => {
    const res = await buildGraphChildren(createLainMock(), {
      repo: 'orders',
      type: 'File',
      name: 'main.rs',
    });
    expect(res.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      'Function:main',
      'Module:orders',
    ]);
    expect(res.hasCommunication).toBe(false);
  });

  it('groups communication neighbours by edge type (one query per edge)', async () => {
    const seen: string[] = [];
    const mock = createLainMock();
    const spy: LainAdapter = {
      ...mock,
      queryGraph: async (req) => {
        const connect = req.query.ops.find((o) => 'edge' in o) as { edge?: string } | undefined;
        if (connect?.edge && connect.edge !== 'Contains') seen.push(connect.edge);
        return mock.queryGraph(req);
      },
    };
    const res = await buildGraphChildren(spy, {
      repo: 'orders',
      type: 'Function',
      name: 'create_order',
    });
    // Una consulta por cada arista de comunicación, en orden.
    expect(seen).toEqual(['Calls', 'Uses', 'Imports', 'Produces', 'Consumes', 'CallsHttp']);
    expect(res.hasCommunication).toBe(true);
    const uses = res.communications.find((g) => g.edge === 'Uses');
    expect(uses?.nodes.map((n) => n.name)).toEqual(['CreateOrder']);
    const callsHttp = res.communications.find((g) => g.edge === 'CallsHttp');
    expect(callsHttp?.nodes[0]?.type).toBe('HttpRoute');
  });

  it('reports honestly when a leaf has no communication edges', async () => {
    // El mock no conoce a `main` en las aristas de comunicación: todas vacías.
    const res = await buildGraphChildren(createLainMock(), {
      repo: 'orders',
      type: 'Function',
      name: 'main',
    });
    expect(res.hasCommunication).toBe(false);
    expect(res.communications.filter((g) => g.nodes.length > 0)).toEqual([]);
  });

  it('records a failing edge query as an error, never as a silent gap', async () => {
    const mock = createLainMock();
    const spy: LainAdapter = {
      ...mock,
      queryGraph: async (req) => {
        const connect = req.query.ops.find((o) => 'edge' in o) as { edge?: string } | undefined;
        if (connect?.edge === 'Imports') throw new Error('Imports is not indexed');
        return mock.queryGraph(req);
      },
    };
    const res = await buildGraphChildren(spy, {
      repo: 'orders',
      type: 'File',
      name: 'main.rs',
    });
    const imports = res.communications.find((g) => g.edge === 'Imports');
    expect(imports?.error).toContain('not indexed');
    expect(imports?.nodes).toEqual([]);
  });

  it('seeds the query by type+name (the engine ignores the id filter)', async () => {
    const specs: unknown[] = [];
    const mock = createLainMock();
    const spy: LainAdapter = {
      ...mock,
      queryGraph: async (req) => {
        specs.push(req.query);
        return mock.queryGraph(req);
      },
    };
    await buildGraphChildren(spy, { repo: 'orders', type: 'File', name: 'main.rs' });
    for (const spec of specs as Array<{ ops: Array<Record<string, unknown>> }>) {
      const find = spec.ops[0];
      expect(find?.op).toBe('find');
      expect(find?.type).toBe('File');
      expect(find?.name).toEqual({ exact: 'main.rs' });
      expect(find?.id).toBeUndefined();
    }
  });
});

describe('resolveSymbolSnippet', () => {
  it('resolves the path from explain_symbol and opens it with get_code_snippet', async () => {
    const res = await resolveSymbolSnippet(createLainMock(), 'orders', 'create_order');
    expect(res.path).toBe('mock/create_order.rs');
    expect(res.text).toContain('mock line 1');
    expect(res.error).toBeUndefined();
  });

  it('returns an honest error when explain_symbol fails', async () => {
    const mock = createLainMock();
    const spy: LainAdapter = {
      ...mock,
      explainSymbol: async () => {
        throw new Error('Node not found');
      },
    };
    const res = await resolveSymbolSnippet(spy, 'orders', 'ghost');
    expect(res.path).toBeNull();
    expect(res.text).toBeNull();
    expect(res.error).toContain('Node not found');
  });
});
