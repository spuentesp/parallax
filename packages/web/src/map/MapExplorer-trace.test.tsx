// El recorrido de punta a punta desde el mapa: seleccionar un endpoint → "Trace end to
// end" → el panel del trazado se abre sobre el mapa (y el inspector se aparta).

import type { MapViewResponse, NodeDetail, OrgNode, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapExplorer } from './MapExplorer.js';

afterEach(cleanup);

const pn = (id: string, over: Partial<ProjectedNode>): ProjectedNode => ({
  id,
  label: id,
  kind: 'repo',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: true,
  ...over,
});
const nodes: ProjectedNode[] = [
  pn('repo:saleor', { label: 'saleor', childCount: 1, meta: { lainRepoId: 'saleor' } }),
  pn('svc:api', { kind: 'service', label: 'saleor-api', parent: 'repo:saleor', childCount: 1 }),
  pn('ep:q', {
    kind: 'endpoint',
    label: 'graphql:query:products',
    parent: 'svc:api',
    contract: 'graphql',
  }),
];
const asOrg = (n: ProjectedNode): OrgNode => ({
  id: n.id,
  label: n.label,
  kind: n.kind,
  parent: n.parent,
  meta: n.meta,
  ...(n.contract ? { contract: n.contract } : {}),
});

function serve(traceBodies: Array<Record<string, unknown>> = []) {
  server.use(
    http.post('/api/workspaces/:id/map/view', () =>
      HttpResponse.json({
        nodes,
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        totals: { nodes: 3, edges: 0, shownNodes: 3, shownEdges: 0 },
        meta: { source: 'lain', generatedAt: Date.now() },
      } satisfies MapViewResponse),
    ),
    http.get('/api/workspaces/:id/map/node', () =>
      HttpResponse.json({
        detail: {
          node: asOrg(nodes[2] as ProjectedNode),
          path: [asOrg(nodes[1] as ProjectedNode), asOrg(nodes[0] as ProjectedNode)],
          children: [],
          consumers: [],
          providers: [],
        } satisfies NodeDetail,
        meta: { source: 'lain' },
      }),
    ),
    http.post('/api/workspaces/:id/trace/stream', async ({ request }) => {
      traceBodies.push((await request.json()) as Record<string, unknown>);
      return new HttpResponse(null, { status: 404 });
    }),
    http.post('/api/workspaces/:id/trace', () =>
      HttpResponse.json({
        seed: { key: 'graphql:query:products', service: 'saleor-api' },
        summary: 'it works',
        hops: [],
        rejected: [],
        links: [],
        gaps: [],
        sink: null,
        complete: false,
        status: 'available',
        usage: { modelCalls: 1, toolCalls: 0, promptTokens: 1, completionTokens: 1, ms: 1000 },
        errors: [],
      }),
    ),
  );
}

function mount(url: string) {
  const router = createMemoryRouter([{ path: '*', element: <MapExplorer workspaceId="ws1" /> }], {
    initialEntries: [url],
  });
  renderWithQuery(<RouterProvider router={router} />);
}

describe('MapExplorer — trace end to end', () => {
  it('selecting an endpoint and pressing "Trace end to end" opens the trace panel for that contract and service, and tucks the inspector away', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    serve(bodies);
    mount('/?sel=ep:q');
    expect(screen.queryByTestId('trace-panel')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Trace end to end' }));
    const panel = await screen.findByTestId('trace-panel');
    expect(panel.textContent).toMatch(/graphql:query:products/);
    await waitFor(() =>
      expect(bodies).toEqual([{ key: 'graphql:query:products', service: 'saleor-api' }]),
    );
    // Un solo panel a la vez sobre el mapa.
    expect(screen.queryByTestId('map-inspector')).toBeNull();
    expect(await screen.findByTestId('trace-view')).toBeTruthy();
  });

  it('closing the trace brings the inspector back', async () => {
    serve();
    mount('/?sel=ep:q');
    fireEvent.click(await screen.findByRole('button', { name: 'Trace end to end' }));
    await screen.findByTestId('trace-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Close trace' }));
    expect(screen.queryByTestId('trace-panel')).toBeNull();
    expect(await screen.findByTestId('map-inspector')).toBeTruthy();
  });
});
