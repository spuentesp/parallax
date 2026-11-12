import { cleanup, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { Assessments } from './Assessments.js';

afterEach(() => {
  cleanup();
});

function renderAt(path: string, route: string) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<Assessments />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Assessments CI and PR panels', () => {
  it('shows the PR picker and the auto CI panel for a workspace', async () => {
    server.use(
      http.get('/api/assessments', () => HttpResponse.json({ assessments: [] })),
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [], skipped: [], errors: [], truncated: [] }),
      ),
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
    );
    renderAt('/orgs/ws1/assessments', '/orgs/:orgId/assessments');
    expect(await screen.findByRole('heading', { name: 'Open pull requests' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Automatic reviews' })).toBeTruthy();
  });

  it('shows neither panel when the route has no workspace', async () => {
    server.use(http.get('/api/assessments', () => HttpResponse.json({ assessments: [] })));
    renderAt('/assessments', '/assessments');
    expect(await screen.findByRole('heading', { name: 'Assessments' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Open pull requests' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Automatic reviews' })).toBeNull();
  });
});
