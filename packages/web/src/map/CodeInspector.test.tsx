import type { ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { CodeInspector } from './CodeInspector.js';
import type { CodeEntry } from './code.js';

afterEach(cleanup);

const node = (over: Partial<ProjectedNode> = {}): ProjectedNode => ({
  id: 'sym:orders|Function|f',
  label: 'f',
  kind: 'symbol',
  parent: 'code:orders',
  meta: { repo: 'orders', type: 'Function', name: 'f' },
  childCount: 0,
  expanded: false,
  contract: 'Function',
  ...over,
});
const ready = (
  communications: Array<{
    edge: string;
    nodes: Array<{ id: string; name: string; type: string; kind: 'other' }>;
    error?: string;
  }>,
): CodeEntry => ({
  state: 'ready',
  children: [],
  truncated: false,
  communications,
});
const nb = (name: string, type: string) => ({
  id: `${type}-${name}`,
  name,
  type,
  kind: 'other' as const,
});

function setup(over: Partial<Parameters<typeof CodeInspector>[0]> = {}) {
  const h = { onSelect: vi.fn(), onToggle: vi.fn() };
  renderWithQuery(
    <CodeInspector
      workspaceId="ws1"
      nodeId="sym:orders|Function|f"
      node={node()}
      entry={ready([])}
      trail={[]}
      {...h}
      {...over}
    />,
  );
  return h;
}

describe('CodeInspector', () => {
  it('explains a node that is not loaded', () => {
    setup({ node: undefined });
    expect(screen.getByTestId('code-inspector-missing').textContent).toMatch(
      /sym:orders\|Function\|f/,
    );
  });

  it('shows kind and type, the title in monospace, and a breadcrumb from the root', () => {
    const h = setup({
      trail: [
        { ...node(), id: 'code:orders', label: 'Code', kind: 'code', meta: { repo: 'orders' } },
        { ...node(), id: 'repo:orders', label: 'orders', kind: 'repo', meta: {} },
      ],
    });
    const view = within(screen.getByTestId('code-inspector'));
    expect(view.getByText('Symbol')).toBeTruthy();
    expect(view.getByText('Function')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'f' }).className).toMatch(/font-mono/);
    const crumbs = view.getAllByRole('button').map((b) => b.textContent);
    expect(crumbs.slice(0, 2)).toEqual(['orders', 'Code']);
    fireEvent.click(view.getByRole('button', { name: 'Code' }));
    expect(h.onSelect).toHaveBeenCalledWith('code:orders');
  });

  it('"Ask about this function" asks about the symbol, and is absent on the Code door', () => {
    const onAsk = vi.fn();
    setup({ onAsk });
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this function' }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('f'));
    cleanup();
    setup({ onAsk, node: node({ kind: 'code', label: 'Code' }) });
    expect(screen.queryByRole('button', { name: /Ask about this/ })).toBeNull();
  });

  it('Open / Close appears only for lazy nodes and toggles', () => {
    const h = setup({ node: node({ lazy: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(h.onToggle).toHaveBeenCalledWith('sym:orders|Function|f');
    cleanup();
    setup({ node: node({ lazy: true, expanded: true }) });
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    cleanup();
    setup();
    expect(screen.queryByRole('button', { name: /^(Open|Close)$/ })).toBeNull();
  });

  it('the Code door explains itself instead of listing relationships', () => {
    setup({
      nodeId: 'code:orders',
      node: node({
        id: 'code:orders',
        kind: 'code',
        label: 'Code',
        meta: { repo: 'orders' },
        lazy: true,
      }),
    });
    expect(screen.getByText(/read from/i)).toBeTruthy();
    expect(screen.getByText(/not drawn as lines/i)).toBeTruthy();
    expect(screen.queryByText(/communication edges/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'View source' })).toBeNull();
    expect(screen.getByText('Code', { selector: 'h3' })).toBeTruthy();
  });

  it('relationship states: loading, error, none, and grouped by edge with a direction caveat', () => {
    setup({ entry: undefined });
    expect(screen.getByText('Loading relationships…')).toBeTruthy();
    cleanup();
    setup({ entry: { state: 'loading' } });
    expect(screen.getByText('Loading relationships…')).toBeTruthy();
    cleanup();
    setup({ entry: { state: 'error', message: 'timed out' } });
    expect(screen.getByText('timed out')).toBeTruthy();
    cleanup();
    setup({ entry: ready([{ edge: 'Calls', nodes: [] }]) });
    expect(screen.getByTestId('code-no-comm')).toBeTruthy();
    cleanup();
    setup({
      entry: ready([
        { edge: 'Calls', nodes: [nb('validate', 'Function'), nb('save', 'Function')] },
        { edge: 'Uses', nodes: [nb('Order', 'Struct')] },
        { edge: 'Imports', nodes: [], error: 'not indexed' },
        { edge: 'Produces', nodes: [] },
      ]),
    });
    const rel = within(screen.getByTestId('code-relations'));
    expect(rel.getByText('Calls')).toBeTruthy();
    expect(rel.getByText('· 2')).toBeTruthy();
    expect(rel.getByText('validate')).toBeTruthy();
    expect(rel.getByText('Order').getAttribute('title')).toBe('Order');
    expect(rel.getByText('STRUCT', { exact: false })).toBeTruthy();
    expect(rel.getByText('Imports')).toBeTruthy();
    expect(rel.getByText('not indexed')).toBeTruthy();
    expect(rel.queryByText('Produces')).toBeNull();
    expect(rel.getByText(/does not report direction/i)).toBeTruthy();
  });

  it('source: files by path, symbols by name, nothing for modules/namespaces or unknown repos', () => {
    setup({
      node: node({
        kind: 'file',
        label: 'main.rs',
        meta: { repo: 'orders', type: 'File', name: 'main.rs' },
      }),
    });
    expect(screen.getByRole('button', { name: 'View source' })).toBeTruthy();
    cleanup();
    setup();
    expect(screen.getByRole('button', { name: 'View source' })).toBeTruthy();
    cleanup();
    setup({
      node: node({
        kind: 'file',
        label: 'mod',
        meta: { repo: 'orders', type: 'Module', name: 'mod' },
      }),
    });
    expect(screen.queryByRole('button', { name: 'View source' })).toBeNull();
    cleanup();
    setup({ node: node({ meta: { type: 'Function', name: 'f' } }) });
    expect(screen.queryByRole('button', { name: 'View source' })).toBeNull();
  });
});

describe('CodeInspector: how a symbol links to the rest', () => {
  const links = (over: Record<string, unknown>) =>
    server.use(
      http.get('/api/workspaces/:id/graph/symbol-links', () =>
        HttpResponse.json({
          source: 'lain',
          symbol: 'f',
          repo: 'orders',
          path: 'src/f.ts',
          note: null,
          coChange: null,
          crossRepo: { repositories: [], truncated: false },
          crossRepoNote: null,
          ...over,
        }),
      ),
    );

  it('lists the files that change together with it, how often, and how many the engine has', async () => {
    links({
      coChange: {
        status: 'found',
        total: 45,
        partners: [
          { path: 'src/api/hooks.ts', times: 6 },
          { path: 'src/map/MapCanvas.tsx', times: 5 },
        ],
      },
    });
    setup();
    const section = within(await screen.findByRole('region', { name: 'Changes together with' }));
    expect(section.getByText('src/api/hooks.ts')).toBeTruthy();
    expect(section.getByText('6×')).toBeTruthy();
    expect(section.getByText('Showing 2 of 45 files.')).toBeTruthy();
  });

  it('with no history it says why, instead of claiming the symbol changes alone', async () => {
    links({ coChange: { status: 'none', total: null, partners: [] } });
    setup();
    const section = within(await screen.findByRole('region', { name: 'Changes together with' }));
    expect(section.getByText(/needs git history/)).toBeTruthy();
    expect(section.getByText(/not proof it changes alone/)).toBeTruthy();
  });

  it('shows which other repos reach it, and marks a truncated count', async () => {
    links({
      coChange: { status: 'none', total: null, partners: [] },
      crossRepo: {
        truncated: true,
        repositories: [
          { repo: 'nemoclaw', leaves: ['a', 'b', 'c'] },
          { repo: 'openshell', leaves: ['d'] },
        ],
      },
    });
    setup();
    const section = within(await screen.findByRole('region', { name: 'Boundary to another repo' }));
    expect(section.getByText('nemoclaw')).toBeTruthy();
    expect(section.getByText('3+ entry points')).toBeTruthy();
    expect(section.getByText('1+ entry points')).toBeTruthy();
  });

  it('an empty reach is stated, not left blank', async () => {
    links({ coChange: { status: 'none', total: null, partners: [] } });
    setup();
    const section = within(await screen.findByRole('region', { name: 'Boundary to another repo' }));
    expect(section.getByText(/No other repository reaches it/)).toBeTruthy();
  });

  it('a name shared by several symbols shows nothing attributed, with the reason', async () => {
    links({
      path: null,
      note: '8 symbols in this repo are named "f" (a.py, b.py, c.py, …), and the map node does not say which one this is',
    });
    setup();
    const note = await screen.findByTestId('symbol-links-note');
    expect(note.textContent).toMatch(/8 symbols in this repo are named "f"/);
    expect(screen.queryByRole('region', { name: 'Changes together with' })).toBeNull();
  });

  it('a cross-repo answer the engine could not pin down is withheld with its reason', async () => {
    links({
      coChange: { status: 'none', total: null, partners: [] },
      crossRepo: null,
      crossRepoNote:
        'the engine could not tell which symbol this is, so it will not say who reaches it',
    });
    setup();
    const section = within(await screen.findByRole('region', { name: 'Boundary to another repo' }));
    expect(section.getByText(/will not say who reaches it/)).toBeTruthy();
  });

  it('is not offered for a file or the Code door', async () => {
    links({});
    setup({ node: node({ kind: 'file', label: 'a.ts', meta: { repo: 'orders', type: 'File' } }) });
    await screen.findByTestId('code-inspector');
    expect(screen.queryByTestId('symbol-links')).toBeNull();
  });
});
