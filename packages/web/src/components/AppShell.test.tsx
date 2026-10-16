import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';
import { NAV_ITEMS } from './AppShell.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({
    data: { orgs: [{ id: 'acme', name: 'Acme Corp' }] },
    isPending: false,
    isError: false,
  }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('AppShell navigation', () => {
  it('has no dead links: every nav target matches a real route, never the catch-all', () => {
    for (const item of NAV_ITEMS) {
      const router = createMemoryRouter(routes, { initialEntries: [item.to] });
      render(<RouterProvider router={router} />);
      const hitCatchAll = router.state.matches.some((m) => m.route.path === '*');
      expect(hitCatchAll, `nav target ${item.to} fell through to the catch-all`).toBe(false);
      cleanup();
    }
    renderAt('/orgs');
    expect(screen.queryByRole('link', { name: /proposals/i })).toBeNull();
  });

  it('shows the org switcher inside an org and links back to the picker', () => {
    renderAt('/orgs/acme');
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByRole('link', { name: /todas las organizaciones/i })).toBeTruthy();
  });
});
