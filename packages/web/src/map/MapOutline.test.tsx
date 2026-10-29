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
  n({ id: 'repo:b', kind: 'repo', label: 'billing', childCount: 1 }),
  n({ id: 'repo:o', kind: 'repo', label: 'orders', childCount: 1, expanded: true }),
  n({ id: 'svc:o', parent: 'repo:o', label: 'orders-svc', childCount: 3, expanded: true }),
  n({
    id: 'ep:1',
    kind: 'endpoint',
    parent: 'svc:o',
    label: 'http:GET /api/orders',
    contract: 'http',
  }),
];

describe('flattenOutline', () => {
  it('orders parents before children and sorts siblings by label', () => {
    const rows = flattenOutline(nodes);
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['repo:b', 0],
      ['repo:o', 0],
      ['svc:o', 1],
      ['ep:1', 2],
    ]);
  });
  it('treats a node whose parent is not in the view as a root', () => {
    expect(flattenOutline([n({ id: 'x', parent: 'gone' })]).map((r) => r.depth)).toEqual([0]);
  });
});

describe('MapOutline', () => {
  const setup = (over: Partial<Parameters<typeof MapOutline>[0]> = {}) => {
    const h = { onSelect: vi.fn(), onToggle: vi.fn(), onMore: vi.fn() };
    render(
      <MapOutline
        view={{ nodes, hiddenChildren: { 'svc:o': 2 } }}
        selectedId={null}
        focusIds={null}
        {...h}
        {...over}
      />,
    );
    return h;
  };

  it('shows the contract kind and strips the prefix from endpoint labels', () => {
    setup();
    const row = screen.getByText('GET /api/orders').closest('[role=treeitem]') as HTMLElement;
    expect(within(row).getByText('http')).toBeTruthy();
  });

  it('is reachable by keyboard with no selection: the first row is the tab stop', () => {
    setup();
    const stops = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-node-id')).toBe('repo:b');
  });

  it('moves the tab stop to the selected row once there is one', () => {
    setup({ selectedId: 'svc:o' });
    const stops = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops.map((r) => r.getAttribute('data-node-id'))).toEqual(['svc:o']);
  });

  it('reports aria-expanded only for nodes that can open', () => {
    setup();
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
      'true',
      null,
    ]);
  });

  it('opens a node from its chevron without selecting it', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Expand billing' }));
    expect(h.onToggle).toHaveBeenCalledWith('repo:b');
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('supports the keyboard: right opens, left closes then climbs to the parent', () => {
    const h = setup();
    const billing = screen.getByText('billing').closest('[role=treeitem]') as HTMLElement;
    fireEvent.keyDown(billing, { key: 'ArrowRight' });
    expect(h.onToggle).toHaveBeenCalledWith('repo:b');
    const svc = screen.getByText('orders-svc').closest('[role=treeitem]') as HTMLElement;
    fireEvent.keyDown(svc, { key: 'ArrowLeft' });
    expect(h.onToggle).toHaveBeenCalledWith('svc:o');
    const ep = screen.getByText('GET /api/orders').closest('[role=treeitem]') as HTMLElement;
    fireEvent.keyDown(ep, { key: 'ArrowLeft' });
    expect(h.onSelect).toHaveBeenCalledWith('svc:o');
  });

  it('says how many children the server cut and lets the user ask for more', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: '+2 more…' }));
    expect(h.onMore).toHaveBeenCalledWith('svc:o');
  });

  it('says so when the filters leave nothing', () => {
    setup({ view: { nodes: [], hiddenChildren: {} } });
    expect(screen.getByText(/nothing to show/i)).toBeTruthy();
  });
});
