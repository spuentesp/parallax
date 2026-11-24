import type { MatrixData } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MatrixLens } from './MatrixLens.js';

afterEach(cleanup);

const MATRIX: MatrixData = {
  services: [
    { id: 'svc:orders', label: 'orders-api', repoId: 'repo:platform', repoLabel: 'platform' },
    { id: 'svc:billing', label: 'billing-svc', repoId: 'repo:billing', repoLabel: 'billing' },
    { id: 'svc:web', label: 'web', repoId: 'repo:web', repoLabel: 'web' },
  ],
  cells: [
    {
      consumer: 'svc:orders',
      provider: 'svc:billing',
      count: 17,
      deterministicCount: 17,
      inferredCount: 0,
      confidence: 1,
      provenance: 'deterministic',
      links: [
        {
          endpointId: 'ep:http:POST /invoice@svc:billing',
          endpointLabel: 'rpc BillingService/CreateInvoice',
          count: 9,
          provenance: 'deterministic',
          confidence: 1,
        },
        {
          endpointId: 'ep:http:POST /capture@svc:billing',
          endpointLabel: 'rpc BillingService/Capture',
          count: 8,
          provenance: 'deterministic',
          confidence: 1,
        },
      ],
    },
    {
      consumer: 'svc:web',
      provider: 'svc:orders',
      count: 4,
      deterministicCount: 0,
      inferredCount: 4,
      confidence: 0.6,
      provenance: 'inferred',
      links: [
        {
          endpointId: 'ep:http:GET /orders@svc:orders',
          endpointLabel: 'http:GET /orders',
          count: 4,
          provenance: 'inferred',
          confidence: 0.6,
        },
      ],
    },
  ],
  standalone: [],
};

const LOOSE = {
  source: 'lain',
  generatedAt: Date.now(),
  items: [
    {
      key: 'k1',
      kind: 'unresolved' as const,
      repo: 'web',
      path: 'src/lib/http.ts',
      line: 9,
      reason: 'wrapper_unconfigured',
      detail: { targetService: 'web' },
      candidates: ['http:GET /orders'],
      candidateCount: 1,
      assessment: null,
    },
  ],
  summary: { total: 1, byCategory: {}, pendingCases: 0 },
  run: { state: 'done' as const, done: 1, total: 1 },
};

function setup(opts: { onAsk?: (q: string) => void; onOpenContracts?: () => void } = {}) {
  server.use(
    http.get('/api/workspaces/:id/map/matrix', () =>
      HttpResponse.json({ matrix: MATRIX, meta: { source: 'lain' } }),
    ),
    http.get('/api/workspaces/:id/loose-ends', () => HttpResponse.json(LOOSE)),
  );
  const onSelect = vi.fn();
  const onFocus = vi.fn();
  const onAsk = opts.onAsk ?? vi.fn();
  const onOpenContracts = opts.onOpenContracts ?? vi.fn();
  renderWithQuery(
    <MatrixLens
      workspaceId="ws_test"
      onSelect={onSelect}
      onFocus={onFocus}
      onAsk={onAsk}
      onOpenContracts={onOpenContracts}
    />,
  );
  return { onSelect, onFocus, onAsk, onOpenContracts };
}

describe('MatrixLens', () => {
  it('renders the consumer × provider grid with call-site counts and provenance', async () => {
    setup();
    const grid = await screen.findByTestId('matrix-grid');
    const cell = within(grid).getByTestId('matrix-cell-svc:orders-svc:billing');
    expect(cell.textContent).toContain('17');
    const inferred = within(grid).getByTestId('matrix-cell-svc:web-svc:orders');
    expect(inferred.textContent).toContain('4 · 0.6');
    // Columna unresolved: 1 llamada sin resolver en web.
    expect(within(grid).getByText('unresolved')).toBeTruthy();
    const row = within(grid).getByRole('button', { name: 'web' }).closest('tr');
    expect(row?.textContent).toContain('1');
  });

  it('clicking a cell opens the pair panel with its contracts, provenance and actions', async () => {
    const { onFocus, onAsk, onOpenContracts } = setup();
    const grid = await screen.findByTestId('matrix-grid');
    fireEvent.click(within(grid).getByTestId('matrix-cell-svc:orders-svc:billing'));
    const panel = await screen.findByTestId('matrix-pair-panel');
    expect(within(panel).getByText(/orders-api/)).toBeTruthy();
    expect(within(panel).getByText(/billing-svc/)).toBeTruthy();
    expect(panel.textContent).toContain('17 call sites');
    expect(panel.textContent).toContain('proven');
    // Through contracts: los endpoints de la celda con su conteo.
    expect(within(panel).getByText('rpc BillingService/CreateInvoice')).toBeTruthy();
    expect(within(panel).getByText('×9')).toBeTruthy();
    fireEvent.click(within(panel).getByText('Show as graph'));
    expect(onFocus).toHaveBeenCalledWith('svc:orders');
    fireEvent.click(within(panel).getByText('Open contracts'));
    expect(onOpenContracts).toHaveBeenCalled();
    fireEvent.click(within(panel).getByText('Ask about this pair'));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('orders-api'));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('billing-svc'));
  });

  it('the bottom ask bar sends the question to the assistant', async () => {
    const { onAsk } = setup();
    const input = await screen.findByTestId('matrix-ask-input');
    fireEvent.change(input, { target: { value: 'which pairs form a cycle?' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onAsk).toHaveBeenCalledWith('which pairs form a cycle?');
  });

  it('switches to repo level: cells aggregate by repo and diagonal blocks are intra-repo', async () => {
    setup();
    const grid = await screen.findByTestId('matrix-grid');
    fireEvent.click(screen.getByRole('button', { name: 'repos' }));
    const cell = within(grid).getByTestId('matrix-cell-repo:platform-repo:billing');
    expect(cell.textContent).toContain('17');
    // La diagonal intra-repo existe como celda pero sin conteo (web → web no tiene llamadas).
    const diag = within(grid).getByTestId('matrix-cell-repo:web-repo:web');
    expect(diag.textContent?.trim()).toBe('');
  });

  it('shows the matrix summary and most-depended-on ranking when nothing is selected', async () => {
    setup();
    const panel = await screen.findByTestId('matrix-pair-panel');
    expect(within(panel).getByText(/cross-service pairs/)).toBeTruthy();
    expect(within(panel).getByText(/two-way pairs/)).toBeTruthy();
    expect(within(panel).getByText('Most depended on')).toBeTruthy();
    expect(within(panel).getByText('billing-svc')).toBeTruthy();
    expect(within(panel).getAllByText('1 consumer').length).toBeGreaterThan(0);
  });
});
