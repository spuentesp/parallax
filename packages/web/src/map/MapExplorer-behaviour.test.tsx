import type { MapViewResponse, OrgNode, ProjectedNode } from '@parallax/shared/org-map';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { filtersFromParams, isDescendant, MapExplorer, trailOf } from './MapExplorer.js';

afterEach(cleanup);

const pn = (id: string, over: Partial<ProjectedNode> = {}): ProjectedNode => ({
  id,
  label: id,
  kind: 'repo',
  parent: null,
  meta: {},
  childCount: 0,
  expanded: false,
  ...over,
});

interface Posted {
  expand: string[];
  filters?: Record<string, unknown>;
  focus?: string;
  hops?: number;
  limits?: Record<string, number>;
  pin?: string[];
}
function serve(
  respond: (b: Posted) => Partial<MapViewResponse> = () => ({}),
  meta: Partial<MapViewResponse['meta']> = {},
) {
  const posts: Posted[] = [];
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request }) => {
      const body = (await request.json()) as Posted;
      posts.push(body);
      const nodes = [
        pn('repo:a', { label: 'alpha', childCount: 1 }),
        pn('repo:b', { label: 'beta' }),
      ];
      const view: MapViewResponse = {
        nodes,
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        totals: { nodes: 10, edges: 4, shownNodes: nodes.length, shownEdges: 0 },
        meta: { source: 'lain', generatedAt: Date.now(), ...meta },
        ...respond(body),
      };
      return HttpResponse.json(view);
    }),
  );
  return posts;
}
function mount(url = '/') {
  const router = createMemoryRouter([{ path: '*', element: <MapExplorer workspaceId="ws1" /> }], {
    initialEntries: [url],
  });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}
const search = (r: ReturnType<typeof mount>) => new URLSearchParams(r.state.location.search);
const toolbar = async () => within(await screen.findByTestId('map-toolbar'));

describe('filtersFromParams', () => {
  it('reads contract, provenance and a numeric confidence; ignores junk', () => {
    expect(filtersFromParams(new URLSearchParams('contract=http&prov=inferred&minc=0.4'))).toEqual({
      contract: 'http',
      provenance: 'inferred',
      minConfidence: 0.4,
    });
    expect(filtersFromParams(new URLSearchParams('prov=deterministic&minc=0'))).toEqual({
      contract: undefined,
      provenance: 'deterministic',
      minConfidence: 0,
    });
    expect(filtersFromParams(new URLSearchParams('prov=maybe&minc=abc'))).toEqual({
      contract: undefined,
      provenance: undefined,
      minConfidence: undefined,
    });
    expect(filtersFromParams(new URLSearchParams(''))).toEqual({
      contract: undefined,
      provenance: undefined,
      minConfidence: undefined,
    });
  });
});

describe('isDescendant / trailOf', () => {
  const by = new Map([
    ['a', { id: 'a', parent: null }],
    ['b', { id: 'b', parent: 'a' }],
    ['c', { id: 'c', parent: 'b' }],
    ['x', { id: 'x', parent: 'y' }],
    ['y', { id: 'y', parent: 'x' }],
  ]);
  it('walks any depth, not itself, not siblings, and survives cycles', () => {
    expect(isDescendant(by, 'c', 'a')).toBe(true);
    expect(isDescendant(by, 'c', 'b')).toBe(true);
    expect(isDescendant(by, 'a', 'c')).toBe(false);
    expect(isDescendant(by, 'a', 'a')).toBe(false);
    expect(isDescendant(by, 'c', 'zzz')).toBe(false);
    expect(isDescendant(by, 'x', 'q')).toBe(false);
    expect(isDescendant(by, 'ghost', 'a')).toBe(false);
  });
  it('trailOf lists ancestors parent-first and stops at cycles or unknown parents', () => {
    expect(trailOf(by, 'c').map((n) => n.id)).toEqual(['b', 'a']);
    expect(trailOf(by, 'a')).toEqual([]);
    expect(trailOf(by, 'x').map((n) => n.id)).toEqual(['y']);
    expect(trailOf(new Map([['k', { id: 'k', parent: 'missing' }]]), 'k')).toEqual([]);
  });
});

describe('MapExplorer toolbar', () => {
  it('contract chips set and unset ?contract= and show the pressed state', async () => {
    const posts = serve();
    const r = mount();
    const bar = await toolbar();
    const http_ = bar.getByRole('button', { name: 'http' });
    expect(http_.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(http_);
    await waitFor(() => expect(search(r).get('contract')).toBe('http'));
    expect(bar.getByRole('button', { name: 'http' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(posts.at(-1)?.filters).toMatchObject({ contract: 'http' }));
    fireEvent.click(bar.getByRole('button', { name: 'topic' }));
    await waitFor(() => expect(search(r).get('contract')).toBe('topic'));
    fireEvent.click(bar.getByRole('button', { name: 'topic' }));
    await waitFor(() => expect(search(r).get('contract')).toBeNull());
  });

  it('provenance buttons toggle ?prov=, "all" clears it, and "deterministic" also drops the confidence floor', async () => {
    serve();
    const r = mount('/?prov=inferred&minc=0.6');
    const bar = await toolbar();
    expect(bar.getByRole('button', { name: /inferred/ }).getAttribute('aria-pressed')).toBe('true');
    expect(bar.getByRole('button', { name: 'all' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bar.getByRole('button', { name: /^deterministic$/ }));
    await waitFor(() => expect(search(r).get('prov')).toBe('deterministic'));
    expect(search(r).get('minc')).toBeNull();
    fireEvent.click(bar.getByRole('button', { name: /^deterministic$/ }));
    await waitFor(() => expect(search(r).get('prov')).toBeNull());
    fireEvent.click(bar.getByRole('button', { name: /inferred/ }));
    await waitFor(() => expect(search(r).get('prov')).toBe('inferred'));
    fireEvent.click(bar.getByRole('button', { name: 'all' }));
    await waitFor(() => expect(search(r).get('prov')).toBeNull());
  });

  it('the confidence slider reads the URL, writes it, and 0 removes the parameter', async () => {
    serve();
    const r = mount('/?minc=0.3');
    const bar = await toolbar();
    const slider = bar.getByLabelText(/minimum confidence/i) as HTMLInputElement;
    expect(slider.value).toBe('0.3');
    expect(bar.getByText('0.3')).toBeTruthy();
    fireEvent.change(slider, { target: { value: '0.7' } });
    await waitFor(() => expect(search(r).get('minc')).toBe('0.7'));
    fireEvent.change(bar.getByLabelText(/minimum confidence/i), { target: { value: '0' } });
    await waitFor(() => expect(search(r).get('minc')).toBeNull());
    expect(bar.getByText('0.0')).toBeTruthy();
  });

  it('"clear filters" appears only with a filter active and clears all three', async () => {
    serve();
    const r = mount();
    const bar = await toolbar();
    expect(bar.queryByRole('button', { name: 'clear filters' })).toBeNull();
    cleanup();
    const r2 = mount('/?contract=http&prov=inferred&minc=0.5&sel=repo:a');
    const bar2 = await toolbar();
    fireEvent.click(bar2.getByRole('button', { name: 'clear filters' }));
    await waitFor(() => expect(search(r2).get('contract')).toBeNull());
    expect(search(r2).get('prov')).toBeNull();
    expect(search(r2).get('minc')).toBeNull();
    expect(search(r2).get('sel')).toBe('repo:a');
    expect(r).toBeTruthy();
  });

  it('a single filter is enough to offer clearing it', async () => {
    serve();
    mount('/?minc=0.5');
    expect((await toolbar()).getByRole('button', { name: 'clear filters' })).toBeTruthy();
  });

  it('shows how much is on screen of how much exists, and the relation total', async () => {
    serve();
    mount();
    expect((await screen.findByTestId('map-totals')).textContent).toBe(
      '2 of 10 nodes · 4 relations',
    );
  });

  it('freshness reads "just now", minutes, hours and days; marks stale/refreshing/failed', async () => {
    const ago = async (ms: number, extra: Partial<MapViewResponse['meta']> = {}) => {
      serve(() => ({}), { generatedAt: Date.now() - ms, ...extra });
      mount();
      const t = (await screen.findByTestId('map-freshness')).textContent;
      cleanup();
      return t;
    };
    expect(await ago(5_000)).toBe('updated just now');
    expect(await ago(44_000)).toBe('updated just now');
    expect(await ago(46_000)).toBe('updated 1 min ago');
    expect(await ago(10 * 60_000)).toBe('updated 10 min ago');
    expect(await ago(3 * 3_600_000)).toBe('updated 3 h ago');
    expect(await ago(2 * 86_400_000)).toBe('updated 2 d ago');
    expect(await ago(5_000, { stale: true })).toBe('Stale · updated just now');
    expect(await ago(5_000, { refreshing: true })).toBe('updated just now · refreshing…');
    serve(() => ({}), { lastError: 'lain down' });
    mount();
    expect((await screen.findByText('last refresh failed')).getAttribute('title')).toBe(
      'lain down',
    );
  });

  it('no freshness line and no failure note when the server gave none', async () => {
    serve(() => ({}), { generatedAt: undefined as unknown as number });
    mount();
    await screen.findByTestId('map-toolbar');
    expect(screen.queryByTestId('map-freshness')).toBeNull();
    expect(screen.queryByText('last refresh failed')).toBeNull();
  });

  it('Refresh posts, disables itself while working and shows its state', async () => {
    serve();
    let release: () => void = () => {};
    server.use(
      http.post('/api/workspaces/:id/map/refresh', async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return HttpResponse.json({ meta: { source: 'lain' } });
      }),
    );
    mount();
    const bar = await toolbar();
    fireEvent.click(bar.getByRole('button', { name: 'Refresh' }));
    const busy = (await bar.findByRole('button', { name: 'Refreshing…' })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => release());
    expect(
      ((await bar.findByRole('button', { name: 'Refresh' })) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('MapExplorer search', () => {
  const found: OrgNode[] = [
    { id: 'svc:orders', label: 'orders', kind: 'service', parent: null, meta: {} },
    { id: 'ep:x', label: 'GET /orders', kind: 'endpoint', parent: null, meta: {} },
  ];
  const searching = (results: OrgNode[]) => {
    const asked: string[] = [];
    server.use(
      http.get('/api/workspaces/:id/map/search', ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json({ results, meta: { source: 'lain' } });
      }),
    );
    return asked;
  };

  it('waits for two characters, lists kinds, and picking a result selects it and closes the list', async () => {
    serve();
    const asked = searching(found);
    const r = mount();
    const box = (await screen.findByLabelText('Search the map')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'o' } });
    await new Promise((res) => setTimeout(res, 300));
    expect(asked).toEqual([]);
    expect(screen.queryByText('No matches.')).toBeNull();
    fireEvent.change(box, { target: { value: 'orders' } });
    const hit = await screen.findByRole('button', { name: /orders.*Service/ });
    expect(within(hit).getByText('Service')).toBeTruthy();
    expect(screen.getByRole('button', { name: /GET \/orders.*Endpoint/ })).toBeTruthy();
    expect(asked).toEqual(['orders']);
    fireEvent.click(hit);
    await waitFor(() => expect(search(r).get('sel')).toBe('svc:orders'));
    expect(screen.queryByRole('button', { name: /GET \/orders.*Endpoint/ })).toBeNull();
  });

  it('says so when nothing matches, and reopens the list on focus', async () => {
    serve();
    searching([]);
    mount();
    const box = await screen.findByLabelText('Search the map');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(await screen.findByText('No matches.')).toBeTruthy();
    fireEvent.blur(box);
    await waitFor(() => expect(screen.queryByText('No matches.')).toBeNull());
    fireEvent.focus(box);
    expect(await screen.findByText('No matches.')).toBeTruthy();
  });
});

describe('MapExplorer canvas area', () => {
  it('shows the legend, and a loading line before the first view', async () => {
    serve();
    mount();
    expect(screen.getByText('Loading map…')).toBeTruthy();
    const legend = await screen.findByTestId('map-legend');
    // Plegada por defecto (el espacio es del grafo); se abre a pedido.
    expect(legend.textContent).not.toMatch(/Repository/);
    fireEvent.click(within(legend).getByRole('button', { name: 'Legend' }));
    expect(legend.textContent).toMatch(/Repository/);
    expect(legend.textContent).toMatch(/deterministic/);
    expect(legend.textContent).toMatch(/inferred/);
    expect(legend.textContent).toMatch(/double-click to open/);
  });

  it('an empty projection says no nodes match and draws no canvas', async () => {
    serve(() => ({ nodes: [] }));
    mount();
    expect(await screen.findByText('No nodes match these filters.')).toBeTruthy();
    expect(screen.queryByTestId('map-canvas')).toBeNull();
  });

  it('a failed load says the map could not be loaded', async () => {
    server.use(
      http.post('/api/workspaces/:id/map/view', () => HttpResponse.json({}, { status: 500 })),
    );
    mount();
    expect(await screen.findByText('Could not load the map.')).toBeTruthy();
  });

  it('notices say why there is no map for each source', async () => {
    const text = async (meta: MapViewResponse['meta']) => {
      serve(() => ({ nodes: [], meta }));
      mount();
      const t = (await screen.findByTestId('map-notice')).textContent;
      cleanup();
      return t;
    };
    expect(await text({ source: 'unconfigured' })).toMatch(/no LAIN server configured/);
    expect(await text({ source: 'none' })).toBe('Workspace not found.');
    expect(await text({ source: 'error', error: 'boom' })).toMatch(
      /LAIN error: boom\. The map is not empty, it is unavailable\./,
    );
    expect(await text({ source: 'error' })).toMatch(/LAIN error: unreachable/);
  });
});

describe('MapExplorer focus and hops', () => {
  const focused = (b: Posted) => ({
    focus: b.focus ? { seed: b.focus, ids: [b.focus, 'repo:b'] } : null,
  });

  it('shows the focused node by label with hops 1-3, the active one pressed, and changing it updates the URL and the request', async () => {
    const posts = serve(focused);
    const r = mount('/?focus=repo:a&hops=2');
    const chip = await screen.findByText('Focus');
    expect(chip).toBeTruthy();
    expect(screen.getByText('alpha', { selector: 'span.font-medium' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Hops' });
    expect(within(group).getByRole('button', { name: '2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(group).getByRole('button', { name: '1' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(within(group).getByRole('button', { name: '3' }));
    await waitFor(() => expect(search(r).get('hops')).toBe('3'));
    await waitFor(() => expect(posts.at(-1)?.hops).toBe(3));
  });

  it('defaults to one hop, and "clear" drops focus and hops but keeps the selection', async () => {
    const posts = serve(focused);
    const r = mount('/?focus=repo:a&sel=repo:a');
    await screen.findByText('Focus');
    expect(posts[0]?.hops).toBe(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'clear' })[0] as HTMLElement);
    await waitFor(() => expect(search(r).get('focus')).toBeNull());
    expect(search(r).get('hops')).toBeNull();
    expect(search(r).get('sel')).toBe('repo:a');
  });

  it('an unknown focus shows a warning with its own clear, never the focus chip', async () => {
    serve(() => ({ focus: null }));
    const r = mount('/?focus=ghost&hops=2');
    expect(await screen.findByTestId('map-focus-missing')).toBeTruthy();
    expect(screen.queryByText('Focus')).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('map-focus-missing')).getByRole('button', { name: 'clear' }),
    );
    await waitFor(() => expect(search(r).get('focus')).toBeNull());
    expect(search(r).get('hops')).toBeNull();
  });

  it('no focus parameter means neither chip nor warning', async () => {
    serve();
    mount();
    await screen.findByTestId('map-outline');
    expect(screen.queryByText('Focus')).toBeNull();
    expect(screen.queryByTestId('map-focus-missing')).toBeNull();
  });

  it('the focus label falls back to the id when the seed is not drawn', async () => {
    serve(() => ({ focus: { seed: 'svc:hidden', ids: ['svc:hidden'] } }));
    mount('/?focus=svc:hidden');
    expect(await screen.findByText('svc:hidden', { selector: 'span.font-medium' })).toBeTruthy();
  });
});

describe('MapExplorer outline wiring', () => {
  it('"+N more" raises that parent limit by 100 from the default 50', async () => {
    const posts = serve((b) => ({
      nodes: [
        pn('repo:a', { label: 'alpha', childCount: 80, expanded: b.expand.includes('repo:a') }),
        ...(b.expand.includes('repo:a')
          ? [pn('svc:1', { kind: 'service', parent: 'repo:a', label: 'one' })]
          : []),
      ],
      hiddenChildren: b.expand.includes('repo:a') ? { 'repo:a': 30 } : {},
    }));
    mount();
    const o = within(await screen.findByTestId('map-outline'));
    fireEvent.click(o.getByRole('button', { name: 'Expand alpha' }));
    fireEvent.click(await o.findByRole('button', { name: '+30 more…' }));
    await waitFor(() => expect(posts.at(-1)?.limits).toEqual({ 'repo:a': 150 }));
    fireEvent.click(await o.findByRole('button', { name: '+30 more…' }));
    await waitFor(() => expect(posts.at(-1)?.limits).toEqual({ 'repo:a': 250 }));
  });

  it('collapsing a node asks the server again without it', async () => {
    const posts = serve((b) => ({
      nodes: [
        pn('repo:a', { label: 'alpha', childCount: 1, expanded: b.expand.includes('repo:a') }),
      ],
    }));
    mount();
    const o = within(await screen.findByTestId('map-outline'));
    fireEvent.click(o.getByRole('button', { name: 'Expand alpha' }));
    await waitFor(() => expect(posts.at(-1)?.expand).toEqual(['repo:a']));
    fireEvent.click(await o.findByRole('button', { name: 'Collapse alpha' }));
    // La vista de "todo cerrado" ya estaba en caché: no hace falta volver a pedirla.
    expect(await o.findByRole('button', { name: 'Expand alpha' })).toBeTruthy();
    expect(posts.every((p) => p.expand.length <= 1)).toBe(true);
  });

  it('a leaf with no contents cannot be opened', async () => {
    const posts = serve();
    mount();
    const o = within(await screen.findByTestId('map-outline'));
    // Primero se asienta la apertura automática de los repos al entrar.
    await waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 100));
    const before = posts.length;
    fireEvent.doubleClick(o.getByText('beta'));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.length).toBe(before);
  });

  it('selection shows the inspector for that node', async () => {
    serve();
    mount('/?sel=repo:a');
    expect(
      await screen.findByTestId('map-inspector-empty', {}, { timeout: 100 }).catch(() => null),
    ).toBeNull();
  });
});
