import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgLayout, SAMPLE_TOPOLOGY } from './OrgLayout.js';
import { Service } from './Service.js';

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
          <Route path="services/:serviceId" element={<Service />} />
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
    expect(screen.getByText(/no topology yet/i)).toBeTruthy();
    // El CTA vive tanto en el empty state como en la barra de flujo.
    expect(screen.getAllByRole('link', { name: /configurar workspace/i }).length).toBeGreaterThan(
      0,
    );
  });
  it('keeps the graph mounted while the panel slot is active', () => {
    renderHub('/orgs/acme/probe');
    expect(screen.getByText('panel-slot')).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBeTruthy();
  });

  it('rejects unknown service ids with a recoverable message', () => {
    renderHub('/orgs/acme/services/does-not-exist');
    expect(screen.getByText(/servicio no encontrado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeTruthy();
  });

  it('flow actions carry the selected node context into the evaluation form', () => {
    renderHub('/orgs/acme?node=orders');
    const evaluar = screen.getByRole('link', { name: /evaluar pr/i });
    expect(evaluar.getAttribute('href')).toBe('/orgs/acme/assessments?repo=orders');
  });

  it('shows a recoverable notice for unknown ?node values', () => {
    renderHub('/orgs/acme?node=bogus');
    expect(screen.getByText(/nodo no encontrado/i)).toBeTruthy();
  });

  it('the open panel wins over a divergent ?node context', () => {
    renderHub('/orgs/acme/services/orders?node=billing');
    const evaluar = screen.getByRole('link', { name: /evaluar pr/i });
    expect(evaluar.getAttribute('href')).toBe('/orgs/acme/assessments?repo=orders');
  });
});
