import { cleanup, fireEvent, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';
import { renderWithQuery } from '../test/render.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// reagraph pinta WebGL; el nodo se vuelve un botón que dispara el mismo
// onNodeClick, para recorrer el hop completo: clic → onSelect → panel.
vi.mock('reagraph', () => ({
  darkTheme: {},
  GraphCanvas: ({ onNodeClick }: { onNodeClick: (n: { id: string | number }) => void }) => (
    <button type="button" onClick={() => onNodeClick({ id: 'orders' })}>
      fake-node
    </button>
  ),
}));

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({
    data: { orgs: [{ id: 'acme', name: 'Acme Corp' }] },
    isPending: false,
    isError: false,
  }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: vi.fn() }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...renderWithQuery(<RouterProvider router={router} />) };
}

describe('demo flow: one connected command center', () => {
  it('hub → service panel → close keeps the graph; Evaluar PR carries the repo context', async () => {
    const { router } = renderAt('/orgs/acme');
    const topologyHeading = screen.getByText(/service topology/i);

    // 1. El clic de nodo (hop completo: onNodeClick → onSelect → navigate)
    //    abre el panel de servicio SOBRE un grafo que no se desmonta.
    fireEvent.click(screen.getByRole('button', { name: 'fake-node' }));
    expect(await screen.findByRole('heading', { name: /service orders/i })).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBe(topologyHeading);

    // 2. Cerrar el panel vuelve al hub CON el contexto del nodo intacto.
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(router.state.location.pathname).toBe('/orgs/acme');
    expect(router.state.location.search).toBe('?node=orders');
    expect(screen.getByText(/service topology/i)).toBe(topologyHeading);

    // 3. Evaluar PR lleva al formulario con el repo precargado.
    fireEvent.click(screen.getByRole('link', { name: /evaluar pr/i }));
    expect(router.state.location.pathname).toBe('/orgs/acme/assessments');
    expect(((await screen.findByLabelText(/repo/i)) as HTMLInputElement).value).toBe('orders');
  });
});
