import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import { describe, expect, it } from 'vitest';
import {
  type CodeState,
  canOpen,
  codeNodeId,
  codeRootId,
  isCodeId,
  isOpenableType,
  mergeCode,
  parseCodeId,
} from './code.js';

const repoNode = (over: Partial<ProjectedNode> = {}): ProjectedNode => ({
  id: 'repo:orders',
  label: 'orders',
  kind: 'repo',
  parent: null,
  meta: { lainRepoId: 'orders' },
  childCount: 2,
  expanded: true,
  ...over,
});
const view = (nodes: ProjectedNode[]): MapViewResponse => ({
  nodes,
  edges: [],
  hiddenChildren: {},
  focus: null,
  unknownExpand: [],
  meta: { source: 'lain' },
});
const ready = (children: Array<{ type: string; name: string }>, truncated = false) => ({
  state: 'ready' as const,
  children: children.map((c, i) => ({ id: `n${i}`, kind: 'symbol' as const, ...c })),
  truncated,
  communications: [],
});

describe('code ids', () => {
  it('round-trips roots and nodes, keeping "|" inside names', () => {
    expect(parseCodeId(codeRootId('orders'))).toEqual({ kind: 'root', repo: 'orders' });
    const id = codeNodeId('orders', 'Function', 'a|b');
    expect(parseCodeId(id)).toEqual({
      kind: 'node',
      repo: 'orders',
      type: 'Function',
      name: 'a|b',
    });
    expect(isCodeId('repo:orders')).toBe(false);
    expect(isCodeId('svc:x')).toBe(false);
    expect(parseCodeId('sym:broken')).toBeNull();
  });
});

describe('canOpen', () => {
  it('a linked repo opens even when the contract analysis found nothing inside it', () => {
    expect(canOpen(repoNode({ childCount: 0 }))).toBe(true);
    expect(canOpen(repoNode({ childCount: 0, meta: { lainRepoId: null } }))).toBe(false);
    expect(canOpen(repoNode({ childCount: 0, meta: {} }))).toBe(false);
  });
  it('lazy code nodes and nodes with analysed children open; leaves do not', () => {
    expect(canOpen({ ...repoNode(), kind: 'symbol', meta: {}, childCount: 0, lazy: true })).toBe(
      true,
    );
    expect(canOpen({ ...repoNode(), kind: 'service', meta: {}, childCount: 4 })).toBe(true);
    expect(canOpen({ ...repoNode(), kind: 'endpoint', meta: {}, childCount: 0 })).toBe(false);
  });
});

describe('mergeCode', () => {
  it('offers "Code" inside an open repo and counts it among its contents', () => {
    const m = mergeCode(view([repoNode()]), new Set(), {});
    const code = m.nodes.find((n) => n.id === 'code:orders');
    expect(code).toMatchObject({
      kind: 'code',
      parent: 'repo:orders',
      lazy: true,
      expanded: false,
    });
    expect(m.nodes.find((n) => n.id === 'repo:orders')?.childCount).toBe(3);
  });

  it('adds nothing for a closed repo', () => {
    const v = view([repoNode({ expanded: false })]);
    expect(mergeCode(v, new Set(), {})).toBe(v);
  });

  it('never opens the code of a repo it could not identify with a LAIN repo_id', () => {
    const v = view([repoNode({ meta: { lainRepoId: null } })]);
    expect(mergeCode(v, new Set(), {}).nodes.some((n) => n.kind === 'code')).toBe(false);
    const missing = view([repoNode({ meta: {} })]);
    expect(mergeCode(missing, new Set(), {}).nodes.some((n) => n.kind === 'code')).toBe(false);
  });

  it('shows what LAIN returned, typed: containers as files, the rest as symbols', () => {
    const state: CodeState = {
      'code:orders': ready([
        { type: 'File', name: 'main.rs' },
        { type: 'HttpRoute', name: 'POST /api/orders' },
      ]),
    };
    const m = mergeCode(view([repoNode()]), new Set(['code:orders']), state);
    const main = m.nodes.find((n) => n.label === 'main.rs');
    expect(main).toMatchObject({
      kind: 'file',
      parent: 'code:orders',
      contract: 'File',
      lazy: true,
    });
    const route = m.nodes.find((n) => n.label === 'POST /api/orders');
    expect(route).toMatchObject({ kind: 'symbol', contract: 'HttpRoute' });
    // Una ruta no contiene nada: no ofrece abrirse.
    expect(route?.lazy).toBeUndefined();
  });

  it('nests deeper levels only under nodes the user opened', () => {
    const file = codeNodeId('orders', 'File', 'main.rs');
    const state: CodeState = {
      'code:orders': ready([{ type: 'File', name: 'main.rs' }]),
      [file]: ready([{ type: 'Function', name: 'main' }]),
    };
    const closed = mergeCode(view([repoNode()]), new Set(['code:orders']), state);
    expect(closed.nodes.some((n) => n.label === 'main')).toBe(false);
    const open = mergeCode(view([repoNode()]), new Set(['code:orders', file]), state);
    expect(open.nodes.find((n) => n.label === 'main')).toMatchObject({
      kind: 'symbol',
      parent: file,
    });
  });

  it('does not show children that were requested but have not arrived', () => {
    const state: CodeState = { 'code:orders': { state: 'loading' } };
    const m = mergeCode(view([repoNode()]), new Set(['code:orders']), state);
    expect(m.nodes.find((n) => n.id === 'code:orders')?.meta.loading).toBe(true);
    expect(m.nodes.filter((n) => n.parent === 'code:orders')).toHaveLength(0);
  });

  it('surfaces a LAIN error on the node instead of an empty listing', () => {
    const state: CodeState = { 'code:orders': { state: 'error', message: 'query_graph failed' } };
    const m = mergeCode(view([repoNode()]), new Set(['code:orders']), state);
    expect(m.nodes.find((n) => n.id === 'code:orders')?.meta.error).toBe('query_graph failed');
  });

  it('marks a truncated listing so the UI can say there is more', () => {
    const state: CodeState = { 'code:orders': ready([{ type: 'File', name: 'a' }], true) };
    const m = mergeCode(view([repoNode()]), new Set(['code:orders']), state);
    expect(m.nodes.find((n) => n.id === 'code:orders')?.meta.truncated).toBe(true);
  });

  it('only types that can contain others are openable', () => {
    for (const t of ['File', 'Module', 'Class', 'Struct']) expect(isOpenableType(t)).toBe(true);
    for (const t of ['Function', 'Method', 'HttpRoute', 'Topic'])
      expect(isOpenableType(t)).toBe(false);
  });
});
