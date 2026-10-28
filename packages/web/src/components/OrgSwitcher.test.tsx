import { cleanup, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { OrgSwitcher } from './OrgSwitcher.js';

afterEach(cleanup);

const at = (url: string) =>
  renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="*" element={<OrgSwitcher />} />
      </Routes>
    </MemoryRouter>,
  );

describe('OrgSwitcher', () => {
  it('outside a workspace page it still shows the card: there is no workspace yet, and a way to create one', async () => {
    at('/orgs');
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: /create one/i }).getAttribute('href')).toBe('/orgs');
  });

  it('outside a workspace page it shows the workspace in use', async () => {
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [
            { id: 'w1', name: 'First', description: '', repoCount: 1, repos: [], lainUrl: null },
          ],
        }),
      ),
      http.get('/api/workspaces/:id', () =>
        HttpResponse.json({ workspace: { id: 'w1', name: 'First', repos: [] } }),
      ),
    );
    at('/orgs');
    expect(await screen.findByText('First')).toBeTruthy();
    expect(screen.getByRole('link', { name: /all workspaces/i })).toBeTruthy();
  });

  it('prefers the org name, then the workspace name, then the id', async () => {
    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ orgs: [{ id: 'acme', name: 'Acme Corp' }] })),
    );
    at('/orgs/acme');
    expect(await screen.findByText('Acme Corp')).toBeTruthy();
    cleanup();

    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ orgs: [] })),
      http.get('/api/workspaces/:id', () =>
        HttpResponse.json({ workspace: { id: 'w9', name: 'Platform', repos: [] } }),
      ),
    );
    at('/orgs/w9/assessments');
    expect(await screen.findByText('Platform')).toBeTruthy();
    cleanup();

    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ orgs: [] })),
      http.get('/api/workspaces/:id', () => HttpResponse.json({ workspace: null })),
    );
    at('/orgs/raw-id');
    expect(await screen.findByText('raw-id')).toBeTruthy();
  });

  it('links back to the list of workspaces', async () => {
    at('/orgs/acme');
    const link = await screen.findByRole('link', { name: /all workspaces/i });
    expect(link.getAttribute('href')).toBe('/orgs');
    expect(screen.getByText('Workspace')).toBeTruthy();
  });
});
