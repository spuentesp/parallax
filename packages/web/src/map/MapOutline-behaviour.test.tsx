import type { ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flattenOutline, MapOutline } from './MapOutline.js';

afterEach(cleanup);

const n = (over: Partial<ProjectedNode> & { id: string }): ProjectedNode => ({
  label: over.id,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});

const nodes: ProjectedNode[] = [
  n({ id: 'r', kind: 'repo', label: 'repo', childCount: 2, expanded: true }),
  n({ id: 's', parent: 'r', label: 'svc', childCount: 2, expanded: true }),
  n({ id: 'e1', kind: 'endpoint', parent: 's', label: 'http:GET /a', contract: 'http' }),
  n({ id: 'e2', kind: 'endpoint', parent: 's', label: 'abcdefghij:plain' }),
  n({
    id: 'c',
    kind: 'file',
    parent: 'r',
    label: 'main.rs',
    lazy: true,
    contract: 'File',
    meta: { loading: true },
  }),
  n({ id: 'f', kind: 'symbol', parent: 'r', label: 'broken', lazy: true, meta: { error: 'nope' } }),
  n({
    id: 'g',
    kind: 'symbol',
    parent: 'r',
    label: 'capped',
    lazy: true,
    expanded: true,
    meta: { truncated: true },
  }),
  n({ id: 'x', kind: 'service', label: 'closed', childCount: 5 }),
];

function setup(over: Partial<Parameters<typeof MapOutline>[0]> = {}) {
  const h = { onSelect: vi.fn(), onToggle: vi.fn(), onMore: vi.fn() };
  render(
    <MapOutline
      view={{ nodes, hiddenChildren: { s: 3 } }}
      selectedId={null}
      focusIds={null}
      {...h}
      {...over}
    />,
  );
  return h;
}
const row = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

describe('flattenOutline', () => {
  it('sorts siblings by label at every level and numbers the depth', () => {
    const rows = flattenOutline([
      n({ id: 'b', label: 'b' }),
      n({ id: 'a', label: 'a' }),
      n({ id: 'a2', label: 'z', parent: 'a' }),
      n({ id: 'a1', label: 'y', parent: 'a' }),
    ]);
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
    ]);
  });
  it('never drops a node because of a parent cycle: it shows as a root', () => {
    expect(flattenOutline([n({ id: 'a', parent: 'a' })]).map((r) => [r.node.id, r.depth])).toEqual([
      ['a', 0],
    ]);
    const cyc = flattenOutline([
      n({ id: 'a', parent: 'b' }),
      n({ id: 'b', parent: 'a' }),
      n({ id: 'c', parent: 'a' }),
    ]);
    expect(cyc.map((r) => r.node.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('MapOutline rows', () => {
  it('indents by depth', () => {
    setup();
    expect(row('r').style.paddingLeft).toBe('8px');
    expect(row('s').style.paddingLeft).toBe('24px');
    expect(row('e1').style.paddingLeft).toBe('40px');
  });

  it('marks selection and focus, and only those', () => {
    setup({ selectedId: 's', focusIds: new Set(['e1']) });
    expect(row('s').getAttribute('aria-selected')).toBe('true');
    expect(row('s').className).toMatch(/border-accent(?!\/)/);
    expect(row('r').getAttribute('aria-selected')).toBe('false');
    expect(row('e1').className).toMatch(/border-accent\/40/);
    expect(row('e2').className).not.toMatch(/border-accent/);
    expect(row('s').className).not.toMatch(/border-accent\/40/);
  });

  it('styles by kind: repos bold, endpoints/files/symbols monospaced, services plain', () => {
    setup();
    const cls = (id: string) =>
      within(row(id))
        .getAllByText(/.+/)
        .find((e) => e.getAttribute('class')?.includes('truncate'))
        ?.getAttribute('class') ?? '';
    expect(cls('r')).toMatch(/font-semibold/);
    expect(cls('e1')).toMatch(/font-mono/);
    expect(cls('c')).toMatch(/font-mono/);
    expect(cls('f')).toMatch(/font-mono/);
    expect(cls('s')).not.toMatch(/font-mono|font-semibold/);
  });

  it('trims a short contract prefix from endpoint labels only (and keeps the full one in the tooltip)', () => {
    setup();
    expect(within(row('e1')).getByText('GET /a').getAttribute('title')).toBe('http:GET /a');
    expect(within(row('e2')).getByText('abcdefghij:plain')).toBeTruthy();
    expect(within(row('c')).getByText('main.rs')).toBeTruthy();
  });

  it('shows the type/contract chip only when there is one', () => {
    setup();
    expect(within(row('e1')).getByText('http')).toBeTruthy();
    expect(within(row('c')).getByText('File')).toBeTruthy();
    expect(within(row('s')).queryByText(/^(http|File)$/)).toBeNull();
  });

  it('right-hand badge: count when closed with children; loading; failed with the reason; none otherwise', () => {
    setup();
    expect(within(row('x')).getByText('5')).toBeTruthy();
    expect(within(row('c')).getByText('loading…')).toBeTruthy();
    expect(within(row('c')).queryByText(/^\d+$/)).toBeNull();
    const failed = within(row('f')).getByText('failed');
    expect(failed.getAttribute('title')).toBe('nope');
    // Abiertos no muestran contador; las hojas tampoco.
    expect(within(row('s')).queryByText('2')).toBeNull();
    expect(within(row('e1')).queryByText(/^\d+$/)).toBeNull();
    // Un nodo lazy cerrado sin hijos contados no inventa un 0.
    expect(within(row('g')).queryByText('0')).toBeNull();
  });

  it('chevron: enabled only for openable rows, named by state', () => {
    setup();
    expect(
      (screen.getByRole('button', { name: 'Collapse svc' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Expand closed' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Expand main.rs' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Expand http:GET /a' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('notes a capped code listing and offers "+N more…" at the right indent for capped children', () => {
    const h = setup();
    expect(screen.getByText(/more exist than shown/i)).toBeTruthy();
    const more = screen.getByRole('button', { name: '+3 more…' });
    expect(more.style.paddingLeft).toBe(`${8 + 2 * 16 + 22}px`);
    fireEvent.click(more);
    expect(h.onMore).toHaveBeenCalledWith('s');
    // Sin recorte no hay ni nota ni botón.
    cleanup();
    setup({ view: { nodes: nodes.filter((x) => x.id !== 'g'), hiddenChildren: { s: 0 } } });
    expect(screen.queryByText(/more exist than shown/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /more…/ })).toBeNull();
  });

  it('a closed node never shows its cap note or "more" button', () => {
    setup({
      view: {
        nodes: [n({ id: 'c1', childCount: 3, meta: { truncated: true } })],
        hiddenChildren: { c1: 2 },
      },
    });
    expect(screen.queryByText(/more exist than shown/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /more…/ })).toBeNull();
  });
});

describe('MapOutline interaction', () => {
  it('click selects; double-click opens only what can open', () => {
    const h = setup();
    fireEvent.click(row('e1'));
    expect(h.onSelect).toHaveBeenCalledWith('e1');
    fireEvent.doubleClick(row('e1'));
    expect(h.onToggle).not.toHaveBeenCalled();
    fireEvent.doubleClick(row('x'));
    expect(h.onToggle).toHaveBeenCalledWith('x');
    fireEvent.doubleClick(row('c'));
    expect(h.onToggle).toHaveBeenCalledWith('c');
  });

  it('arrows move the selection through the visible rows and stop at the ends', () => {
    const h = setup();
    const order = flattenOutline(nodes).map((r) => r.node.id);
    fireEvent.keyDown(row(order[0] as string), { key: 'ArrowDown' });
    expect(h.onSelect).toHaveBeenLastCalledWith(order[1]);
    fireEvent.keyDown(row(order[2] as string), { key: 'ArrowUp' });
    expect(h.onSelect).toHaveBeenLastCalledWith(order[1]);
    const before = h.onSelect.mock.calls.length;
    fireEvent.keyDown(row(order[0] as string), { key: 'ArrowUp' });
    fireEvent.keyDown(row(order[order.length - 1] as string), { key: 'ArrowDown' });
    expect(h.onSelect.mock.calls.length).toBe(before);
  });

  it('ArrowRight opens a closed openable row only; ArrowLeft closes an open row, else climbs, else nothing', () => {
    const h = setup();
    fireEvent.keyDown(row('x'), { key: 'ArrowRight' });
    expect(h.onToggle).toHaveBeenCalledWith('x');
    h.onToggle.mockClear();
    fireEvent.keyDown(row('e1'), { key: 'ArrowRight' }); // hoja
    fireEvent.keyDown(row('s'), { key: 'ArrowRight' }); // ya abierto
    expect(h.onToggle).not.toHaveBeenCalled();
    fireEvent.keyDown(row('s'), { key: 'ArrowLeft' });
    expect(h.onToggle).toHaveBeenCalledWith('s');
    fireEvent.keyDown(row('e1'), { key: 'ArrowLeft' });
    expect(h.onSelect).toHaveBeenLastCalledWith('s');
    h.onSelect.mockClear();
    h.onToggle.mockClear();
    fireEvent.keyDown(row('x'), { key: 'ArrowLeft' }); // raíz cerrada: nada
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onToggle).not.toHaveBeenCalled();
  });

  it('other keys do nothing', () => {
    const h = setup();
    fireEvent.keyDown(row('s'), { key: 'x' });
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onToggle).not.toHaveBeenCalled();
  });

  it('the tree has an accessible name and empty views say so', () => {
    setup();
    expect(screen.getByRole('tree', { name: 'Organization structure' })).toBeTruthy();
    cleanup();
    render(
      <MapOutline
        view={{ nodes: [], hiddenChildren: {} }}
        selectedId={null}
        focusIds={null}
        onSelect={() => {}}
        onToggle={() => {}}
        onMore={() => {}}
      />,
    );
    expect(screen.getByText('Nothing to show for these filters.')).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
  });
});

describe('MapOutline — hidden noise is declared', () => {
  it('an open code folder says how many tests/hidden entries were left out; a closed one says nothing', () => {
    setup({
      view: {
        nodes: [
          n({
            id: 'open',
            kind: 'file',
            childCount: 0,
            expanded: true,
            lazy: true,
            meta: { hiddenNoise: 7 },
          }),
          n({
            id: 'shut',
            kind: 'file',
            childCount: 0,
            expanded: false,
            lazy: true,
            meta: { hiddenNoise: 9 },
          }),
        ],
        hiddenChildren: {},
      },
    });
    const notes = screen.getAllByTestId('code-hidden-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toMatch(/7 hidden/);
  });
});
