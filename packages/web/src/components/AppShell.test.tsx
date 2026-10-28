import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { writeMapSearch } from '../nav/mapState.js';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { NAV_ITEMS } from './AppShell.js';

afterEach(() => {
  cleanup();
});

const LABELS = NAV_ITEMS.map((i) => i.label);

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...renderWithQuery(<RouterProvider router={router} />) };
}

const withWorkspaces = (...ids: string[]) =>
  server.use(
    http.get('/api/workspaces', () =>
      HttpResponse.json({
        workspaces: ids.map((id) => ({
          id,
          name: id.toUpperCase(),
          description: '',
          repoCount: 1,
          repos: [],
          lainUrl: null,
        })),
      }),
    ),
  );

const sidebar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const labelsShown = () =>
  Array.from(screen.getByRole('navigation', { name: 'Main' }).children).map((e) =>
    (e.textContent ?? '').trim(),
  );

describe('the sidebar is the same on every screen', () => {
  const screens = [
    '/orgs',
    '/orgs/acme',
    '/orgs/acme/repos',
    '/orgs/acme/contracts',
    '/orgs/acme/assessments',
    '/orgs/acme/assessments/a_1',
    '/orgs/acme/services/orders',
    '/orgs/acme/typo',
  ];

  it('shows exactly the same sections, in the same order, on all of them', () => {
    for (const url of screens) {
      renderAt(url);
      expect(labelsShown(), url).toEqual(LABELS);
      // Y el recuadro del workspace actual, siempre.
      expect(screen.getByText('Workspace'), url).toBeTruthy();
      cleanup();
    }
  });

  it('is the same even when there is no workspace at all: sections shown but not links', async () => {
    renderAt('/orgs');
    expect(labelsShown()).toEqual(LABELS);
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    for (const l of LABELS) expect(sidebar().queryByRole('link', { name: l })).toBeNull();
  });

  it('marks exactly one section as current, and points each at the current workspace', () => {
    const cases: Array<[string, string]> = [
      ['/orgs/acme', 'Map'],
      ['/orgs/acme/services/orders', 'Map'],
      ['/orgs/acme/repos', 'Repositories'],
      ['/orgs/acme/contracts', 'Contracts'],
      ['/orgs/acme/assessments', 'Assessments'],
      ['/orgs/acme/assessments/a_1', 'Assessments'],
    ];
    for (const [url, current] of cases) {
      renderAt(url);
      const active = Array.from(
        screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a'),
      )
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.textContent);
      expect(active, url).toEqual([current]);
      cleanup();
    }
    window.sessionStorage.clear(); // lo que dejaron los casos anteriores en el mapa
    renderAt('/orgs/acme/repos');
    const href = (name: string) => sidebar().getByRole('link', { name }).getAttribute('href');
    expect(href('Map')).toBe('/orgs/acme');
    expect(href('Repositories')).toBe('/orgs/acme/repos');
    expect(href('Contracts')).toBe('/orgs/acme/contracts');
    expect(href('Assessments')).toBe('/orgs/acme/assessments');
  });

  it('outside a workspace page it keeps pointing at the workspace in use: the first one when none was used', async () => {
    withWorkspaces('ws1', 'ws2');
    renderAt('/orgs');
    await waitFor(() =>
      expect(sidebar().getByRole('link', { name: 'Map' }).getAttribute('href')).toBe('/orgs/ws1'),
    );
    // Ninguna sección está "actual" en la lista de workspaces.
    expect(
      Array.from(screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')).filter(
        (a) => a.getAttribute('aria-current') === 'page',
      ),
    ).toEqual([]);
  });

  it('remembers the workspace last used', async () => {
    withWorkspaces('ws1', 'ws2');
    const first = renderAt('/orgs/ws2/repos');
    await waitFor(() => expect(window.localStorage.getItem('parallax.org')).toBe('ws2'));
    first.unmount();
    renderAt('/orgs');
    await waitFor(() =>
      expect(sidebar().getByRole('link', { name: 'Map' }).getAttribute('href')).toBe('/orgs/ws2'),
    );
  });
});

describe('the workspace card', () => {
  it('shows the workspace name and links back to the list', async () => {
    renderAt('/orgs/acme');
    expect(await screen.findByText('Acme Corp')).toBeTruthy();
    expect(screen.getByRole('link', { name: /all workspaces/i }).getAttribute('href')).toBe(
      '/orgs',
    );
  });
});

describe('leaving the map and coming back', () => {
  it('Map restores the filters the user left it with', () => {
    writeMapSearch('acme', new URLSearchParams('prov=inferred&focus=svc:a&token=secret'));
    renderAt('/orgs/acme/assessments');
    const href = sidebar().getByRole('link', { name: 'Map' }).getAttribute('href') ?? '';
    expect(href.startsWith('/orgs/acme?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('prov')).toBe('inferred');
    expect(q.get('focus')).toBe('svc:a');
    // El token jamás se guarda ni se vuelve a escribir en una URL.
    expect(q.get('token')).toBeNull();
  });

  it('round trip: Map with a filter → Assessments → Map keeps the filter in the URL', async () => {
    const { router } = renderAt('/orgs/acme?prov=inferred');
    await screen.findByTestId('map-explorer');
    fireEvent.click(sidebar().getByRole('link', { name: 'Assessments' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme/assessments'));
    fireEvent.click(sidebar().getByRole('link', { name: 'Map' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme'));
    expect(new URLSearchParams(router.state.location.search).get('prov')).toBe('inferred');
  });
});

describe('product chrome', () => {
  it('identifies the product and offers the theme toggle', () => {
    renderAt('/orgs');
    expect(screen.getByRole('img', { name: 'Parallax' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeTruthy();
  });
});
