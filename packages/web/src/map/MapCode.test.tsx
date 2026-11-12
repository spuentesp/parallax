// La capa de código del mapa: dentro de un repo abierto, "Code" → archivos →
// símbolos, pedidos a LAIN al abrir cada nodo. La red (MSW) hace de LAIN; el
// cliente, los hooks y la fusión son los reales.

import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapExplorer } from './MapExplorer.js';

afterEach(cleanup);

const repo = (id: string, lainRepoId: string | null): ProjectedNode => ({
  id: `repo:${id}`,
  label: id,
  kind: 'repo',
  parent: null,
  meta: { lainRepoId },
  childCount: 0,
  expanded: false,
});

function serveMap(repos: ProjectedNode[]) {
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request }) => {
      const body = (await request.json()) as { expand: string[] };
      const open = new Set(body.expand);
      const view: MapViewResponse = {
        nodes: repos.map((r) => ({ ...r, expanded: open.has(r.id) })),
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        meta: { source: 'lain', generatedAt: Date.now() },
      };
      return HttpResponse.json(view);
    }),
    http.get('/api/workspaces/:id/map/node', ({ request }) =>
      HttpResponse.json({
        detail: {
          node: repos.find((r) => r.id === new URL(request.url).searchParams.get('id')),
          path: [],
          children: [],
          consumers: [],
          providers: [],
        },
        meta: { source: 'lain' },
      }),
    ),
  );
}

const node = (name: string, type: string) => ({ id: `${type}-${name}`, name, type, kind: 'other' });

interface Calls {
  root: string[];
  children: Array<{ repo: string; type: string; name: string }>;
  snippet: Array<Record<string, string>>;
}
function serveLain(opts: { rootError?: string } = {}): Calls {
  const calls: Calls = { root: [], children: [], snippet: [] };
  server.use(
    http.get('/api/workspaces/:id/graph', ({ request }) => {
      const repoParam = new URL(request.url).searchParams.get('repo') ?? '';
      calls.root.push(repoParam);
      if (opts.rootError) {
        return HttpResponse.json({
          graph: {
            repos: [{ repo: repoParam, nodes: [], truncated: false, error: opts.rootError }],
          },
          source: 'lain',
        });
      }
      return HttpResponse.json({
        graph: {
          repos: [
            {
              repo: repoParam,
              nodes: [node('main.rs', 'File'), node('POST /api/orders', 'HttpRoute')],
              truncated: false,
            },
          ],
        },
        source: 'lain',
      });
    }),
    http.get('/api/workspaces/:id/graph/children', ({ request }) => {
      const q = new URL(request.url).searchParams;
      calls.children.push({
        repo: q.get('repo') ?? '',
        type: q.get('type') ?? '',
        name: q.get('name') ?? '',
      });
      return HttpResponse.json({
        children: [node('create_order', 'Function')],
        childrenTruncated: false,
        communications: [
          { edge: 'Uses', nodes: [node('CreateOrder', 'Struct')] },
          { edge: 'CallsHttp', nodes: [node('POST /api/orders', 'HttpRoute')] },
        ],
        hasCommunication: true,
        source: 'lain',
      });
    }),
    http.get('/api/workspaces/:id/graph/snippet', ({ request }) => {
      calls.snippet.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json({
        snippet: {
          symbol: 'create_order',
          repo: 'orders',
          path: 'src/orders.rs',
          text: 'fn create_order() {}',
        },
        source: 'lain',
      });
    }),
  );
  return calls;
}

function renderExplorer(url = '/') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <MapExplorer workspaceId="ws1" />
    </MemoryRouter>,
  );
}

const outline = async () => within(await screen.findByTestId('map-outline'));

describe('MapExplorer — code layer', () => {
  it('opens a repo, then Code, then a file: each level is asked of LAIN only when opened', async () => {
    serveMap([repo('orders', 'orders')]);
    const calls = serveLain();
    renderExplorer();

    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    const code = await o.findByText('Code');
    expect(calls.root).toEqual([]);

    fireEvent.click(o.getByRole('button', { name: 'Expand Code' }));
    expect(await o.findByText('main.rs')).toBeTruthy();
    expect(calls.root).toEqual(['orders']);
    // Una ruta no contiene nada: no ofrece abrirse.
    expect(
      o.getByText('POST /api/orders').closest('[role=treeitem]')?.hasAttribute('aria-expanded'),
    ).toBe(false);
    expect(calls.children).toEqual([]);

    fireEvent.click(o.getByRole('button', { name: 'Expand main.rs' }));
    expect(await o.findByText('create_order')).toBeTruthy();
    expect(calls.children).toEqual([{ repo: 'orders', type: 'File', name: 'main.rs' }]);
    expect(code).toBeTruthy();
  });

  it('does not ask twice for what it already has', async () => {
    serveMap([repo('orders', 'orders')]);
    const calls = serveLain();
    renderExplorer();
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand Code' }));
    await o.findByText('main.rs');
    fireEvent.click(o.getByRole('button', { name: 'Collapse Code' }));
    fireEvent.click(o.getByRole('button', { name: 'Expand Code' }));
    await o.findByText('main.rs');
    expect(calls.root).toHaveLength(1);
  });

  it("lists a selected symbol's relationships by edge type, without inventing a direction", async () => {
    serveMap([repo('orders', 'orders')]);
    serveLain();
    renderExplorer();
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand Code' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand main.rs' }));
    fireEvent.click(await o.findByText('create_order'));

    const relations = await screen.findByTestId('code-relations');
    expect(within(relations).getByText('Uses')).toBeTruthy();
    expect(within(relations).getByText('CreateOrder')).toBeTruthy();
    expect(within(relations).getByText('CallsHttp')).toBeTruthy();
    expect(relations.textContent).toMatch(/does not report direction/i);
  });

  it('opens the source of a symbol on demand, never before', async () => {
    serveMap([repo('orders', 'orders')]);
    const calls = serveLain();
    renderExplorer();
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand Code' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand main.rs' }));
    fireEvent.click(await o.findByText('create_order'));

    const inspector = await screen.findByTestId('code-inspector');
    expect(calls.snippet).toEqual([]);
    fireEvent.click(within(inspector).getByRole('button', { name: 'View source' }));
    expect((await screen.findByTestId('source-peek')).textContent).toBe('fn create_order() {}');
    expect(calls.snippet).toEqual([{ repo: 'orders', symbol: 'create_order' }]);
  });

  it('opens a file by path, not as a symbol', async () => {
    serveMap([repo('orders', 'orders')]);
    const calls = serveLain();
    renderExplorer();
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand Code' }));
    fireEvent.click(await o.findByText('main.rs'));
    fireEvent.click(await screen.findByRole('button', { name: 'View source' }));
    await waitFor(() => expect(calls.snippet).toEqual([{ repo: 'orders', path: 'main.rs' }]));
  });

  it('says a LAIN failure on the Code node instead of showing an empty listing', async () => {
    serveMap([repo('orders', 'orders')]);
    serveLain({ rootError: 'query_graph timed out' });
    renderExplorer();
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand orders' }));
    fireEvent.click(await o.findByRole('button', { name: 'Expand Code' }));
    const failed = await o.findByText('failed');
    expect(failed.getAttribute('title')).toBe('query_graph timed out');
  });

  it('does not offer code for a repo it could not link to the engine, and says why', async () => {
    serveMap([repo('analytics', null)]);
    renderExplorer('/?sel=repo:analytics');
    const o = await outline();
    fireEvent.click(o.getByRole('button', { name: 'Expand analytics' }));
    // Sin hijos que abrir ni "Code": el botón de abrir no existe para el repo.
    expect(o.queryByText('Code')).toBeNull();
    expect((await screen.findByTestId('repo-no-code')).textContent).toMatch(/nothing is guessed/i);
  });

  it('explains a deep link to code that has not been loaded yet', async () => {
    serveMap([repo('orders', 'orders')]);
    renderExplorer('/?sel=sym:orders|Function|create_order');
    expect((await screen.findByTestId('code-inspector-missing')).textContent).toMatch(
      /open the repository/i,
    );
  });
});
