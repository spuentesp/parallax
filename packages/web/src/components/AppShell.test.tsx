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
});
