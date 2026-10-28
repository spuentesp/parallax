import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoStatusResponse, Workspace } from '../api/hooks.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { RepoManager } from './RepoManager.js';

afterEach(cleanup);

const repo = (id: string, uri: string, local: string | null = null) => ({
  id,
  uri,
  sha: null,
  local,
});
const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'ws1',
  name: 'Saleor',
  description: null,
  lainUrl: 'http://lain.test/mcp',
  repos: [
    repo('r1', 'https://github.com/acme/orders.git', '/srv/orders'),
    repo('r2', 'https://github.com/acme/billing.git'),
    repo('r3', 'https://github.com/acme/ghost.git'),
  ],
  repoCount: 3,
  ...over,
});
const status = (over: Partial<RepoStatusResponse> = {}): RepoStatusResponse => ({
  source: 'lain',
  repos: [
    {
      id: 'r1',
      uri: 'https://github.com/acme/orders.git',
      sha: null,
      local: '/srv/orders',
      lainRepoId: 'orders',
      state: 'indexed',
      commit: 'abcdef1234567',
      dirty: true,
    },
    {
      id: 'r2',
      uri: 'https://github.com/acme/billing.git',
      sha: null,
      local: null,
      lainRepoId: 'billing',
      state: 'unreviewed',
    },
    {
      id: 'r3',
      uri: 'https://github.com/acme/ghost.git',
      sha: null,
      local: null,
      lainRepoId: 'ghost',
      state: 'not_in_lain',
    },
  ],
  untracked: [{ repo: 'legacy', commit: '0123456789abcdef' }],
  ...over,
});

function mount(
  workspace: Workspace,
  opts: { signedIn?: boolean | { readOnly: boolean }; statusBody?: RepoStatusResponse } = {},
) {
  server.use(
    http.get('/api/workspaces/:id/repos/status', () =>
      HttpResponse.json(opts.statusBody ?? status()),
    ),
  );
  const router = createMemoryRouter(
    [
      { path: '/', element: <RepoManager workspace={workspace} /> },
      { path: '/workspaces', element: <p>workspace list</p> },
    ],
    { initialEntries: ['/'] },
  );
  renderWithQuery(<RouterProvider router={router} />, { signedIn: opts.signedIn ?? true });
  return router;
}
// Sin servidor de rutas propio: el gestor sólo necesita un Router por el botón de borrar.
const bare = (workspace: Workspace = ws(), defaultStatus = true) => {
  if (defaultStatus) {
    server.use(http.get('/api/workspaces/:id/repos/status', () => HttpResponse.json(status())));
  }
  return renderWithQuery(
    <MemoryRouter>
      <RepoManager workspace={workspace} />
    </MemoryRouter>,
  );
};
const row = (id: string) => within(screen.getByTestId(`repo-row-${id}`));

describe('RepoManager — status', () => {
  it('shows each repository with its LAIN name, URI, local path and a status that says what it means', async () => {
    mount(ws());
    expect(await screen.findByText('Indexed · abcdef1 (dirty)')).toBeTruthy();
    expect(row('r1').getByText('orders')).toBeTruthy();
    expect(row('r1').getByText('https://github.com/acme/orders.git')).toBeTruthy();
    expect(row('r1').getByText('/srv/orders')).toBeTruthy();
    expect(row('r2').getByText('Not reviewed').getAttribute('title')).toMatch(
      /not reviewed it yet/,
    );
    const missing = row('r3').getByText('Not in LAIN');
    expect(missing.getAttribute('title')).toMatch(/repos\.yaml/);
    expect(row('r2').getByText('—')).toBeTruthy();
  });

  it('lists what LAIN has that the workspace does not, with a short commit', async () => {
    mount(ws());
    const box = within(await screen.findByTestId('untracked'));
    expect(box.getByText('legacy')).toBeTruthy();
    expect(box.getByText('0123456789')).toBeTruthy();
    cleanup();
    mount(ws(), { statusBody: status({ untracked: [] }) });
    await screen.findByText('Indexed · abcdef1 (dirty)');
    expect(screen.queryByTestId('untracked')).toBeNull();
  });

  it('while checking, says so; an engine failure says status is unknown, not missing', async () => {
    mount(ws({ repos: [repo('r1', 'https://github.com/acme/orders.git')] }), {
      statusBody: status({ source: 'error', error: 'lain unreachable', repos: [], untracked: [] }),
    });
    expect(screen.getByText('checking…')).toBeTruthy();
    expect((await screen.findByTestId('status-error')).textContent).toMatch(
      /lain unreachable.*unknown, not "missing"/,
    );
    expect(await screen.findByText('unknown')).toBeTruthy();
  });

  it('without a LAIN server it says nothing can be shown', async () => {
    mount(ws({ lainUrl: null }), {
      statusBody: status({ source: 'unconfigured', repos: [], untracked: [] }),
    });
    expect(await screen.findByText(/no LAIN server set/i)).toBeTruthy();
    expect(screen.getByTestId('lain-url').textContent).toBe('not configured');
  });

  it('an empty workspace says so and has no status note', async () => {
    mount(ws({ repos: [], repoCount: 0 }), {
      statusBody: status({ source: 'lain', repos: [], untracked: [] }),
    });
    expect(await screen.findByText('No repositories configured.')).toBeTruthy();
    expect(screen.queryByText(/no LAIN server set/i)).toBeNull();
  });

  it('Re-check asks again', async () => {
    let calls = 0;
    server.use(
      http.get('/api/workspaces/:id/repos/status', () => {
        calls++;
        return HttpResponse.json(status());
      }),
    );
    bare(ws(), false);
    await screen.findByText('Indexed · abcdef1 (dirty)');
    const before = calls;
    fireEvent.click(screen.getByRole('button', { name: 'Re-check status' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});

describe('RepoManager — add and remove', () => {
  it('adds a repository (trimmed, optional fields only when given), clears the form and refreshes status', async () => {
    let body: unknown;
    let statusCalls = 0;
    server.use(
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ repo: { id: 'new' } });
      }),
      http.get('/api/workspaces/:id/repos/status', () => {
        statusCalls++;
        return HttpResponse.json(status());
      }),
    );
    bare(ws(), false);
    await screen.findByText('Indexed · abcdef1 (dirty)');
    const add = screen.getByRole('button', { name: 'Add repository' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Repository URL or path'), {
      target: { value: '  https://github.com/acme/new.git ' },
    });
    fireEvent.change(screen.getByLabelText('Local checkout path'), {
      target: { value: ' /srv/new ' },
    });
    const before = statusCalls;
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    await waitFor(() =>
      expect(body).toEqual({ uri: 'https://github.com/acme/new.git', local: '/srv/new' }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Repository URL or path') as HTMLInputElement).value).toBe(''),
    );
    expect((screen.getByLabelText('Local checkout path') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(statusCalls).toBeGreaterThan(before));
  });

  it('sends the SHA when given, and shows the server’s reason when the repo is a duplicate', async () => {
    let body: unknown;
    server.use(
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { code: 'Conflict', detail: "repo 'x' is already in this workspace" },
          { status: 409 },
        );
      }),
    );
    bare();
    fireEvent.change(screen.getByLabelText('Repository URL or path'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Commit SHA'), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "repo 'x' is already in this workspace",
    );
    expect(body).toEqual({ uri: 'x', sha: 'abc123' });
    // El formulario conserva lo escrito para poder corregirlo.
    expect((screen.getByLabelText('Repository URL or path') as HTMLInputElement).value).toBe('x');
  });

  it('removal asks first: "no" cancels, "yes" deletes that repo from this workspace', async () => {
    const deleted: string[] = [];
    server.use(
      http.delete('/api/workspaces/:id/repos/:repoId', ({ params }) => {
        deleted.push(`${params.id}/${params.repoId}`);
        return HttpResponse.json({ deleted: true });
      }),
    );
    bare();
    await screen.findByText('Indexed · abcdef1 (dirty)');
    fireEvent.click(screen.getByRole('button', { name: 'Remove ghost' }));
    expect(screen.getByText(/Remove\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'no' }));
    expect(screen.queryByText(/Remove\?/)).toBeNull();
    expect(deleted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove ghost' }));
    fireEvent.click(screen.getByRole('button', { name: 'yes' }));
    await waitFor(() => expect(deleted).toEqual(['ws1/r3']));
    await waitFor(() => expect(screen.queryByText(/Remove\?/)).toBeNull());
  });

  it('a failed removal says why', async () => {
    server.use(
      http.delete('/api/workspaces/:id/repos/:repoId', () =>
        HttpResponse.json(
          { code: 'NotFound', detail: 'repo not found in this workspace' },
          { status: 404 },
        ),
      ),
    );
    bare();
    await screen.findByText('Indexed · abcdef1 (dirty)');
    fireEvent.click(screen.getByRole('button', { name: 'Remove ghost' }));
    fireEvent.click(screen.getByRole('button', { name: 'yes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('repo not found in this workspace');
  });
});

describe('RepoManager — LAIN server, configuration, deletion', () => {
  it('edits the LAIN URL, and an empty value clears it', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/workspaces/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ workspace: {} });
      }),
    );
    bare();
    expect(screen.getByTestId('lain-url').textContent).toBe('http://lain.test/mcp');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('LAIN server URL'), {
      target: { value: '  http://other:9999/mcp ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ lainUrl: 'http://other:9999/mcp' }]));
    await waitFor(() => expect(screen.queryByLabelText('LAIN server URL')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('LAIN server URL'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies.at(-1)).toEqual({ lainUrl: null }));
  });

  it('Cancel restores the stored URL, and a rejected URL shows the reason', async () => {
    server.use(
      http.patch('/api/workspaces/:id', () =>
        HttpResponse.json({ code: 'BadRequest', detail: 'lainUrl must be a URL' }, { status: 400 }),
      ),
    );
    bare();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('LAIN server URL'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('LAIN server URL') as HTMLInputElement).value).toBe(
      'http://lain.test/mcp',
    );
    fireEvent.change(screen.getByLabelText('LAIN server URL'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('lainUrl must be a URL');
  });

  it('shows the generated LAIN configuration on demand and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let asked = 0;
    server.use(
      http.get('/api/workspaces/:id/lain-config', () => {
        asked++;
        return HttpResponse.json({ config: 'repos:\n  - id: orders' });
      }),
    );
    bare();
    expect(asked).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Show LAIN configuration/ }));
    await waitFor(() =>
      expect(screen.getByTestId('lain-config').textContent).toBe('repos:\n  - id: orders'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('repos:\n  - id: orders'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hide LAIN configuration/ }));
    expect(screen.queryByTestId('lain-config')).toBeNull();
  });

  it('deleting the workspace asks first, then goes back to the list', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/workspaces/:id', () => {
        deleted = true;
        return HttpResponse.json({ deleted: true });
      }),
    );
    const router = mount(ws());
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace…' }));
    expect(screen.getByText('Delete “Saleor”?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'));
    expect(deleted).toBe(true);
  });
});

describe('RepoManager — read-only session', () => {
  it('can look but not change: no add form, remove, edit or delete', async () => {
    mount(ws(), { signedIn: { readOnly: true } });
    await screen.findByText('Indexed · abcdef1 (dirty)');
    expect(screen.queryByRole('button', { name: 'Add repository' })).toBeNull();
    expect(screen.queryByLabelText('Repository URL or path')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete workspace…' })).toBeNull();
    // Mirar sí: estado, configuración.
    expect(screen.getByRole('button', { name: /Show LAIN configuration/ })).toBeTruthy();
  });
});
