import { cleanup, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { renderWithQuery } from '../test/render.js';
import { NAV_ITEMS } from './AppShell.js';

afterEach(() => {
  cleanup();
});

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...renderWithQuery(<RouterProvider router={router} />) };
}

describe('AppShell navigation', () => {
  it('has no dead links: every nav target matches a real route, never the catch-all', () => {
    for (const item of NAV_ITEMS) {
      const router = createMemoryRouter(routes, { initialEntries: [item.to] });
      renderWithQuery(<RouterProvider router={router} />);
      const hitCatchAll = router.state.matches.some((m) => m.route.path === '*');
      expect(hitCatchAll, `nav target ${item.to} fell through to the catch-all`).toBe(false);
      cleanup();
    }
    renderAt('/orgs');
    expect(screen.queryByRole('link', { name: /proposals/i })).toBeNull();
  });

  it('shows the org switcher inside an org and links back to the picker', async () => {
    renderAt('/orgs/acme');
    expect(await screen.findByText('Acme Corp')).toBeTruthy();
    expect(screen.getByRole('link', { name: /all organizations/i })).toBeTruthy();
  });

  it('lights only the active section: assessment pages do not highlight the Map', () => {
    renderAt('/orgs/acme/assessments');
    const map = screen.getByRole('link', { name: /^map$/i });
    const assessments = screen.getByRole('link', { name: /^assessments$/i });
    expect(map.getAttribute('aria-current')).toBeNull();
    expect(assessments.getAttribute('aria-current')).toBe('page');
  });

  it('hides Assessments outside an org (no dead-end bounce)', () => {
    renderAt('/orgs');
    expect(screen.queryByRole('link', { name: /^assessments$/i })).toBeNull();
  });

  it('marks exactly one section as current and points each link at its context-aware target', () => {
    const cases: Array<[string, string]> = [
      ['/orgs/acme', 'Map'],
      ['/orgs/acme/services/orders', 'Map'],
      ['/orgs/acme/assessments', 'Assessments'],
      ['/orgs/acme/assessments/a_1', 'Assessments'],
      ['/workspaces', 'Workspaces'],
      ['/workspaces/ws1', 'Workspaces'],
    ];
    for (const [url, current] of cases) {
      renderAt(url);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      const links = Array.from(nav.querySelectorAll('a'));
      const active = links
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.textContent);
      expect(active, url).toEqual([current]);
      cleanup();
    }
    renderAt('/orgs/acme');
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Map')).toBe('/orgs/acme');
    expect(href('Assessments')).toBe('/orgs/acme/assessments');
    expect(href('Workspaces')).toBe('/workspaces');
  });

  it('outside an org the Map link goes to the picker and nothing in the map section is current', () => {
    renderAt('/workspaces');
    expect(screen.getByRole('link', { name: 'Map' }).getAttribute('href')).toBe('/orgs');
    expect(screen.getByRole('link', { name: 'Map' }).getAttribute('aria-current')).toBeNull();
  });

  it('identifies the product and offers the theme toggle', () => {
    renderAt('/orgs');
    expect(screen.getByText('Parallax')).toBeTruthy();
    expect(screen.getByText('Architecture command center')).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeTruthy();
  });
});
