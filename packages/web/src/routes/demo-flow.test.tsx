import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

// Sin mocks internos (regla AGENTS.md #2): el flujo pasa por los hooks y el
// cliente HTTP reales, y la red la sirve MSW (ver src/test/msw.ts).

const orders: ProjectedNode = {
  id: 'svc:orders',
  label: 'orders',
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
};

describe('demo flow: one connected command center', () => {
  it('hub → select a service on the map → Evaluate PR arrives with the repo preloaded', async () => {
    server.use(
      http.post('/api/workspaces/:id/map/view', () =>
        HttpResponse.json({
          nodes: [orders],
          edges: [],
          hiddenChildren: {},
          focus: null,
          unknownExpand: [],
          meta: { source: 'lain', generatedAt: Date.now() },
        } satisfies MapViewResponse),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);

    // 1. Seleccionar en el árbol del mapa deja el contexto en la URL.
    const outline = await screen.findByTestId('map-outline');
    fireEvent.click(within(outline).getByText('orders'));
    expect(new URLSearchParams(router.state.location.search).get('sel')).toBe('svc:orders');
    expect(router.state.location.pathname).toBe('/orgs/acme');

    // 2. La acción de flujo hereda lo seleccionado.
    fireEvent.click(await screen.findByRole('link', { name: /evaluate pr/i }));
    expect(router.state.location.pathname).toBe('/orgs/acme/assessments');

    // 3. El formulario llega con el repo precargado.
    expect(((await screen.findByLabelText(/repo/i)) as HTMLInputElement).value).toBe('orders');
  });
});
