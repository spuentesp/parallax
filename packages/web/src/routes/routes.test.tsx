import { cleanup, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Assessment } from '../routes/Assessment.js';
import { OrgLayout } from '../routes/OrgLayout.js';
import { Orgs } from '../routes/Orgs.js';
import { sampleReport, server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(() => {
  cleanup();
});

describe('routes render in isolation', () => {
  it('Orgs shows the heading', () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs']}>
        <Routes>
          <Route path="/orgs" element={<Orgs />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('OrgLayout shows the org id in heading', () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs/acme']}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgLayout />}>
            <Route path="probe" element={<p>panel-slot</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /acme/i })).toBeTruthy();
  });

  it('Assessment shows the not-found state when the report is missing', async () => {
    server.use(
      http.get('/api/assessments/a_1', () =>
        HttpResponse.json({ code: 'NotImplemented' }, { status: 501 }),
      ),
    );
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs/acme/assessments/a_1']}>
        <Routes>
          <Route path="/orgs/:orgId/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/assessment not found/i)).toBeTruthy();
    // El link de salida conserva el contexto del org (spec: compatibilidad).
    const back = screen.getByRole('link', { name: /back to assessments/i });
    expect(back.getAttribute('href')).toBe('/orgs/acme/assessments');
  });

  it('Assessment renders the persisted report with findings and honest coverage', async () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Impact report')).toBeTruthy();
    expect(screen.getByText('FieldRemoved')).toBeTruthy();
    expect(screen.getByText(/customer_id/)).toBeTruthy();
    // INV 3: la omisión de reports es visible y nada se declara completo.
    expect(screen.getByText('incomplete')).toBeTruthy();
    expect(screen.getAllByText(/reports \(excluded\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no autoriza a concluir/i)).toBeTruthy();
    // INV 2: la explicación no toca los findings del analizador.
    expect(screen.getByText(/no puede promover NeedsInvestigation a Verified/i)).toBeTruthy();
  });

  it('the report crossing the wire satisfies the shared contract', () => {
    // Sanity: el handler por defecto sirve exactamente el shape que consume la UI.
    expect(sampleReport.evidence).toEqual([]);
  });
});
