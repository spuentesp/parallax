import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgLayout, SAMPLE_TOPOLOGY } from './OrgLayout.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHub(initialEntry = '/orgs/acme') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orgs/:orgId" element={<OrgLayout />}>
          <Route path="probe" element={<p>panel-slot</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrgLayout hub', () => {
  it('shows the org heading, topology and chat on one screen', () => {
    renderHub();
    expect(screen.getByRole('heading', { name: /acme/i })).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBeTruthy();
    expect(SAMPLE_TOPOLOGY.nodes.length).toBeGreaterThan(0);
  });

  it('renders nested routes in the panel slot', () => {
    renderHub('/orgs/acme/probe');
    expect(screen.getByText('panel-slot')).toBeTruthy();
  });

  it('shows the empty-state CTA when the topology has no data', () => {
    render(
      <MemoryRouter initialEntries={['/orgs/acme']}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgLayout emptyTopology />}>
            <Route path="probe" element={<p>panel-slot</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /configurar workspace/i })).toBeTruthy();
  });
});
