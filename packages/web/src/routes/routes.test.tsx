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

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: () => ({ data: null, isPending: false, isError: false }),
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
  it('Assessment shows the assessment id', () => {
    render(
      <MemoryRouter initialEntries={['/orgs/acme/assessments/a_1']}>
        <Routes>
          <Route path="/orgs/:orgId/assessments/:assessmentId" element={<Assessment />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('article').textContent).toContain('a_1');
  });
});
