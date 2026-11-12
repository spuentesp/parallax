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
  it('sends / to the list when there is no workspace yet', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
    expect(await screen.findByRole('heading', { name: /^workspaces$/i })).toBeTruthy();
  });

  it('sends / straight to the map of the only workspace, keeping the query (a judge link keeps its token)', async () => {
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [
            { id: 'ws1', name: 'W', description: '', repoCount: 1, repos: [], lainUrl: null },
          ],
        }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/?x=1'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/ws1'));
    expect(router.state.location.search).toBe('?x=1');
  });

  it('sends unknown routes the same way as /', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/nope/nothing'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
  });

  it('old workspace links redirect to the one workspace area, keeping the other parameters', async () => {
    const cases: Array<[string, string, string]> = [
      ['/workspaces', '/orgs', ''],
      ['/workspaces/ws1', '/orgs/ws1', ''],
      ['/workspaces/ws1?tab=map&focus=svc:a', '/orgs/ws1', '?focus=svc%3Aa'],
      ['/workspaces/ws1?tab=repos', '/orgs/ws1/repos', ''],
      ['/workspaces/ws1?tab=contracts&view=1', '/orgs/ws1/contracts', '?view=1'],
      ['/workspaces/ws1?tab=graph', '/orgs/ws1', ''],
    ];
    for (const [from, path, search] of cases) {
      const router = createMemoryRouter(routes, { initialEntries: [from] });
      renderWithQuery(<RouterProvider router={router} />);
      await waitFor(() => expect(router.state.location.pathname, from).toBe(path));
      expect(router.state.location.search, from).toBe(search);
      cleanup();
    }
  });

  it('keeps org context on unknown subpaths', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/typo'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orgs/acme');
    });
  });

  it('keeps /assessments working via redirect to the workspace list', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/assessments'] });
    renderWithQuery(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
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
