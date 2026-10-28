import { cleanup, fireEvent, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithQuery } from '../test/render.js';
import { WorkspaceDetail } from './WorkspaceDetail.js';

afterEach(() => {
  cleanup();
});

describe('WorkspaceDetail', () => {
  const renderAt = (url: string) =>
    renderWithQuery(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        </Routes>
      </MemoryRouter>,
    );

  it('opens on the Map tab, the one place the org graph is drawn', async () => {
    renderAt('/workspaces/ws1');
    expect(await screen.findByTestId('map-explorer')).toBeTruthy();
    expect(screen.getByTestId('tab-map').className).toMatch(/bg-accent/);
    expect(screen.queryByText(/collapse \/ expand/i)).toBeNull();
  });

  it('keeps contracts and the code graph one click away, without a second topology canvas', async () => {
    renderAt('/workspaces/ws1?tab=contracts');
    expect(await screen.findByRole('heading', { name: /^contracts$/i })).toBeTruthy();
    expect(screen.queryByTestId('map-explorer')).toBeNull();
    expect(screen.queryByTestId('topology-view')).toBeNull();
    expect(screen.queryByText(/collapse \/ expand/i)).toBeNull();
  });

  it('switches tabs through the URL so a link can open the map already focused', async () => {
    renderAt('/workspaces/ws1?tab=contracts');
    await screen.findByRole('heading', { name: /^contracts$/i });
    fireEvent.click(screen.getByTestId('tab-map'));
    expect(await screen.findByTestId('map-explorer')).toBeTruthy();
  });

  it('an unknown ?tab falls back to the map, and switching keeps the other parameters without stacking history', async () => {
    const router = createMemoryRouter([{ path: '/workspaces/:id', element: <WorkspaceDetail /> }], {
      initialEntries: ['/workspaces/ws1?tab=bogus&focus=svc:a'],
    });
    renderWithQuery(<RouterProvider router={router} />);
    expect(await screen.findByTestId('map-explorer')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tab-graph'));
    const q = new URLSearchParams(router.state.location.search);
    expect([q.get('tab'), q.get('focus')]).toEqual(['graph', 'svc:a']);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByTestId('tab-graph').className).toMatch(/bg-accent/);
    expect(screen.getByTestId('tab-map').className).not.toMatch(/bg-accent/);
  });
});
