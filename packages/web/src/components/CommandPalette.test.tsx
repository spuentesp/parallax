import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}
const press = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('command palette', () => {
  it('opens with Ctrl+K from any section and closes with Escape', async () => {
    renderAt('/orgs/acme/repos');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    press();
    const bar = await screen.findByLabelText('Command bar');
    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('routes a sentence to the assistant as ?ask= and keeps the map state', async () => {
    const asked: Array<{ question?: string; orgId?: string }> = [];
    server.use(
      http.post('/api/query', async ({ request }) => {
        asked.push((await request.json()) as { question?: string });
        return HttpResponse.json({ answer: 'ok', claims: [], status: 'ok', conversationId: 'c1' });
      }),
    );
    const router = renderAt('/orgs/acme?prov=inferred');
    press();
    const bar = await screen.findByLabelText('Command bar');
    fireEvent.change(bar, { target: { value: 'Which services call billing-svc' } });
    expect(screen.getByText(/Ask the assistant: “Which services call billing-svc”/)).toBeTruthy();
    fireEvent.keyDown(bar, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme'));
    const q = new URLSearchParams(router.state.location.search);
    expect(q.get('prov')).toBe('inferred');
    // La pregunta la recoge el asistente y la envía al servidor, con el workspace.
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatchObject({ question: 'Which services call billing-svc', orgId: 'acme' });
  });

  it('goes to a section and to a map node found by the engine search', async () => {
    server.use(
      http.get('/api/workspaces/:id/map/search', () =>
        HttpResponse.json({
          results: [{ id: 'svc:billing', label: 'billing-svc', kind: 'service', meta: {} }],
          meta: { source: 'lain' },
        }),
      ),
    );
    const router = renderAt('/orgs/acme');
    press();
    const bar = await screen.findByLabelText('Command bar');
    fireEvent.change(bar, { target: { value: 'cover' } });
    fireEvent.click(await screen.findByRole('option', { name: /Coverage/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme/coverage'));

    press();
    fireEvent.change(await screen.findByLabelText('Command bar'), { target: { value: 'billing' } });
    fireEvent.click(await screen.findByRole('option', { name: /billing-svc/ }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('sel')).toBe('svc:billing'),
    );
  });
});
