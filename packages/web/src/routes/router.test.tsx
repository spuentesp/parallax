import { cleanup, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { sampleReport, server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(() => {
  cleanup();
});

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return renderWithQuery(<RouterProvider router={router} />);
}

describe('route table', () => {
  it('sends / to the org picker', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('sends unknown routes to the org picker', () => {
    renderAt('/nope/nothing');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('keeps org context on unknown subpaths', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/typo'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orgs/acme');
    });
  });

  it('keeps /assessments working via redirect to the org picker', () => {
    renderAt('/assessments');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('redirects /assessments/:id to the org-scoped report once the record loads', async () => {
    server.use(
      http.get('/api/assessments/a_1', () =>
        HttpResponse.json({ assessment: { ...sampleReport, id: 'a_1', orgId: 'acme' } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/assessments/a_1'] });
    renderWithQuery(<RouterProvider router={router} />);
    // El contrato es el redirect: el nombre del org en pantalla lo pinta el
    // OrgSwitcher (Task 3), no esta capa.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orgs/acme/assessments/a_1');
    });
  });

  it('shows not-found for a legacy id that does not resolve', async () => {
    server.use(
      http.get('/api/assessments/a_gone', () =>
        HttpResponse.json({ code: 'NotImplemented' }, { status: 501 }),
      ),
    );
    renderAt('/assessments/a_gone');
    expect(await screen.findByText(/assessment not found/i)).toBeTruthy();
  });

  it('reseeds the evaluation form when ?repo changes', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/orgs/acme/assessments?repo=orders'],
    });
    renderWithQuery(<RouterProvider router={router} />);
    expect(((await screen.findByLabelText(/repo/i)) as HTMLInputElement).value).toBe('orders');
    await router.navigate('/orgs/acme/assessments?repo=reports');
    await waitFor(() => {
      expect((screen.getByLabelText(/repo/i) as HTMLInputElement).value).toBe('reports');
    });
  });

  it('tells the user to launch the first evaluation from the form above', async () => {
    renderAt('/orgs/acme/assessments');
    expect(await screen.findByText(/todavía no hay evaluaciones/i)).toBeTruthy();
  });
});
