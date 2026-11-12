import type { MapViewResponse } from '@parallax/shared/org-map';
import { cleanup, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapExplorer } from './MapExplorer.js';

afterEach(cleanup);

function mount(signedIn: boolean | { readOnly: boolean }) {
  server.use(
    http.post('/api/workspaces/:id/map/view', () =>
      HttpResponse.json({
        nodes: [],
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        meta: { source: 'lain', generatedAt: Date.now() },
      } satisfies MapViewResponse),
    ),
  );
  const router = createMemoryRouter([{ path: '*', element: <MapExplorer workspaceId="ws1" /> }]);
  renderWithQuery(<RouterProvider router={router} />, { signedIn });
}

describe('MapExplorer with a read-only session', () => {
  it('cannot rebuild the graph, and says why; a full session can', async () => {
    mount({ readOnly: true });
    const bar = within(await screen.findByTestId('map-toolbar'));
    const refresh = bar.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.title).toMatch(/read-only/i);
    cleanup();
    mount(true);
    const full = within(await screen.findByTestId('map-toolbar')).getByRole('button', {
      name: 'Refresh',
    }) as HTMLButtonElement;
    expect(full.disabled).toBe(false);
    expect(full.title).toBe('Rebuild the graph from LAIN');
  });
});
