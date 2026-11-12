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
    expect(await screen.findByText(/No open requests/)).toBeTruthy();
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
    expect(await screen.findByText(/Some requests could not be listed/)).toBeTruthy();
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
    expect(await screen.findByText(/Not on GitHub or GitLab.*\.\/checkouts\/local/)).toBeTruthy();
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

  it('shows the loading text until the listing arrives', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/workspaces/ws1/prs', async () => {
        await gate;
        return HttpResponse.json({ prs: [], skipped: [], errors: [], truncated: [] });
      }),
    );
    renderPicker();
    expect(await screen.findByText('Loading pull requests…')).toBeTruthy();
    expect(screen.queryByText(/No open requests/)).toBeNull();
    release();
    await waitFor(() => expect(screen.queryByText('Loading pull requests…')).toBeNull());
    expect(await screen.findByText(/No open requests/)).toBeTruthy();
  });

  it('does not show the empty state while loading or after a failed listing', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ title: 'boom' }, { status: 500 }),
      ),
    );
    renderPicker();
    await waitFor(() => expect(document.querySelector('p.text-error')).not.toBeNull());
    expect(screen.queryByText(/No open requests/)).toBeNull();
  });

  it('shows the listing error as an error line', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ title: 'boom' }, { status: 500 }),
      ),
    );
    renderPicker();
    const line = await waitFor(() => {
      const el = document.querySelector('p.text-error');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toContain('api 500');
  });

  it('renders no error, truncation or skip notices when the listing has none', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3)], skipped: [], errors: [], truncated: [] }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/#3 change 3/)).toBeTruthy();
    expect(screen.queryByText(/Could not list/)).toBeNull();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
    expect(screen.queryByText(/Not on GitHub or GitLab/)).toBeNull();
    expect(document.querySelectorAll('ul.text-error')).toHaveLength(0);
  });

  it('marks a non-draft PR without a Draft badge', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3)], skipped: [], errors: [], truncated: [] }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/#3 change 3/)).toBeTruthy();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('shows the author, or unknown when GitHub gives none', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3, { author: 'dev' }), pr(4, { author: null })],
          skipped: [],
          errors: [],
          truncated: [],
        }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/shop\.git · dev · main/)).toBeTruthy();
    expect(screen.getByText(/shop\.git · unknown · main/)).toBeTruthy();
  });

  it('disables every Evaluate button and labels the chosen PR while it is evaluated', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3), pr(4)], skipped: [], errors: [], truncated: [] }),
      ),
      http.post('/api/assessments', async () => {
        await gate;
        return HttpResponse.json({ assessment: { id: 'a_7' }, created: true }, { status: 201 });
      }),
    );
    renderPicker();
    const buttons = await screen.findAllByRole('button', { name: 'Evaluate' });
    fireEvent.click(buttons[0] as HTMLElement);

    await screen.findByRole('button', { name: 'Evaluating…' });
    const all = screen.getAllByRole('button');
    expect(all.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Evaluate' })).toHaveLength(1);

    release();
    expect(await screen.findByText('report page')).toBeTruthy();
  });

  it('keeps the Evaluate buttons enabled before any choice is made', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3), pr(4)], skipped: [], errors: [], truncated: [] }),
      ),
    );
    renderPicker();
    const buttons = await screen.findAllByRole('button', { name: 'Evaluate' });
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('shows the evaluation error in its own line', async () => {
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
    const line = await waitFor(() => {
      const el = document.querySelector('p.text-error.mt-3');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toContain('api 502');
  });

  it('joins several truncated repos and several skipped repos with commas', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3)],
          skipped: [
            { repo: './checkouts/a', reason: 'not_github' },
            { repo: './checkouts/b', reason: 'not_github' },
          ],
          errors: [],
          truncated: ['https://github.com/acme/one.git', 'https://github.com/acme/two.git'],
        }),
      ),
    );
    renderPicker();
    expect(
      await screen.findByText(
        'Some requests could not be listed for https://github.com/acme/one.git, https://github.com/acme/two.git (page limit or missing commit data).',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Not on GitHub or GitLab, so no requests to list: ./checkouts/a, ./checkouts/b.',
      ),
    ).toBeTruthy();
  });

  it('never shows the empty state when there are PRs to list', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({ prs: [pr(3)], skipped: [], errors: [], truncated: [] }),
      ),
    );
    renderPicker();
    expect(await screen.findByText(/#3 change 3/)).toBeTruthy();
    expect(screen.queryByText(/No open requests/)).toBeNull();
  });

  it('separates the author from the branches and the date with spaces', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () =>
        HttpResponse.json({
          prs: [pr(3, { author: 'dev' })],
          skipped: [],
          errors: [],
          truncated: [],
        }),
      ),
    );
    renderPicker();
    const meta = await screen.findByText(/shop\.git · dev · main/);
    expect(meta.textContent).toMatch(/feat-3 · \S/);
  });
});

describe('useOpenPrs without a workspace', () => {
  it('does not request a listing until a workspace is known', async () => {
    let requests = 0;
    server.use(
      http.get('*/prs', () => {
        requests += 1;
        return HttpResponse.json({ prs: [], skipped: [], errors: [], truncated: [] });
      }),
    );
    renderWithQuery(
      <MemoryRouter>
        <OpenPrPicker orgId={undefined as unknown as string} />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toBe(0);
  });
});
