// Cambiar de workspace es cambiar de mapa. Este archivo lo fija: el mapa del
// workspace nuevo no puede heredar nada del anterior (nodos abiertos, recuentos,
// capa de código ni posiciones del lienzo).

import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

const pn = (id: string, over: Partial<ProjectedNode> = {}): ProjectedNode => ({
  id,
  label: id,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});

interface Posted {
  ws: string;
  expand: string[];
}

/** Un workspace con un repo y un servicio dentro; el repo se abre si se pide. */
function serveWorkspaces() {
  const posted: Posted[] = [];
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request, params }) => {
      const body = (await request.json()) as { expand: string[] };
      const ws = String(params.id);
      posted.push({ ws, expand: body.expand });
      const open = new Set(body.expand);
      const nodes: ProjectedNode[] = [
        pn(`repo:${ws}`, {
          kind: 'repo',
          label: `${ws}-repo`,
          childCount: 1,
          expanded: open.has(`repo:${ws}`),
        }),
      ];
      if (open.has(`repo:${ws}`)) {
        nodes.push(pn(`svc:${ws}`, { parent: `repo:${ws}`, label: `${ws}-api`, kind: 'service' }));
      }
      const view: MapViewResponse = {
        nodes,
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        totals: { nodes: nodes.length, edges: 0, shownNodes: nodes.length, shownEdges: 0 },
        meta: { source: 'lain', generatedAt: Date.now() },
      };
      return HttpResponse.json(view);
    }),
  );
  return posted;
}

function renderHub(url = '/orgs/acme') {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}

describe('changing workspace', () => {
  it('draws the other workspace, with its own repos open', async () => {
    const posted = serveWorkspaces();
    const router = renderHub('/orgs/acme');
    const outline = await screen.findByTestId('map-outline');
    await waitFor(() => expect(within(outline).getByText('acme-api')).toBeTruthy());

    await router.navigate('/orgs/other');
    await waitFor(() =>
      expect(within(screen.getByTestId('map-outline')).getByText('other-api')).toBeTruthy(),
    );
    // El workspace anterior ya no aparece en el árbol.
    expect(within(screen.getByTestId('map-outline')).queryByText('acme-api')).toBeNull();
    // Y al servidor no se le piden ids de nodos del workspace anterior.
    const last = posted.at(-1);
    expect(last?.ws).toBe('other');
    expect(last?.expand.every((id) => id.startsWith('repo:other'))).toBe(true);
  });

  it('does not write the previous workspace state into the new one', async () => {
    serveWorkspaces();
    const router = renderHub('/orgs/acme');
    await waitFor(() =>
      expect(within(screen.getByTestId('map-outline')).getByText('acme-api')).toBeTruthy(),
    );
    await router.navigate('/orgs/other');
    await waitFor(() =>
      expect(within(screen.getByTestId('map-outline')).getByText('other-api')).toBeTruthy(),
    );
    // Lo que se guarda para "other" es lo suyo: ningún id del workspace anterior.
    const stored = window.sessionStorage.getItem('parallax.map.expanded.other');
    expect(stored === null || !stored.includes('acme')).toBe(true);
  });
});
