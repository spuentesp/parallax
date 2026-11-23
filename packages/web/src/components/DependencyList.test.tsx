import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopologyEdge } from '../api/hooks.js';
import { DependencyList } from './DependencyList.js';

afterEach(cleanup);

// Forma de las aristas que produce el API sobre Saleor (LAIN 0.16.0): un servicio que
// expone una tabla y la usa a la vez da DOS aristas con la misma pareja origen/destino.
const edges: TopologyEdge[] = [
  {
    source: 'svc:saleor-api',
    target: 'ep:table:account_address@saleor-api',
    kind: 'consumes',
    label: 'uses',
    meta: { binding: 'static', confidence: 1, useCount: 95, uses: [] },
  },
  {
    source: 'svc:saleor-api',
    target: 'ep:table:account_address@saleor-api',
    kind: 'contains',
    meta: { relation: 'exposes' },
  },
] as unknown as TopologyEdge[];

describe('DependencyList', () => {
  it('does not repeat React keys when a service exposes and uses the same endpoint', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <DependencyList edges={edges} onLoadEvidence={() => {}} evidence={null} loading={false} />,
    );
    const keyWarnings = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
    errors.mockRestore();
    expect(keyWarnings).toEqual([]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('opens one row at a time even when two edges join the same pair', () => {
    render(
      <DependencyList edges={edges} onLoadEvidence={() => {}} evidence={null} loading={false} />,
    );
    const [first, second] = screen.getAllByRole('button') as [HTMLElement, HTMLElement];
    fireEvent.click(first);
    expect(first.textContent).toContain('▾');
    expect(second.textContent).toContain('▸');
  });
});
