import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { OpenPrPicker } from './OpenPrPicker.js';

afterEach(() => {
  cleanup();
});

const pr = (number: number, overrides: Record<string, unknown> = {}) => ({
  number,
  url: `https://github.com/acme/shop/pull/${number}`,
  title: `change ${number}`,
  author: 'dev',
  draft: false,
  baseRef: 'main',
  headRef: `feat-${number}`,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  updatedAt: '2026-10-17T12:00:00Z',
  repo: 'https://github.com/acme/shop.git',
  ...overrides,
});

function renderPicker() {
  return renderWithQuery(
    <MemoryRouter initialEntries={['/orgs/ws1/assessments']}>
      <Routes>
        <Route path="/orgs/:orgId/assessments" element={<OpenPrPicker orgId="ws1" />} />
        <Route path="/orgs/:orgId/assessments/:assessmentId" element={<p>report page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OpenPrPicker', () => {
  it('lists open PRs with their branches, and marks drafts', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3), pr(9, { draft: true, title: 'wip' })],
          skipped: [],
          errors: [],
          truncated: [],
        }),
      ),
    );
    renderPicker();

    expect(await screen.findByText(/#3 change 3/)).toBeTruthy();
    expect(screen.getByText(/#9 wip/)).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getAllByText(/main ← feat-/)).toHaveLength(2);
  });

  it('shows the empty state when the workspace has no open PRs', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [], skipped: [], errors: [], truncated: [] }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/No open PRs/)).toBeTruthy();
  });

  it('reports a repo that could not be listed instead of dropping it', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3)],
          skipped: [],
          errors: [
            {
              repo: 'https://github.com/acme/private',
              code: 'not_found',
              message: 'not found: /repos/acme/private/pulls',
            },
          ],
          truncated: [],
        }),
      ),
    );
    renderPicker();
    expect(
      await screen.findByText(/Could not list https:\/\/github.com\/acme\/private/),
    ).toBeTruthy();
  });

  it('says when a listing was truncated and which repo', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3)],
          skipped: [],
          errors: [],
          truncated: ['https://github.com/acme/shop.git'],
        }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/Showing the first 100 open PRs/)).toBeTruthy();
  });

  it('says which repos are not on GitHub', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [],
          skipped: [{ repo: './checkouts/local', reason: 'not_github' }],
          errors: [],
          truncated: [],
        }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/Not on GitHub.*\.\/checkouts\/local/)).toBeTruthy();
  });

  it('evaluates the chosen PR by its URL and opens the new report', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3)], skipped: [], errors: [], truncated: [] }),
      ),
      http.post('/api/assessments', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ assessment: { id: 'a_42' }, created: true }, { status: 201 });
      }),
    );
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Evaluate' }));

    expect(await screen.findByText('report page')).toBeTruthy();
    expect(body).toEqual({ prUrl: 'https://github.com/acme/shop/pull/3', orgId: 'ws1' });
  });

  it('shows the error when the evaluation fails and keeps the list usable', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3)], skipped: [], errors: [], truncated: [] }),
      ),
      http.post('/api/assessments', () =>
        HttpResponse.json({ title: 'PR URL resolution failed' }, { status: 502 }),
      ),
    );
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Evaluate' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Evaluate' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.queryByText('report page')).toBeNull();
  });
});
