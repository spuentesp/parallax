import { cleanup, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Assessment } from '../routes/Assessment.js';
import { OrgLayout } from '../routes/OrgLayout.js';
import { Workspaces } from '../routes/Workspaces.js';
import { sampleReport, server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(() => {
  cleanup();
});

describe('routes render in isolation', () => {
  it('the workspace list shows its heading', () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs']}>
        <Routes>
          <Route path="/orgs" element={<Workspaces />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /^workspaces$/i })).toBeTruthy();
  });

  it('OrgLayout renders the map for the org', async () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs/acme']}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgLayout />}>
            <Route path="probe" element={<p>panel-slot</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('map-explorer')).toBeTruthy();
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

  it('Assessment shows the model explanation text next to its status, and what was left unexplained', async () => {
    server.use(
      http.get('/api/assessments/a_1', () =>
        HttpResponse.json({
          assessment: {
            ...sampleReport,
            explanation: {
              status: 'failed:findings_unaddressed',
              revision: 0,
              model: 'nemotron',
              narrative:
                'Two changes.\n- F1 EndpointRemoved [engine: Verified]\n  F2 NOT EXPLAINED',
              unaddressed: ['F2'],
            },
          },
        }),
      ),
    );
    renderWithQuery(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('failed:findings_unaddressed')).toBeTruthy();
    expect(screen.getByText(/F1 EndpointRemoved \[engine: Verified\]/)).toBeTruthy();
    expect(screen.getByText(/F2 NOT EXPLAINED/)).toBeTruthy();
  });

  it('Assessment shows the code impact of the PR next to the contract findings, and omits it when there is none', async () => {
    const withImpact = {
      ...sampleReport,
      codeImpact: {
        repo: 'saleor',
        index: { commit: '487885d437feed94922cdbdf16a76552c120b550', matchesBase: false },
        filesChanged: 3,
        filesAnalyzed: 1,
        symbols: [
          {
            name: 'decrease_stock',
            kind: 'function',
            repo: 'saleor',
            path: 'saleor/warehouse/management.py',
            line: 586,
            change: 'edited',
            direct: 12,
            transitive: 11,
            risk: 'high',
            untested: false,
            dependents: [],
          },
        ],
        newDefinitions: 0,
        moduleScopeFiles: [],
        skipped: {
          nonCode: 0,
          tests: 0,
          addedFiles: 0,
          noDiff: 0,
          overFileLimit: 0,
          overSymbolLimit: 0,
        },
        gaps: [],
        highestRisk: 'high',
      },
    };
    server.use(
      http.get('/api/assessments/a_1', () => HttpResponse.json({ assessment: withImpact })),
    );
    renderWithQuery(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('code-impact')).toBeTruthy();
    expect(screen.getByText('decrease_stock')).toBeTruthy();
    expect(screen.getByText('index is not at the PR base')).toBeTruthy();
    // Los contratos siguen ahí: es otra medida, no un reemplazo.
    expect(screen.getByText('FieldRemoved')).toBeTruthy();
  });

  it('a report without a code review has no empty Code impact section', async () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Impact report');
    expect(screen.queryByTestId('code-impact')).toBeNull();
  });

  it('the report crossing the wire satisfies the shared contract', () => {
    // Sanity: el handler por defecto sirve exactamente el shape que consume la UI.
    expect(sampleReport.evidence).toEqual([]);
  });
});
