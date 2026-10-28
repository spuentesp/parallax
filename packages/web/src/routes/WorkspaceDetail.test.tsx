import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithQuery } from '../test/render.js';
import { WorkspaceDetail } from './WorkspaceDetail.js';

afterEach(() => {
  cleanup();
});

describe('WorkspaceDetail', () => {
  it('shows the repo trees but not a second topology canvas', async () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/workspaces/ws1']}>
        <Routes>
          <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/contract topology/i)).toBeTruthy();
    expect(screen.queryByText(/collapse \/ expand/i)).toBeNull();
  });
});
