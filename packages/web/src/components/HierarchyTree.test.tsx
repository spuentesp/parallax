import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HierarchyTree, groupHierarchy } from './HierarchyTree.js';
import type { TopologyEdge, TopologyNode } from './TopologyView.js';

afterEach(() => cleanup());

// repo orders contiene al servicio orders, que expone dos endpoints. Uno lo
// consume billing con un campo concreto; el otro no tiene consumidor.
const nodes: TopologyNode[] = [
  { id: 'repo:orders', label: 'orders', kind: 'repo', parent: null },
  { id: 'repo:billing', label: 'billing', kind: 'repo', parent: null },
  { id: 'svc:orders', label: 'orders', kind: 'service', parent: 'repo:orders' },
  { id: 'svc:billing', label: 'billing', kind: 'service', parent: 'repo:billing' },
  {
    id: 'ep:http:GET /api/orders/{}@orders',
    label: 'http:GET /api/orders/{}',
    kind: 'endpoint',
    parent: 'svc:orders',
  },
  {
    id: 'ep:http:POST /api/orders@orders',
    label: 'http:POST /api/orders',
    kind: 'endpoint',
    parent: 'svc:orders',
  },
];

const edges: TopologyEdge[] = [
  {
    source: 'svc:orders',
    target: 'ep:http:GET /api/orders/{}@orders',
    kind: 'contains',
  },
  {
    source: 'svc:orders',
    target: 'ep:http:POST /api/orders@orders',
    kind: 'contains',
  },
  {
    source: 'svc:billing',
    target: 'ep:http:GET /api/orders/{}@orders',
    kind: 'consumes',
    label: 'customer_id, total',
    meta: { binding: 'static', confidence: 1 },
  },
  {
    source: 'ep:http:GET /api/orders/{}@orders',
    target: 'svc:orders',
    kind: 'servedBy',
    label: 'served by',
  },
];

describe('groupHierarchy', () => {
  it('groups endpoints under service then repo', () => {
    const g = groupHierarchy(nodes, edges);
    expect(g.map((r) => r.repo).sort()).toEqual(['billing', 'orders']);
    const orders = g.find((r) => r.repo === 'orders');
    expect(orders?.services[0]?.service).toBe('orders');
    expect(orders?.services[0]?.endpoints).toHaveLength(2);
  });

  it('attaches consumers with the surface they read', () => {
    const g = groupHierarchy(nodes, edges);
    const orders = g.find((r) => r.repo === 'orders');
    const withConsumer = orders?.services[0]?.endpoints.find(
      (e) => e.node.label === 'http:GET /api/orders/{}',
    );
    expect(withConsumer?.consumers).toHaveLength(1);
    expect(withConsumer?.consumers[0]?.from).toBe('billing');
    expect(withConsumer?.consumers[0]?.label).toBe('customer_id, total');
    expect(withConsumer?.consumers[0]?.binding).toBe('static');
  });

  it('keeps endpoints without consumers visible instead of hiding them', () => {
    const g = groupHierarchy(nodes, edges);
    const orders = g.find((r) => r.repo === 'orders');
    const orphan = orders?.services[0]?.endpoints.find(
      (e) => e.node.label === 'http:POST /api/orders',
    );
    expect(orphan?.consumers).toEqual([]);
  });
});

describe('HierarchyTree', () => {
  it('renders the repo → service → endpoint hierarchy', () => {
    render(<HierarchyTree nodes={nodes} edges={edges} />);
    const tree = screen.getByTestId('hierarchy-tree');
    expect(tree.textContent).toContain('orders');
    expect(tree.textContent).toContain('http:GET /api/orders/{}');
    expect(tree.textContent).toContain('customer_id, total');
  });

  it('marks endpoints nobody consumes', () => {
    render(<HierarchyTree nodes={nodes} edges={edges} />);
    expect(screen.getAllByText(/no consumers/i).length).toBeGreaterThan(0);
  });
});
