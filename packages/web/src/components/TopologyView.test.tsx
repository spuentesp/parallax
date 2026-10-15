import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TopologyView, type TopologyViewData } from './TopologyView.js';

afterEach(() => cleanup());

const emptyData: TopologyViewData = { nodes: [], edges: [] };

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
    render(<TopologyView data={emptyData} />);
    expect(screen.getByTestId('topology-view')).toBeTruthy();
  });

  it('renders with sample topology data', () => {
    render(<TopologyView data={sampleData} />);
    expect(screen.getByTestId('topology-view')).toBeTruthy();
  });
});
