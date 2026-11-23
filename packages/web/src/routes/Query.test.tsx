import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
// Resultados que produce el API real (graph-query) al juntar salidas literales de
// `query_graph` de LAIN 0.16.0 sobre Saleor.
import LIVE from '../test/fixtures/graph-query-0.16-saleor.json';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

type Body = { ops: Array<Record<string, unknown>> };

function open() {
  const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/query'] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}

describe('Query page', () => {
  it('runs the starting pipeline as shown and renders the merged groups with per-step counts', async () => {
    let sent: Body | null = null;
    server.use(
      http.post('/api/workspaces/:id/graph-query', async ({ request }) => {
        sent = (await request.json()) as Body;
        return HttpResponse.json(LIVE.groups);
      }),
    );
    open();
    await screen.findByTestId('query-page');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const results = within(await screen.findByTestId('query-results'));

    expect((sent as Body | null)?.ops.map((o) => o.op)).toEqual([
      'find',
      'connect',
      'group',
      'sort',
      'limit',
    ]);
    expect((sent as Body | null)?.ops[1]).toMatchObject({ op: 'connect', edge: 'Binds' });
    expect(results.getByText('saleor-api')).toBeTruthy();
    expect(results.getByText('1,272')).toBeTruthy();
    expect(results.getByText(/saleor 636/)).toBeTruthy();
    expect(results.getByText(/scope: 3 of 3 repos analyzed/)).toBeTruthy();
    // El conteo del paso `find` aparece junto al paso.
    expect(screen.getByText(/1,274 nodes/)).toBeTruthy();
  });

  it('shows the engine message when it rejects the query', async () => {
    server.use(
      http.post('/api/workspaces/:id/graph-query', () =>
        HttpResponse.json(
          {
            title: 'Bad Request',
            status: 400,
            detail: 'lain rejected query_graph: Invalid argument: unknown field `bogus`',
          },
          { status: 400 },
        ),
      ),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('unknown field `bogus`');
  });

  it('does not run steps that are not valid JSON, and says which step', async () => {
    open();
    const input = await screen.findByLabelText('Step 1 parameters (JSON)');
    fireEvent.change(input, { target: { value: '{"type": ' } });
    expect(screen.getByText(/Step 1 \(find\): the parameters are not valid JSON/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '[1]' } });
    expect(screen.getByText(/must be a JSON object/)).toBeTruthy();
  });

  it('requires a find step first', async () => {
    open();
    await screen.findByTestId('query-page');
    fireEvent.change(screen.getByLabelText('Step 1 operation'), { target: { value: 'filter' } });
    expect(screen.getByText('A query starts with a find step.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches pipeline from a starting point and lists nodes with their location', async () => {
    let sent: Body | null = null;
    server.use(
      http.post('/api/workspaces/:id/graph-query', async ({ request }) => {
        sent = (await request.json()) as Body;
        return HttpResponse.json(LIVE.nodes);
      }),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Database tables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const results = within(await screen.findByTestId('query-results'));
    expect((sent as Body | null)?.ops[0]).toEqual({ op: 'find', type: 'Table' });
    expect(results.getByText('order_fulfillment')).toBeTruthy();
    expect(results.getByText('saleor/order/models.py:776')).toBeTruthy();
    fireEvent.click(results.getByRole('button', { name: 'JSON' }));
    expect(results.getByText(/"name": "order_fulfillment"/)).toBeTruthy();
  });

  it('says which repos did not answer and when the engine cut the result short', async () => {
    server.use(
      http.post('/api/workspaces/:id/graph-query', () =>
        HttpResponse.json({
          ...LIVE.groups,
          engineTruncated: true,
          scope: { analyzed: ['saleor'], failed: [{ repo: 'storefront', error: 'timeout' }] },
        }),
      ),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    const results = within(await screen.findByTestId('query-results'));
    await waitFor(() => expect(results.getAllByRole('status')).toHaveLength(2));
    expect(results.getByText(/storefront \(timeout\)/)).toBeTruthy();
    expect(results.getByText(/counts are partial/)).toBeTruthy();
  });

  it('removes and adds steps', async () => {
    open();
    await screen.findByTestId('query-page');
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 5' }));
    expect(screen.queryByLabelText('Step 5 operation')).toBeNull();
    fireEvent.click(screen.getByText('+ Add step'));
    expect(screen.getByLabelText('Step 5 operation')).toBeTruthy();
  });
});
