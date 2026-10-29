import { describe, expect, it } from 'vitest';
import {
  buildGraphChildren,
  buildGraphRoot,
  classifyNode,
  deriveLainRepoId,
  resolvePathSnippet,
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
    expect(
      deriveLainRepoId({
        uri: 'fixture://contracts/orders',
        local: './test-repos/contracts-fixture/orders',
      }),
    ).toBe('orders');
    expect(deriveLainRepoId({ uri: 'https://github.com/x/y.git', local: './test-repos/y' })).toBe(
      'y',
    );
  });

  it('falls back to the URI basename without .git', () => {
    expect(deriveLainRepoId({ uri: 'https://github.com/saleor/saleor.git' })).toBe('saleor');
    expect(deriveLainRepoId({ uri: 'fixture://contracts/billing', local: null })).toBe('billing');
  });
});

import { isNoise } from '../src/code-graph.js';
import { fakeCodeEngine } from './fake-code-engine.js';

describe('buildGraphRoot — the top of a repo is its top-level folders', () => {
  const engine = fakeCodeEngine({
    '': ['package.json', 'README.md'],
    src: ['index.tsx'],
    'src/components': ['Button.tsx', 'Button.test.tsx'],
    'src/orders/components': ['OrderList.tsx'],
    scripts: ['build.ts'],
    docs: ['guide.md'],
    '.github': ['CODEOWNERS'],
    e2e: ['login.spec.ts'],
    __mocks__: ['fs.ts'],
  });

  it('lists only directories no other directory contains — never a flat dump of every file', async () => {
    const root = await buildGraphRoot(engine, ['web']);
    const names = root.repos[0]?.nodes.map((n) => n.name);
    expect(names).toEqual(['docs', 'scripts', 'src']);
    // Los nombres repetidos más abajo ("components" x2) no se confunden con la cima.
    expect(root.repos[0]?.nodes.every((n) => n.type === 'Namespace')).toBe(true);
  });

  it('declares what it left out (hidden folders, e2e, mocks) instead of silently dropping it', async () => {
    const root = await buildGraphRoot(engine, ['web']);
    expect(root.repos[0]?.hidden).toBe(3);
  });

  it('shows everything when asked', async () => {
    const root = await buildGraphRoot(engine, ['web'], undefined, { all: true });
    expect(root.repos[0]?.nodes.map((n) => n.name).sort()).toEqual(
      ['.github', '__mocks__', 'docs', 'e2e', 'scripts', 'src'].sort(),
    );
    expect(root.repos[0]?.hidden).toBe(0);
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

describe('opening a folder — directories first, noise counted not listed', () => {
  const engine = fakeCodeEngine({
    src: ['zeta.ts', 'alpha.ts', 'alpha.test.ts', 'Card.stories.tsx', '.eslintrc.js'],
    'src/components': [],
    'src/__mocks__': [],
  });

  it('puts folders before files, then sorts by name, and hides tests/stories/dotfiles with a count', async () => {
    const res = await buildGraphChildren(engine, { repo: 'web', type: 'Namespace', name: 'src' });
    expect(res.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      'Namespace:components',
      'File:alpha.ts',
      'File:zeta.ts',
    ]);
    // alpha.test.ts, Card.stories.tsx, .eslintrc.js y la carpeta __mocks__.
    expect(res.childrenHidden).toBe(4);
  });

  it('`all` returns them too', async () => {
    const res = await buildGraphChildren(
      engine,
      { repo: 'web', type: 'Namespace', name: 'src' },
      { all: true },
    );
    expect(res.children).toHaveLength(7);
    expect(res.childrenHidden).toBe(0);
  });
});

describe('isNoise', () => {
  it('hides what does not help to understand a repo, by name', () => {
    for (const n of [
      '.github',
      '__mocks__',
      '__snapshots__',
      'node_modules',
      'e2e',
      'testUtils',
      'fixtures',
    ]) {
      expect(isNoise({ name: n, type: 'Namespace' }), n).toBe(true);
    }
    for (const n of ['a.test.ts', 'a.spec.tsx', 'a.stories.tsx', 'a.snap', '.env']) {
      expect(isNoise({ name: n, type: 'File' }), n).toBe(true);
    }
    for (const n of ['src', 'orders', 'checkout'])
      expect(isNoise({ name: n, type: 'Namespace' }), n).toBe(false);
    for (const n of ['index.ts', 'Button.tsx', 'README.md'])
      expect(isNoise({ name: n, type: 'File' }), n).toBe(false);
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

describe('resolvePathSnippet (mock engine)', () => {
  it('opens a file by path without going through explain_symbol', async () => {
    const r = await resolvePathSnippet(createLainMock(), 'orders', 'src/api.py');
    expect(r).toMatchObject({ repo: 'orders', path: 'src/api.py', symbol: 'src/api.py' });
    expect(r.text).toMatch(/mock line 1/);
    expect(r.error).toBeUndefined();
  });

  it('reports the engine failure instead of an empty snippet', async () => {
    const failing = {
      ...createLainMock(),
      getCodeSnippet: async () => {
        throw new Error('index cannot open it');
      },
    } as unknown as LainAdapter;
    const r = await resolvePathSnippet(failing, 'orders', 'src/api.py');
    expect(r.text).toBeNull();
    expect(r.error).toBe('index cannot open it');
  });
});
