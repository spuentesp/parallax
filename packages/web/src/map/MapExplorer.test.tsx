import type { MapViewResponse, NodeDetail, OrgEdge, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapExplorer } from './MapExplorer.js';

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
const edge = (over: Partial<OrgEdge>): OrgEdge => ({
  id: 'e',
  source: 'a',
  target: 'b',
  kind: 'consumes',
  provenance: 'deterministic',
  confidence: 1,
  count: 1,
  deterministicCount: 1,
  inferredCount: 0,
  ...over,
});

const META = { source: 'lain' as const, generatedAt: Date.now() - 3 * 60_000, stale: false };

// El borde de red del mapa: responde la proyección que el servidor daría para
// el conjunto de nodos expandidos. La lógica de proyección real se prueba en
// packages/api/test/org-graph.test.ts; aquí se prueba qué hace el cliente con
// ella y qué le pide al servidor.
interface Posted {
  expand: string[];
  filters?: { provenance?: string; minConfidence?: number; contract?: string };
  focus?: string;
  hops?: number;
  pin?: string[];
}
function serveMap(requests: Posted[]) {
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request }) => {
      const body = (await request.json()) as Posted;
      requests.push(body);
      const open = new Set(body.expand);
      // Como el servidor real: fijar un nodo abre a sus ancestros.
      if (body.pin?.includes('svc:orders')) open.add('repo:orders');
      const nodes: ProjectedNode[] = [
        pn('repo:orders', {
          kind: 'repo',
          label: 'orders',
          childCount: 1,
          expanded: open.has('repo:orders'),
        }),
        pn('repo:web', {
          kind: 'repo',
          label: 'web',
          childCount: 1,
          expanded: open.has('repo:web'),
        }),
      ];
      if (open.has('repo:orders')) {
        nodes.push(pn('svc:orders', { parent: 'repo:orders', label: 'orders-api', childCount: 1 }));
      }
      const view: MapViewResponse = {
        nodes,
        edges: [
          edge({
            id: 'r',
            source: 'repo:web',
            target: 'repo:orders',
            count: 4,
            deterministicCount: 3,
            inferredCount: 1,
          }),
        ],
        hiddenChildren: {},
        focus:
          body.focus && body.focus !== 'ghost'
            ? { seed: body.focus, ids: [body.focus, 'repo:web'] }
            : null,
        unknownExpand: [],
        totals: { nodes: 6, edges: 3, shownNodes: nodes.length, shownEdges: 1 },
        meta: META,
      };
      return HttpResponse.json(view);
    }),
  );
}

const detail: NodeDetail = {
  node: pn('svc:orders', { label: 'orders-api', parent: 'repo:orders', meta: {} }),
  path: [pn('repo:orders', { kind: 'repo', label: 'orders' })],
  children: [],
  consumers: [
    {
      peer: pn('svc:web', { label: 'storefront', parent: 'repo:web' }),
      edge: edge({ id: 'c1', count: 7, deterministicCount: 7 }),
      links: [],
      hiddenLinks: 0,
    },
    {
      peer: pn('svc:reports', { label: 'reports', parent: 'repo:analytics' }),
      edge: edge({
        id: 'c2',
        provenance: 'inferred',
        confidence: 0.4,
        count: 2,
        deterministicCount: 0,
        inferredCount: 2,
      }),
      links: [],
      hiddenLinks: 0,
    },
  ],
  providers: [],
};

function renderExplorer(url = '/') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <MapExplorer workspaceId="ws1" />
    </MemoryRouter>,
  );
}

function renderRouted(url: string) {
  const router = createMemoryRouter([{ path: '*', element: <MapExplorer workspaceId="ws1" /> }], {
    initialEntries: [url],
  });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}

describe('MapExplorer', () => {
  it('asks for the top level first, then opens the repos on its own so services show; closing one is respected', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    renderExplorer();

    const outline = await screen.findByTestId('map-outline');
    expect(requests[0]?.expand).toEqual([]);
    // Sin pulsar nada: los hijos de los repos llegan.
    expect(await within(outline).findByText('orders-api')).toBeTruthy();
    expect(requests.at(-1)?.expand).toEqual(['repo:orders', 'repo:web']);

    // Cerrar uno se respeta: la apertura automática es de una sola vez.
    fireEvent.click(within(outline).getByRole('button', { name: 'Collapse orders' }));
    await waitFor(() => expect(requests.at(-1)?.expand).toEqual(['repo:web']));
    await new Promise((r) => setTimeout(r, 100));
    expect(requests.at(-1)?.expand).toEqual(['repo:web']);
  });

  it('shows how much of the graph is on screen and how fresh it is', async () => {
    serveMap([]);
    renderExplorer();
    expect((await screen.findByTestId('map-totals')).textContent).toMatch(
      /2 of 6 nodes · 3 relations/,
    );
    expect(screen.getByTestId('map-freshness').textContent).toMatch(/updated 3 min ago/);
  });

  it('sends the provenance filter and a confidence floor to the server', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    renderExplorer();
    await screen.findByTestId('map-outline');

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(screen.getByRole('button', { name: /inferred/ }));
    await waitFor(() => expect(requests.at(-1)?.filters?.provenance).toBe('inferred'));

    fireEvent.change(screen.getByLabelText(/minimum confidence/i), { target: { value: '0.6' } });
    await waitFor(() => expect(requests.at(-1)?.filters?.minConfidence).toBe(0.6));

    // Con "deterministic" la confianza no aplica: el control desaparece.
    fireEvent.click(screen.getByRole('button', { name: /^deterministic$/ }));
    await waitFor(() => expect(screen.queryByLabelText(/minimum confidence/i)).toBeNull());
  });

  it('answers "who consumes this" with provenance on every consumer', async () => {
    serveMap([]);
    server.use(
      http.get('/api/workspaces/:id/map/node', () => HttpResponse.json({ detail, meta: META })),
    );
    renderExplorer('/?sel=svc:orders');

    const inspector = await screen.findByTestId('map-inspector');
    expect(within(inspector).getByText(/2 services across 2 repos/)).toBeTruthy();
    const web = within(inspector).getByText('storefront').closest('button') as HTMLElement;
    expect(web.textContent).toMatch(/deterministic/);
    expect(web.textContent).toMatch(/×7/);
    const reports = within(inspector).getByText('reports').closest('button') as HTMLElement;
    expect(reports.textContent).toMatch(/inferred · 40%/);
  });

  it('pins the selection on the server so a deep-linked node is always reachable', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    renderExplorer('/?sel=svc:orders');
    await screen.findByTestId('map-outline');
    expect(requests[0]?.pin).toEqual(['svc:orders']);
  });

  it('opens an agent deep link already focused on a subgraph', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    renderExplorer('/?focus=repo:orders&hops=2');
    expect(await screen.findByText('Focus')).toBeTruthy();
    expect(requests[0]).toMatchObject({ focus: 'repo:orders', hops: 2 });
  });

  it('rebuilds the graph on demand and reloads the views', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    let refreshed = 0;
    server.use(
      http.post('/api/workspaces/:id/map/refresh', () => {
        refreshed++;
        return HttpResponse.json({ meta: META, totals: { nodes: 6, edges: 3 } });
      }),
    );
    renderExplorer();
    await screen.findByTestId('map-outline');
    const before = requests.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(refreshed).toBe(1));
    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
  });

  it('says LAIN is unavailable instead of drawing an empty map', async () => {
    server.use(
      http.post('/api/workspaces/:id/map/view', () =>
        HttpResponse.json({
          nodes: [],
          edges: [],
          hiddenChildren: {},
          focus: null,
          unknownExpand: [],
          meta: { source: 'error', error: 'cannot reach lain' },
        }),
      ),
    );
    renderExplorer();
    const notice = await screen.findByTestId('map-notice');
    expect(notice.textContent).toMatch(/cannot reach lain/);
    expect(notice.textContent).toMatch(/unavailable/);
    expect(screen.queryByTestId('map-canvas')).toBeNull();
  });

  it('flags a stale graph while it revalidates', async () => {
    server.use(
      http.post('/api/workspaces/:id/map/view', () =>
        HttpResponse.json({
          nodes: [pn('repo:a', { kind: 'repo' })],
          edges: [],
          hiddenChildren: {},
          focus: null,
          unknownExpand: [],
          meta: { ...META, stale: true, refreshing: true },
        }),
      ),
    );
    renderExplorer();
    const f = await screen.findByTestId('map-freshness');
    expect(f.textContent).toMatch(/stale/i);
    expect(f.textContent).toMatch(/refreshing/);
  });

  it('can collapse an ancestor of the selection: the selection moves up instead of re-opening it', async () => {
    const requests: Posted[] = [];
    serveMap(requests);
    const router = renderRouted('/?sel=svc:orders');
    const outline = await screen.findByTestId('map-outline');
    expect(await within(outline).findByText('orders-api')).toBeTruthy();

    fireEvent.click(within(outline).getByRole('button', { name: 'Collapse orders' }));

    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('sel')).toBe('repo:orders');
    });
    await waitFor(() => expect(within(outline).queryByText('orders-api')).toBeNull());
    expect(requests.at(-1)?.pin).toEqual(['repo:orders']);
  });

  it('says a deep-linked node is not in this map instead of reporting a load failure', async () => {
    serveMap([]);
    server.use(
      http.get('/api/workspaces/:id/map/node', () =>
        HttpResponse.json({ code: 'NodeNotFound' }, { status: 404 }),
      ),
    );
    renderExplorer('/?sel=svc:gone');
    const missing = await screen.findByTestId('map-inspector-missing');
    expect(missing.textContent).toMatch(/not in this map/i);
    expect(screen.queryByText(/could not load this node/i)).toBeNull();
  });

  it('flags a focus target the map does not have instead of showing a focus that is not there', async () => {
    serveMap([]);
    renderExplorer('/?focus=ghost&hops=1');
    expect(await screen.findByTestId('map-focus-missing')).toBeTruthy();
    expect(screen.queryByText('Focus')).toBeNull();
  });

  it('clears "refreshing" by itself once the server finishes revalidating', async () => {
    let calls = 0;
    server.use(
      http.post('/api/workspaces/:id/map/view', () => {
        calls++;
        return HttpResponse.json({
          nodes: [pn('repo:a', { kind: 'repo' })],
          edges: [],
          hiddenChildren: {},
          focus: null,
          unknownExpand: [],
          meta: { ...META, stale: calls === 1, refreshing: calls === 1 },
        });
      }),
    );
    renderExplorer();
    expect((await screen.findByTestId('map-freshness')).textContent).toMatch(/refreshing/);
    await waitFor(
      () =>
        expect(screen.getByTestId('map-freshness').textContent).not.toMatch(/refreshing|stale/i),
      { timeout: 6000 },
    );
    expect(calls).toBeGreaterThan(1);
  }, 10_000);
});
