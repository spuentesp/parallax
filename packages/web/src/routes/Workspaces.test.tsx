import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

// Cada tarjeta es el enlace que envuelve el nombre. Las aserciones van dentro
// de la tarjeta: un intercambio de etiquetas entre tarjetas tiene que romper.
async function cardFor(name: string): Promise<HTMLElement> {
  const link = (await screen.findByText(name)).closest('a');
  if (!link) throw new Error(`no card link around ${name}`);
  return link;
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

  it('hides the empty state when there are workspaces', async () => {
    server.use(http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo] })));
    renderPage();
    await screen.findByText('Saleor');
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

  it('labels each card by its own repo count', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo, multi] })),
    );
    renderPage();

    expect(within(await cardFor('Saleor')).getByText('Monorepo')).toBeTruthy();
    expect(within(await cardFor('Platform')).getByText('Multi-repo')).toBeTruthy();
  });

  it('shows the repo count line exactly, with names stripped of .git', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo, multi] })),
    );
    renderPage();

    const saleor = await cardFor('Saleor');
    const platform = await cardFor('Platform');
    expect(saleor.querySelector('.mt-2')?.textContent).toBe('1 repo · saleor');
    expect(platform.querySelector('.mt-2')?.textContent).toBe('2 repos · orders, billing');
  });

  it('shows the description only when the workspace has one', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo, multi] })),
    );
    renderPage();

    const saleor = await cardFor('Saleor');
    const platform = await cardFor('Platform');
    expect(saleor.querySelector('.text-sm.mt-1')?.textContent).toBe('Commerce platform');
    expect(platform.querySelector('.text-sm.mt-1')).toBeNull();
  });

  it('reports LAIN status per workspace', async () => {
    server.use(
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo, multi] })),
    );
    renderPage();

    expect(within(await cardFor('Saleor')).getByText('LAIN connected')).toBeTruthy();
    expect(within(await cardFor('Platform')).getByText('LAIN not configured')).toBeTruthy();
  });

  it('links each card to its topology', async () => {
    server.use(http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [monorepo] })));
    renderPage();

    expect((await cardFor('Saleor')).getAttribute('href')).toBe('/workspaces/ws_mono');
  });

  it('strips only a trailing .git from repo names', async () => {
    const dotted = {
      ...monorepo,
      repoCount: 1,
      repos: [{ uri: 'https://github.com/acme/tools.github.git' }],
    };
    server.use(http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [dotted] })));
    renderPage();

    expect((await cardFor('Saleor')).querySelector('.mt-2')?.textContent).toBe(
      '1 repo · tools.github',
    );
  });

  it('omits the repo-name separator when the workspace has no repos', async () => {
    server.use(
      http.get('/api/workspaces', () =>
        HttpResponse.json({
          workspaces: [{ ...monorepo, repoCount: 0, repos: [] }],
        }),
      ),
    );
    renderPage();

    expect((await cardFor('Saleor')).querySelector('.mt-2')?.textContent).toBe('0 repos');
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

  it('shows the creating label and disables submit while the request is pending', async () => {
    server.use(
      http.post('/api/workspaces', async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({ workspace: { ...monorepo, id: 'ws_new' } });
      }),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    const pending = await screen.findByRole('button', { name: 'Creating…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull());
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

  it('removes the row that was clicked and keeps the others', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.change(screen.getByPlaceholderText(/github.com\/org\/repo/), {
      target: { value: 'first' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add repo' }));
    fireEvent.change(screen.getAllByPlaceholderText(/github.com\/org\/repo/)[1] as HTMLElement, {
      target: { value: 'second' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add repo' }));
    fireEvent.change(screen.getAllByPlaceholderText(/github.com\/org\/repo/)[2] as HTMLElement, {
      target: { value: 'third' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove repo' })[1] as HTMLElement);

    const remaining = screen.getAllByPlaceholderText(/github.com\/org\/repo/) as HTMLInputElement[];
    expect(remaining.map((i) => i.value)).toEqual(['first', 'third']);
  });

  it('styles the repo row inputs by their role in the row', async () => {
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));

    const uri = screen.getByPlaceholderText(/github.com\/org\/repo/);
    expect(uri.className).toContain('flex-1');
    expect(uri.className).toContain('focus:ring-2');
    expect(screen.getByPlaceholderText('SHA (optional)').className).toContain('w-32');
    expect(screen.getByPlaceholderText('Local path (optional)').className).toContain('w-40');
  });

  it('posts only the workspace name when no repo row is filled in', async () => {
    let body: unknown = null;
    const repoPosts: unknown[] = [];
    server.use(
      http.post('/api/workspaces', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ workspace: { ...monorepo, id: 'ws_new' } });
      }),
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        repoPosts.push(await request.json());
        return HttpResponse.json({ repo: {} });
      }),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => expect(body).not.toBeNull());
    await waitFor(() => expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull());
    expect(body).toEqual({ name: 'Saleor' });
    expect(repoPosts).toEqual([]);
  });

  it('posts each filled repo with every field it has, and skips blank uris', async () => {
    let body: unknown = null;
    const repoPosts: unknown[] = [];
    server.use(
      http.post('/api/workspaces', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ workspace: { ...monorepo, id: 'ws_new' } });
      }),
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        repoPosts.push(await request.json());
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
    fireEvent.click(screen.getByRole('button', { name: '+ Add repo' }));
    const uris = screen.getAllByPlaceholderText(/github.com\/org\/repo/);
    fireEvent.change(uris[0] as HTMLElement, { target: { value: '   ' } });
    fireEvent.change(uris[1] as HTMLElement, { target: { value: './local' } });
    fireEvent.change(screen.getAllByPlaceholderText('SHA (optional)')[1] as HTMLElement, {
      target: { value: 'abc1234' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Local path (optional)')[1] as HTMLElement, {
      target: { value: '/work/local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    // El formulario se cierra cuando el hook resuelve, es decir, tras todos los POST de repos.
    await waitFor(() => expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull());
    expect(body).toEqual({
      name: 'Saleor',
      description: 'Commerce',
      lainUrl: 'http://localhost:9999/mcp',
    });
    expect(repoPosts).toEqual([{ uri: './local', sha: 'abc1234', local: '/work/local' }]);
  });

  it('posts a row with only a uri as just that uri, with no empty optional fields', async () => {
    let body: unknown = null;
    const repoPosts: unknown[] = [];
    server.use(
      http.post('/api/workspaces', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ workspace: { ...monorepo, id: 'ws_new' } });
      }),
      http.post('/api/workspaces/:id/repos', async ({ request }) => {
        repoPosts.push(await request.json());
        return HttpResponse.json({ repo: {} });
      }),
    );
    renderPage();
    await screen.findByText(/No workspaces yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New Workspace' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace name (e.g. Saleor)'), {
      target: { value: 'Saleor' },
    });
    fireEvent.change(screen.getByPlaceholderText(/github.com\/org\/repo/), {
      target: { value: 'https://github.com/acme/saleor.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => expect(screen.queryByText('New Workspace', { selector: 'h2' })).toBeNull());
    expect(body).toEqual({ name: 'Saleor' });
    expect(repoPosts).toEqual([{ uri: 'https://github.com/acme/saleor.git' }]);
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
