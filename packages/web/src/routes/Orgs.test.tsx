import { cleanup, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { Orgs } from './Orgs.js';

afterEach(cleanup);

const ws = (id: string, name: string) => ({
  id,
  name,
  description: null,
  lainUrl: null,
  repos: [],
  repoCount: 0,
});
const renderIt = () =>
  renderWithQuery(
    <MemoryRouter>
      <Orgs />
    </MemoryRouter>,
  );

describe('Orgs picker', () => {
  it('lists orgs and workspaces once each, linking to the map', async () => {
    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ orgs: [{ id: 'acme', name: 'Acme Corp' }] })),
      http.get('/api/workspaces', () =>
        HttpResponse.json({ workspaces: [ws('acme', 'Acme (workspace)'), ws('ws_2', 'Platform')] }),
      ),
    );
    renderIt();
    const acme = (await screen.findByText('Acme Corp')).closest('a') as HTMLElement;
    expect(acme.getAttribute('href')).toBe('/orgs/acme');
    expect(within(acme).getByText('acme')).toBeTruthy();
    const platform = (await screen.findByText('Platform')).closest('a') as HTMLElement;
    expect(platform.getAttribute('href')).toBe('/orgs/ws_2');
    // El workspace con el mismo id que un org no se repite.
    expect(screen.queryByText('Acme (workspace)')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByText(/no organizations yet/i)).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('explains itself and shows loading while the lists load', async () => {
    server.use(
      http.get('/api/orgs', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ orgs: [] });
      }),
    );
    renderIt();
    expect(screen.getByRole('heading', { name: 'Organizations' })).toBeTruthy();
    expect(screen.getByText(/open its architecture map/i)).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText(/no organizations yet/i)).toBeNull();
    expect(await screen.findByText(/no organizations yet/i)).toBeTruthy();
  });

  it('with nothing configured, points to workspace setup', async () => {
    server.use(http.get('/api/orgs', () => HttpResponse.json({ orgs: [] })));
    renderIt();
    const cta = await screen.findByRole('link', { name: /configure a workspace/i });
    expect(cta.getAttribute('href')).toBe('/workspaces');
  });

  it('reports failure only when BOTH sources fail; one failing still shows the other', async () => {
    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ code: 'x' }, { status: 500 })),
      http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [ws('w1', 'Solo')] })),
    );
    renderIt();
    expect(await screen.findByText('Solo')).toBeTruthy();
    expect(screen.queryByText(/could not load/i)).toBeNull();
    cleanup();

    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ code: 'x' }, { status: 500 })),
      http.get('/api/workspaces', () => HttpResponse.json({ code: 'x' }, { status: 500 })),
    );
    renderIt();
    expect(await screen.findByText(/could not load the list of organizations/i)).toBeTruthy();
    expect(screen.queryByText(/no organizations yet/i)).toBeNull();
  });
});
