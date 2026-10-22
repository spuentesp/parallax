import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyView, type TopologyViewData } from './TopologyView.js';

// reagraph pinta WebGL: en jsdom no es clickeable. Se sustituye el canvas por
// un botón que dispara el mismo onNodeClick, para testear el seam onSelect.
vi.mock('reagraph', () => ({
  darkTheme: {},
  GraphCanvas: ({ onNodeClick }: { onNodeClick: (n: { id: string | number }) => void }) => (
    <button type="button" onClick={() => onNodeClick({ id: 'orders' })}>
      fake-node
    </button>
  ),
}));

afterEach(() => cleanup());

const sampleData: TopologyViewData = {
  nodes: [
    { id: 'orders', label: 'orders', kind: 'service', parent: null },
    { id: 'billing', label: 'billing', kind: 'service', parent: null },
    { id: 'reports', label: 'reports', kind: 'service', parent: null },
  ],
  edges: [
    { source: 'billing', target: 'orders', label: 'customer_id', kind: 'consumes' },
    { source: 'reports', target: 'orders', label: 'created_at', kind: 'consumes' },
  ],
};

describe('TopologyView', () => {
  it('renders without crashing on empty data', () => {
    render(<TopologyView data={{ nodes: [], edges: [] }} />);
    expect(screen.getByTestId('topology-view')).toBeTruthy();
  });

  it('renders with sample topology data', () => {
    render(<TopologyView data={sampleData} />);
    expect(screen.getByTestId('topology-view')).toBeTruthy();
  });

  it('reports node selection with its kind', () => {
    const onSelect = vi.fn();
    render(<TopologyView data={sampleData} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'fake-node' }));
    expect(onSelect).toHaveBeenCalledWith('orders', 'service');
  });
});
