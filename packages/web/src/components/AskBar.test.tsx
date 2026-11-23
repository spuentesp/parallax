import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

describe('Ask bar on the map', () => {
  it('sends the typed question through the assistant, with the workspace', async () => {
    const asked: Array<{ question?: string; orgId?: string }> = [];
    server.use(
      http.post('/api/query', async ({ request }) => {
        asked.push((await request.json()) as { question?: string; orgId?: string });
        return HttpResponse.json({ answer: 'ok', claims: [], status: 'ok' });
      }),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme?prov=inferred'] });
    renderWithQuery(<RouterProvider router={router} />);
    const input = await screen.findByLabelText('Ask about the architecture');
    fireEvent.change(input, { target: { value: 'Who calls billing?' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatchObject({ question: 'Who calls billing?', orgId: 'acme' });
    // Lo que se veía en el mapa se conserva.
    expect(new URLSearchParams(router.state.location.search).get('prov')).toBe('inferred');
  });

  it('offers suggestions about the selection, and Query opens the query page', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme?sel=svc:orders'] });
    renderWithQuery(<RouterProvider router={router} />);
    expect(await screen.findByRole('button', { name: 'Who depends on orders?' })).toBeTruthy();
    const query = screen.getByRole('button', { name: 'Query' }) as HTMLButtonElement;
    expect(query.disabled).toBe(false);
    fireEvent.click(query);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme/query'));
    expect(await screen.findByTestId('query-page')).toBeTruthy();
  });

  it('opens the command palette from its Ctrl K hint', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ctrl K' }));
    expect(await screen.findByLabelText('Command bar')).toBeTruthy();
  });
});

describe('assistant panel on a laptop-width screen', () => {
  // Borde del navegador: una portátil de 1440px cumple (min-width: 1280px) pero no 1700px.
  const screenOf = (width: number) =>
    vi.stubGlobal('matchMedia', (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: width >= min,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    });
  afterEach(() => vi.unstubAllGlobals());

  it('starts closed so the map keeps the width, and asking from the bar opens it', async () => {
    screenOf(1440);
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({ answer: 'the answer', claims: [], status: 'ok' }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    const input = await screen.findByLabelText('Ask about the architecture');
    expect(screen.queryByLabelText('Ask about your architecture')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask the architecture' })).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Who calls billing?' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByLabelText('Ask about your architecture')).toBeTruthy();
    expect(await screen.findByText('the answer')).toBeTruthy();
  });

  it('on a very wide screen it starts open, as before', async () => {
    screenOf(1920);
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    expect(await screen.findByLabelText('Ask about your architecture')).toBeTruthy();
  });
});
