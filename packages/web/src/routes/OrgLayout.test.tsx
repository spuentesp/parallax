import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

const svc = (name: string): ProjectedNode => ({
  id: `svc:${name}`,
  label: name,
  kind: 'service',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
});

function serveMap(nodes: ProjectedNode[]) {
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request }) => {
      const body = (await request.json()) as { focus?: string };
      // Como el servidor: un foco que existe en el mapa vuelve como foco.
      const known = nodes.some((n) => n.id === body.focus);
      const view: MapViewResponse = {
        nodes,
        edges: [],
        hiddenChildren: {},
        focus: known && body.focus ? { seed: body.focus, ids: [body.focus] } : null,
        unknownExpand: [],
        totals: { nodes: nodes.length, edges: 0, shownNodes: nodes.length, shownEdges: 0 },
        meta: { source: 'lain', generatedAt: Date.now() },
      };
      return HttpResponse.json(view);
    }),
  );
}

function renderHub(url = '/orgs/acme') {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}

describe('OrgLayout hub', () => {
  it('shows the org, the contextual action and the real map on one screen', async () => {
    serveMap([svc('orders'), svc('billing')]);
    renderHub();
    const outline = await screen.findByTestId('map-outline');
    expect(within(outline).getByText('orders')).toBeTruthy();
    expect(screen.getByRole('link', { name: /evaluate pr/i })).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /configure workspace|view assessments/i }),
    ).toBeNull();
  });

  it('says the workspace has no LAIN instead of drawing sample data', async () => {
    renderHub(); // el handler por defecto responde "unconfigured"
    expect((await screen.findByTestId('map-notice')).textContent).toMatch(/no LAIN server/i);
    expect(screen.queryByTestId('map-outline')).toBeNull();
  });

  it('flow actions carry the node selected in the map into the evaluation form', async () => {
    serveMap([svc('orders')]);
    renderHub('/orgs/acme?sel=svc:orders');
    const evaluate = await screen.findByRole('link', { name: /evaluate pr/i });
    expect(evaluate.getAttribute('href')).toBe('/orgs/acme/assessments?repo=orders');
  });

  it('keeps the old service URL alive: it lands on the hub with that service in focus', async () => {
    serveMap([svc('orders')]);
    const router = renderHub('/orgs/acme/services/orders');
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme'));
    const q = new URLSearchParams(router.state.location.search);
    expect(q.get('sel')).toBe('svc:orders');
    expect(q.get('focus')).toBe('svc:orders');
  });
});

describe('OrgLayout assistant', () => {
  const answer = (map_focus: unknown) =>
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({
          answer: 'billing consumes orders.',
          explanation_status: 'complete',
          claims_summary: {
            total: 2,
            verified: 1,
            contradicted: 1,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          map_focus,
        }),
      ),
    );
  const ask = async (text: string) => {
    fireEvent.change(screen.getByLabelText(/ask about your architecture/i), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  it('sends the question to the investigator with the org and shows the engine verdicts', async () => {
    let body: unknown;
    server.use(
      http.post('/api/query', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          answer: 'billing consumes orders.',
          explanation_status: 'complete',
          claims_summary: {
            total: 2,
            verified: 1,
            contradicted: 1,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          map_focus: null,
        });
      }),
    );
    renderHub();
    await ask('who consumes orders?');
    expect(await screen.findByText('billing consumes orders.')).toBeTruthy();
    expect(body).toEqual({ question: 'who consumes orders?', orgId: 'acme' });
    expect(screen.getByTestId('claims-summary').textContent).toMatch(/1 verified · 1 contradicted/);
    // Sin recibo del motor no hay a dónde llevar al usuario.
    expect(screen.queryByRole('button', { name: /show on map/i })).toBeNull();
  });

  it('"Show on map" leaves the map pointing at the subgraph the engine backed', async () => {
    answer({
      seed: 'svc:orders',
      ids: ['svc:orders', 'svc:billing'],
      relations: [
        {
          consumer: 'billing',
          provider: 'orders',
          polarity: 'present',
          uses: 3,
          endpoints: [],
          complete: true,
        },
      ],
      query: '?tab=map&focus=svc%3Aorders&hops=1&sel=svc%3Aorders',
    });
    serveMap([svc('orders'), svc('billing')]);
    const router = renderHub();
    await ask('who consumes orders?');
    fireEvent.click(await screen.findByRole('button', { name: /show on map · 2 nodes/i }));
    await waitFor(() => {
      const q = new URLSearchParams(router.state.location.search);
      expect(q.get('focus')).toBe('svc:orders');
      expect(q.get('sel')).toBe('svc:orders');
    });
    // El mapa recibe el foco: aparece la etiqueta de foco sobre el lienzo.
    expect(await screen.findByText('Focus')).toBeTruthy();
  });

  it('reports a failed question instead of staying silent', async () => {
    server.use(http.post('/api/query', () => HttpResponse.json({ code: 'Boom' }, { status: 500 })));
    renderHub();
    await ask('anything');
    expect(await screen.findByText(/could not be answered/i)).toBeTruthy();
  });
});
