import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDetail } from './WorkspaceDetail.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({
    data: { workspace: { id: 'ws1', name: 'Demo', lainUrl: null, repos: [] } },
    isPending: false,
    isError: false,
  }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
  useWorkspaceTopology: () => ({ data: null, isLoading: false, isError: false }),
  useWorkspaceGraph: () => ({ data: null, isLoading: false, isError: false }),
  useEvidence: () => ({ mutate: () => {} }),
}));

describe('WorkspaceDetail', () => {
  it('shows the repo trees but not a second topology canvas', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/ws1']}>
        <Routes>
          <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/contract topology/i)).toBeTruthy();
    // TopologyView lleva su propio cromo ("Click a repo or service to
    // collapse / expand"); su ausencia prueba que el canvas vive solo en el hub.
    expect(screen.queryByText(/collapse \/ expand/i)).toBeNull();
  });
});
