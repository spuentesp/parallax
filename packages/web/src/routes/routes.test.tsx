import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assessment } from '../routes/Assessment.js';
import { Org } from '../routes/Org.js';
import { Orgs } from '../routes/Orgs.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const useAssessmentMock = vi.fn(() => ({ data: null, isPending: false, isError: false }));

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: (...args: unknown[]) => useAssessmentMock(...args),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
}));

describe('routes render in isolation', () => {
  it('Orgs shows the heading', () => {
    render(
      <MemoryRouter initialEntries={['/orgs']}>
        <Routes>
          <Route path="/orgs" element={<Orgs />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });
  it('Org shows the org id in heading', () => {
    render(
      <MemoryRouter initialEntries={['/orgs/acme']}>
        <Routes>
          <Route path="/orgs/:orgId" element={<Org />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /acme/i })).toBeTruthy();
  });
  it('Assessment shows the not-found state when the report is missing', () => {
    render(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/assessment not found/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to assessments/i })).toBeTruthy();
  });

  it('Assessment renders the persisted report with findings and honest coverage', () => {
    useAssessmentMock.mockReturnValueOnce({
      data: {
        assessment: {
          id: 'a_1',
          orgId: 'ws_fixture',
          inputDigest: 'sha256_abc',
          status: 'PARTIAL',
          baseId: 'snap_base',
          headId: 'snap_head',
          manifest: {},
          findings: [
            {
              kind: 'FieldRemoved',
              field: 'customer_id',
              service: 'orders',
              endpoint: { key: 'http:GET /api/orders/{}' },
              impact: { class: 'Verified' },
              affected: [{ service: 'billing', class: 'Verified' }],
            },
          ],
          engine: {},
          coverage: {
            complete: false,
            summary:
              'revisados: orders, billing · no revisados: reports (excluded) · la cobertura está incompleta: un resultado vacío no autoriza a concluir ausencia de impacto',
            scope: {
              reviewed: ['orders', 'billing'],
              unreviewed: [{ repo: 'reports', reason: 'excluded' }],
              excluded: [],
            },
          },
          evidence: [],
          explanation: { status: 'skipped', revision: 0, model: 'none' },
          createdAt: 1,
          completedAt: 2,
        },
      },
      isPending: false,
      isError: false,
    });
    render(
      <MemoryRouter initialEntries={['/assessments/a_1']}>
        <Routes>
          <Route path="/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Impact report')).toBeTruthy();
    expect(screen.getByText('FieldRemoved')).toBeTruthy();
    expect(screen.getByText(/customer_id/)).toBeTruthy();
    // INV 3: la omisión de reports es visible y nada se declara completo.
    expect(screen.getByText('incomplete')).toBeTruthy();
    expect(screen.getAllByText(/reports \(excluded\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no autoriza a concluir/i)).toBeTruthy();
    // INV 2: la explicación no toca los findings del analizador.
    expect(screen.getByText(/no puede promover NeedsInvestigation a Verified/i)).toBeTruthy();
  });
});
