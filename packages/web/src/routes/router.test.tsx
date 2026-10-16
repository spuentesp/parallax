import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const useAssessmentMock = vi.fn<() => unknown>(() => ({
  data: null,
  isPending: true,
  isError: false,
}));
vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: () => useAssessmentMock(),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return render(<RouterProvider router={router} />);
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

  it('keeps /assessments working via redirect to the org picker', () => {
    renderAt('/assessments');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('redirects /assessments/:id to the org-scoped report once the record loads', async () => {
    useAssessmentMock.mockReturnValueOnce({
      data: { assessment: { id: 'a_1', orgId: 'acme' } },
      isPending: false,
      isError: false,
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/assessments/a_1'] });
    render(<RouterProvider router={router} />);
    // El contrato es el redirect: el nombre del org en pantalla lo pinta el
    // OrgSwitcher (Task 3), no esta capa.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orgs/acme/assessments/a_1');
    });
  });

  it('shows not-found for a legacy id that does not resolve', async () => {
    useAssessmentMock.mockReturnValueOnce({
      data: null,
      isPending: false,
      isError: true,
    });
    renderAt('/assessments/a_gone');
    expect(await screen.findByText(/assessment not found/i)).toBeTruthy();
  });
});
