import type { NodeDetail, NodeRelation, OrgEdge, OrgNode } from '@parallax/shared/org-map';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapInspector } from './MapInspector.js';

afterEach(cleanup);

const on = (id: string, kind: OrgNode['kind'], over: Partial<OrgNode> = {}): OrgNode => ({
  id,
  label: id,
  kind,
  parent: null,
  meta: {},
  ...over,
});
const edge = (over: Partial<OrgEdge> = {}): OrgEdge => ({
  id: 'e',
  source: 'a',
  target: 'b',
  kind: 'consumes',
  provenance: 'deterministic',
  confidence: 1,
  count: 1,
  deterministicCount: 1,
  inferredCount: 0,
  ...over,
});
const rel = (peer: OrgNode, e: Partial<OrgEdge> = {}): NodeRelation => ({
  peer,
  edge: edge(e),
  links: [],
  hiddenLinks: 0,
});

function detail(over: Partial<NodeDetail> = {}): NodeDetail {
  return {
    node: on('svc:orders', 'service', { label: 'orders' }),
    path: [on('repo:orders', 'repo', { label: 'orders-repo', meta: { lainRepoId: 'orders' } })],
    children: [],
    consumers: [],
    providers: [],
    ...over,
  };
}

function setup(
  d: NodeDetail | null | 'missing' | 'broken',
  props: Partial<Parameters<typeof MapInspector>[0]> = {},
) {
  server.use(
    http.get('/api/workspaces/:id/map/node', () => {
      if (d === 'missing') return HttpResponse.json({ code: 'NodeNotFound' }, { status: 404 });
      if (d === 'broken') return HttpResponse.json({}, { status: 500 });
      return HttpResponse.json({ detail: d, meta: { source: 'lain' } });
    }),
  );
  const h = { onSelect: vi.fn(), onFocus: vi.fn(), onToggle: vi.fn(), onClearFocus: vi.fn() };
  renderWithQuery(
    <MapInspector workspaceId="ws1" nodeId="svc:orders" focusing={false} {...h} {...props} />,
  );
  return h;
}

describe('MapInspector states', () => {
  it('invites a selection when there is none', () => {
    setup(detail(), { nodeId: null });
    expect(screen.getByTestId('map-inspector-empty').textContent).toMatch(/select a node/i);
  });
  it('says loading, then missing (404), then failure — three different messages', async () => {
    setup(detail());
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    setup('missing', { nodeId: 'svc:gone' });
    expect((await screen.findByTestId('map-inspector-missing')).textContent).toMatch(/svc:gone/);
    cleanup();
    setup('broken');
    expect(await screen.findByText('Could not load this node.')).toBeTruthy();
    expect(screen.queryByTestId('map-inspector-missing')).toBeNull();
    cleanup();
    setup(null);
    expect(await screen.findByText(/not in the current graph/i)).toBeTruthy();
  });
});

describe('MapInspector detail', () => {
  it('shows kind, contract chip, a monospaced endpoint title, and a clickable breadcrumb from the root', async () => {
    const d = detail({
      node: on('ep:x', 'endpoint', { label: 'http:GET /x', contract: 'http' }),
      path: [
        on('svc:orders', 'service', { label: 'orders' }),
        on('repo:orders', 'repo', { label: 'orders-repo' }),
      ],
    });
    const h = setup(d, { nodeId: 'ep:x' });
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText('Endpoint')).toBeTruthy();
    expect(view.getByText('http')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'http:GET /x' }).className).toMatch(/font-mono/);
    const crumbs = view
      .getAllByRole('button')
      .filter((b) => ['orders', 'orders-repo'].includes(b.textContent ?? ''));
    expect(crumbs.map((b) => b.textContent)).toEqual(['orders-repo', 'orders']);
    fireEvent.click(view.getByRole('button', { name: 'orders-repo' }));
    expect(h.onSelect).toHaveBeenCalledWith('repo:orders');
  });

  it('non-endpoint titles are not monospaced, and a node with no ancestors has no breadcrumb', async () => {
    setup(detail({ path: [] }));
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByRole('heading', { name: 'orders' }).className).not.toMatch(/font-mono/);
    expect(view.queryByRole('button', { name: 'orders-repo' })).toBeNull();
  });

  it('actions: focus always; clear focus only while focusing; open/close only with contents', async () => {
    const h = setup(detail({ children: [on('ep:1', 'endpoint'), on('ep:2', 'endpoint')] }), {
      focusing: true,
    });
    const view = within(await screen.findByTestId('map-inspector'));
    fireEvent.click(view.getByRole('button', { name: 'Focus neighborhood' }));
    expect(h.onFocus).toHaveBeenCalledWith('svc:orders');
    fireEvent.click(view.getByRole('button', { name: 'Clear focus' }));
    expect(h.onClearFocus).toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '2 inside · open / close' }));
    expect(h.onToggle).toHaveBeenCalledWith('svc:orders');
    cleanup();
    setup(detail());
    const plain = within(await screen.findByTestId('map-inspector'));
    expect(plain.queryByRole('button', { name: 'Clear focus' })).toBeNull();
    expect(plain.queryByRole('button', { name: /inside/ })).toBeNull();
  });

  it('summarises consumers (singular/plural, repos) and lists them deterministic-first, then by count, then label', async () => {
    const a = on('svc:a', 'service', { label: 'alpha', parent: 'repo:r1' });
    const b = on('svc:b', 'service', { label: 'beta', parent: 'repo:r2' });
    const c = on('svc:c', 'service', { label: 'gamma', parent: 'repo:r2' });
    setup(
      detail({
        consumers: [
          rel(c, {
            provenance: 'inferred',
            confidence: 0.4,
            count: 9,
            deterministicCount: 0,
            inferredCount: 9,
          }),
          rel(a, { count: 1 }),
          rel(b, { count: 5, inferredCount: 2, deterministicCount: 3 }),
        ],
      }),
    );
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText('3 services across 2 repos')).toBeTruthy();
    const names = view
      .getAllByRole('button')
      .map((x) => x.textContent ?? '')
      .filter((t) => /alpha|beta|gamma/.test(t));
    expect(names[0]).toMatch(/beta/);
    expect(names[1]).toMatch(/alpha/);
    expect(names[2]).toMatch(/gamma/);
    const text = (name: RegExp) =>
      view.getAllByRole('button').find((x) => name.test(x.textContent ?? ''))?.textContent ?? '';
    expect(text(/gamma/)).toMatch(/inferred · 40%/);
    expect(text(/gamma/)).toMatch(/×9/);
    expect(text(/beta/)).toMatch(/deterministic · \+2 inferred/);
    expect(text(/alpha/)).toMatch(/×1/);
    expect(text(/alpha/)).toMatch(/deterministic$/);
    // El repo del par se muestra sin el prefijo repo:.
    expect(text(/alpha/)).toMatch(/r1/);
    expect(text(/alpha/)).not.toMatch(/repo:r1/);
  });

  it('singular summary and selecting a peer', async () => {
    const a = on('svc:a', 'service', { label: 'alpha', parent: 'repo:r1' });
    const h = setup(detail({ consumers: [rel(a)] }));
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText('1 service across 1 repo')).toBeTruthy();
    fireEvent.click(view.getByText('alpha'));
    expect(h.onSelect).toHaveBeenCalledWith('svc:a');
  });

  it('no consumers: an honest "not proof" note; no providers: its own note', async () => {
    setup(detail());
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText(/not proof there are none/i)).toBeTruthy();
    expect(view.getByText('No outgoing dependencies found.')).toBeTruthy();
    expect(view.queryByText(/services? across/)).toBeNull();
  });

  it('a repo with no relations shows neither relation section; one with relations shows both', async () => {
    setup(
      detail({
        node: on('repo:orders', 'repo', { label: 'orders', meta: { lainRepoId: 'orders' } }),
        path: [],
      }),
    );
    const bare = within(await screen.findByTestId('map-inspector'));
    expect(bare.queryByText('Consumed by')).toBeNull();
    expect(bare.queryByText('Depends on')).toBeNull();
    cleanup();
    const peer = on('svc:a', 'service', { label: 'alpha', parent: 'repo:r1' });
    setup(
      detail({
        node: on('repo:orders', 'repo', { label: 'orders', meta: { lainRepoId: 'orders' } }),
        path: [],
        providers: [rel(peer)],
      }),
    );
    const rich = within(await screen.findByTestId('map-inspector'));
    expect(rich.getByText('Consumed by')).toBeTruthy();
    expect(rich.getByText('Depends on')).toBeTruthy();
  });

  it('says a repo cannot be browsed only when it was explicitly not linked', async () => {
    setup(
      detail({ node: on('repo:x', 'repo', { label: 'x', meta: { lainRepoId: null } }), path: [] }),
    );
    expect(await screen.findByTestId('repo-no-code')).toBeTruthy();
    cleanup();
    setup(
      detail({ node: on('repo:x', 'repo', { label: 'x', meta: { lainRepoId: 'x' } }), path: [] }),
    );
    await screen.findByTestId('map-inspector');
    expect(screen.queryByTestId('repo-no-code')).toBeNull();
    cleanup();
    setup(detail({ node: on('repo:x', 'repo', { label: 'x', meta: {} }), path: [] }));
    await screen.findByTestId('map-inspector');
    expect(screen.queryByTestId('repo-no-code')).toBeNull();
  });

  const providersMeta = [
    { repo: 'orders', path: 'src/api.py', line: 10 },
    { path: 'src/other.py' },
  ];

  it('"Defined at" lists path and line, and offers source only when the repo is linked to LAIN', async () => {
    setup(
      detail({ node: on('ep:x', 'endpoint', { label: 'x', meta: { providers: providersMeta } }) }),
      { nodeId: 'ep:x' },
    );
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText('orders:src/api.py:10')).toBeTruthy();
    expect(view.getByText('src/other.py')).toBeTruthy();
    expect(view.getAllByRole('button', { name: 'View source' })).toHaveLength(2);
    expect(view.queryByText(/source unavailable/i)).toBeNull();
    cleanup();
    setup(
      detail({
        node: on('ep:x', 'endpoint', { label: 'x', meta: { providers: providersMeta } }),
        path: [on('repo:orders', 'repo', { meta: { lainRepoId: null } })],
      }),
      { nodeId: 'ep:x' },
    );
    const unlinked = within(await screen.findByTestId('map-inspector'));
    expect(unlinked.queryByRole('button', { name: 'View source' })).toBeNull();
    expect(unlinked.getByText(/source unavailable/i)).toBeTruthy();
  });

  it('a provider without a path gets no source button, and no providers means no section', async () => {
    setup(
      detail({
        node: on('ep:x', 'endpoint', { label: 'x', meta: { providers: [{ repo: 'orders' }] } }),
      }),
      { nodeId: 'ep:x' },
    );
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.getByText('Defined at')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'View source' })).toBeNull();
    cleanup();
    setup(detail());
    expect(within(await screen.findByTestId('map-inspector')).queryByText('Defined at')).toBeNull();
  });

  it('a repo node uses its own link to LAIN for source (not a missing ancestor)', async () => {
    setup(
      detail({
        node: on('repo:orders', 'repo', {
          label: 'orders',
          meta: { lainRepoId: 'orders', providers: [{ path: 'a.py' }] },
        }),
        path: [],
      }),
      { nodeId: 'repo:orders' },
    );
    expect(await screen.findByRole('button', { name: 'View source' })).toBeTruthy();
  });
});

describe('MapInspector — which endpoints sit behind a relation', () => {
  const dash = on('svc:dash', 'service', { label: 'dashboard', parent: 'repo:d' });
  const op = (id: string, label: string) =>
    on(id, 'endpoint', { label, parent: 'svc:orders', contract: 'graphql' });
  const link = (id: string, label: string, over = {}) => ({
    endpoint: op(id, label),
    provenance: 'deterministic' as const,
    confidence: 1,
    count: 3,
    fields: ['id', 'lines', 'total', 'email', 'note'],
    sites: [
      { repo: 'dashboard', path: 'src/checkout/Lines.tsx', line: 42 },
      { repo: 'dashboard', path: 'src/checkout/Other.tsx' },
    ],
    ...over,
  });
  const relWith = (links: ReturnType<typeof link>[], hidden = 0): NodeRelation => ({
    peer: dash,
    edge: edge({ count: 4 }),
    links,
    hiddenLinks: hidden,
  });

  it('is collapsed until asked, then names each endpoint with its fields, provenance and caller site', async () => {
    setup(
      detail({
        consumers: [
          relWith([
            link('ep:1', 'checkoutLinesUpdate'),
            link('ep:2', 'checkoutNote', { provenance: 'inferred', count: 1, fields: [] }),
          ]),
        ],
      }),
    );
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.queryByTestId('endpoint-links')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Show 2 endpoints' }));
    const list = within(view.getByTestId('endpoint-links'));
    expect(list.getByText('checkoutLinesUpdate')).toBeTruthy();
    expect(list.getByText('uses id, lines, total, email +1')).toBeTruthy();
    expect(list.getAllByText('dashboard:src/checkout/Lines.tsx:42 +1 more').length).toBe(2);
    expect(list.getByText('checkoutNote')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Hide 2 endpoints' }));
    expect(view.queryByTestId('endpoint-links')).toBeNull();
  });

  it('selecting an endpoint row opens that endpoint', async () => {
    const { onSelect } = setup(
      detail({ consumers: [relWith([link('ep:1', 'checkoutLinesUpdate')])] }),
    );
    const view = within(await screen.findByTestId('map-inspector'));
    fireEvent.click(view.getByRole('button', { name: 'Show 1 endpoint' }));
    fireEvent.click(view.getByText('checkoutLinesUpdate'));
    expect(onSelect).toHaveBeenLastCalledWith('ep:1');
  });

  it('declares endpoints the cap left out instead of hiding them', async () => {
    setup(detail({ consumers: [relWith([link('ep:1', 'a')], 41)] }));
    const view = within(await screen.findByTestId('map-inspector'));
    fireEvent.click(view.getByRole('button', { name: 'Show 42 endpoints' }));
    expect(view.getByText('+41 more endpoints not listed')).toBeTruthy();
  });

  it('offers nothing to expand when the relation has no endpoint detail', async () => {
    setup(detail({ consumers: [relWith([])] }));
    const view = within(await screen.findByTestId('map-inspector'));
    expect(view.queryByRole('button', { name: /endpoint/ })).toBeNull();
  });
});

describe('MapInspector — which code implements a GraphQL operation', () => {
  const repoNode = on('repo:saleor', 'repo', { label: 'saleor', meta: { lainRepoId: 'saleor' } });
  const op = (over: Partial<OrgNode> = {}) =>
    on('ep:g', 'endpoint', {
      label: 'graphql:mutation:checkoutShippingAddressUpdate',
      parent: 'svc:orders',
      contract: 'graphql',
      ...over,
    });
  const withPath = (node: OrgNode, repo: OrgNode | null = repoNode) =>
    detail({
      node,
      path: [on('svc:orders', 'service', { label: 'orders' }), ...(repo ? [repo] : [])],
    });
  const serveImpl = (body: object, seen: URLSearchParams[] = []) =>
    server.use(
      http.get('/api/workspaces/:id/map/implementation', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(body);
      }),
    );

  it('looks nothing up until asked; then shows file:line labelled as a name match, and where it is registered', async () => {
    const seen: URLSearchParams[] = [];
    serveImpl(
      {
        source: 'lain',
        result: {
          key: 'k',
          repo: 'saleor',
          tried: ['CheckoutShippingAddressUpdate'],
          basis: 'name_match',
          candidates: [
            {
              id: 'u',
              type: 'class',
              name: 'CheckoutShippingAddressUpdate',
              path: 'saleor/graphql/checkout/mutations/checkout_shipping_address_update.py',
              line: 46,
            },
          ],
          registeredIn: [{ name: 'CheckoutMutations', path: 'saleor/graphql/checkout/schema.py' }],
        },
      },
      seen,
    );
    setup(withPath(op()));
    const view = within(await screen.findByTestId('implemented-by'));
    expect(seen).toHaveLength(0);
    fireEvent.click(view.getByRole('button', { name: 'Find implementation' }));
    expect(await view.findByText(/checkout_shipping_address_update\.py:46/)).toBeTruthy();
    expect(view.getByText('name match').tagName).toBe('B');
    expect(view.getByText('CheckoutMutations')).toBeTruthy();
    expect(seen[0]?.get('repo')).toBe('saleor');
    expect(seen[0]?.get('key')).toBe('graphql:mutation:checkoutShippingAddressUpdate');
  });

  it('says plainly when nothing matched, without claiming there is no implementation', async () => {
    serveImpl({
      source: 'lain',
      result: {
        key: 'k',
        repo: 'saleor',
        tried: ['Ghost', 'ghost'],
        basis: 'name_match',
        candidates: [],
        registeredIn: [],
      },
    });
    setup(withPath(op()));
    const view = within(await screen.findByTestId('implemented-by'));
    fireEvent.click(view.getByRole('button', { name: 'Find implementation' }));
    expect(
      (await view.findByText(/No class or function named "Ghost", "ghost"/)).textContent,
    ).toMatch(/not proof there is none/);
  });

  it('an engine error is shown as a failed lookup', async () => {
    serveImpl({ source: 'error', error: 'lain unreachable' });
    setup(withPath(op()));
    const view = within(await screen.findByTestId('implemented-by'));
    fireEvent.click(view.getByRole('button', { name: 'Find implementation' }));
    expect((await view.findByText(/The lookup failed: lain unreachable/)).textContent).toBeTruthy();
  });

  it('only GraphQL operations get it (HTTP routes already point at their handler); a repo without code search says so', async () => {
    setup(withPath(op({ contract: 'http', label: 'http:GET /x' })));
    await screen.findByTestId('map-inspector');
    expect(screen.queryByTestId('implemented-by')).toBeNull();
    cleanup();
    setup(withPath(op(), on('repo:x', 'repo', { label: 'x', meta: { lainRepoId: null } })));
    expect((await screen.findByTestId('implemented-by')).textContent).toMatch(
      /Code search is unavailable/,
    );
  });
});

describe('MapInspector — trace end to end', () => {
  const ep = on('ep:1', 'endpoint', {
    label: 'graphql:query:products',
    parent: 'svc:api',
    contract: 'graphql',
  });
  const d = (node: OrgNode) =>
    detail({
      node,
      path: [
        on('svc:api', 'service', { label: 'saleor-api' }),
        on('repo:saleor', 'repo', { label: 'saleor', meta: { lainRepoId: 'saleor' } }),
      ],
    });

  it('an endpoint offers the trace, with its contract key and its service', async () => {
    const onTrace = vi.fn();
    setup(d(ep), { onTrace });
    fireEvent.click(await screen.findByRole('button', { name: 'Trace end to end' }));
    expect(onTrace).toHaveBeenCalledWith('graphql:query:products', 'saleor-api');
  });

  it('services, repos and anything that is not a contract do not offer it; neither does a view without the handler', async () => {
    setup(detail({ node: on('svc:orders', 'service', { label: 'orders' }) }), { onTrace: vi.fn() });
    await screen.findByTestId('map-inspector');
    expect(screen.queryByRole('button', { name: 'Trace end to end' })).toBeNull();
    cleanup();
    setup(d(ep));
    await screen.findByTestId('map-inspector');
    expect(screen.queryByRole('button', { name: 'Trace end to end' })).toBeNull();
  });
});
