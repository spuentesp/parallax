import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { Workspaces } from './Workspaces.js';

afterEach(() => {
  cleanup();
});

function renderPage(): ReturnType<typeof renderWithQuery> {
  return renderWithQuery(
    <MemoryRouter>
      <Workspaces />
    </MemoryRouter>,
  );
}

const monorepo = {
  id: 'ws_mono',
  name: 'Saleor',
  description: 'Commerce platform',
  lainUrl: 'http://localhost:9999/mcp',
  repoCount: 1,
  repos: [{ uri: 'https://github.com/acme/saleor.git' }],
};

const multi = {
  id: 'ws_multi',
  name: 'Platform',
  description: null,
  lainUrl: null,
  repoCount: 2,
  repos: [{ uri: '/src/orders' }, { uri: '/src/billing.git' }],
};

describe('Workspaces list', () => {
  it('shows a loading indicator while the list is fetching', async () => {
    server.use(
      http.get('/api/workspaces', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ workspaces: [] });
      }),
    );
    renderPage();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  });

  it('shows the empty state only once loading has finished', async () => {
    renderPage();
    expect(await screen.findByText(/No workspaces yet/)).toBeTruthy();
  });

  it('does not show the empty state while loading', () => {
    server.use(
      http.get('/api/workspaces', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ workspaces: [] });
      }),
    );
    renderPage();
    expect(screen.queryByText(/No workspaces yet/)).toBeNull();
  });

  it('surfaces a request failure instead of an empty list', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );
    renderPage();
    expect(await screen.findByText(/Error/)).toBeTruthy();
    expect(screen.queryByText(/No workspaces yet/)).toBeNull();
  });

  it('renders each workspace as a link to its topology with description and repo names', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo, multi] })),
    );
    renderPage();

    expect(await screen.findByText('Saleor')).toBeTruthy();
    expect(screen.getByText('Commerce platform')).toBeTruthy();
    expect(screen.getByText('Monorepo')).toBeTruthy();
    expect(screen.getByText('Multi-repo')).toBeTruthy();
    expect(screen.getByText('1 repo')).toBeTruthy();
    expect(screen.getByText('2 repos')).toBeTruthy();
    expect(screen.getByText(/saleor/)).toBeTruthy();
    expect(screen.getByText(/orders, billing/)).toBeTruthy();
    expect(screen.getByText('LAIN connected')).toBeTruthy();
    expect(screen.getByText('LAIN not configured')).toBeTruthy();

    const link = screen.getByText('Saleor').closest('a');
    expect(link?.getAttribute('href')).toBe('/workspaces/ws_mono');
  });

  it('omits the repo-name line when the workspace has no repos', async () => {
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [{ ...monorepo, repoCount: 0, repos: [] }],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('0 repos')).toBeTruthy();
    expect(screen.queryByText(/saleor/)).toBeNull();
  });
});

describe('Workspaces create form', () => {
  it('opens and closes with the New Workspace toggle', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    expect(screen.queryByText('New Workspace')).toBeNull();

    const toggle = screen.getByRole('button', { name: '+ New Workspace' });
    fireEvent.click(toggle);
    expect(screen.getByText('New Workspace', { selector: 'h2' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull();
  });

  it('disables submit until a name is entered', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));

    const submit = screen.getByRole('button', { name: 'Create Workspace' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: '   ' },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('adds and removes repo rows, keeping at least one row', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));

    expect(screen.queryByRole('button', { name: 'Remove repo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ Add repo' }));
    const removers = screen.getAllByRole('button', { name: 'Remove repo' });
    expect(removers).toHaveLength(2);

    fireEvent.click(removers[0] as HTMLElement);
    expect(screen.queryByRole('button', { name: 'Remove repo' })).toBeNull();
    expect(screen.getAllByPlaceholderText(/github.com\/org\/repo/)).toHaveLength(1);
  });

  it('posts only the filled fields and closes on success', async () => {
    let body: unknown = null;
    let repoBody: unknown = null;
    server.use(
      http.post('/api/workspaces', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          workspace: { ...monorepo, id: 'ws_new', name: 'Saleor' },
        });
      }),
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        repoBody = await request.json();
        return HttpResponse.json({ repo: {} });
      }),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));

    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://github.com/org/repo.git or ./path'), {
      target: { value: 'https://github.com/acme/saleor.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => expect(repoBody).not.toBeNull());
    expect(body).toEqual({ name: 'Saleor' });
    expect(repoBody).toEqual({ uri: 'https://github.com/acme/saleor.git' });
    await waitFor(() => expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull());
  });

  it('sends optional fields and skips repo rows without a uri', async () => {
    let body: unknown = null;
    let repoBody: unknown = null;
    server.use(
      http.post('/api/workspaces', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ workspace: { ...monorepo, id: 'ws_new' } });
      }),
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        repoBody = await request.json();
        return HttpResponse.json({ repo: {} });
      }),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));

    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.change(screen.getByPlaceholderText('Description (optional)'), {
      target: { value: 'Commerce' },
    });
    fireEvent.change(screen.getByPlaceholderText(/LAIN endpoint/), {
      target: { value: 'http://localhost:9999/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add repo' }));
    const uris = screen.getAllByPlaceholderText(/github.com\/org\/repo/);
    fireEvent.change(uris[0] as HTMLElement, { target: { value: '' } });
    fireEvent.change(uris[1] as HTMLElement, { target: { value: './local' } });
    fireEvent.change(screen.getAllByPlaceholderText('SHA (optional)')[1] as HTMLElement, {
      target: { value: 'abc1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => expect(repoBody).not.toBeNull());
    expect(body).toEqual({
      name: 'Saleor',
      description: 'Commerce',
      lainUrl: 'http://localhost:9999/mcp',
    });
    expect(repoBody).toEqual({ uri: './local', sha: 'abc1234' });
  });

  it('shows the error when creation fails and keeps the form open', async () => {
    server.use(
      http.post('/api/workspaces', () =>
        HttpResponse.json({ error: 'name taken' }, { status: 409 }),
      ),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    expect(await screen.findByText(/409|name taken|Error/)).toBeTruthy();
    expect(screen.getByText('New Workspace', { selector: 'h2' })).toBeTruthy();
  });

  it('closes the form when Cancel is pressed', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull();
  });
});
