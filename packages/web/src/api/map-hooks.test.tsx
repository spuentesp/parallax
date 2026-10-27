import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import {
  fetchGraphRoot,
  fetchGraphSnippet,
  useAsk,
  useMapNode,
  useMapSearch,
  useOrgMap,
  useRefreshMap,
} from './hooks.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const view = (meta: object = { source: 'lain' }) => ({
  nodes: [],
  edges: [],
  hiddenChildren: {},
  focus: null,
  unknownExpand: [],
  meta,
});

describe('useOrgMap', () => {
  it('posts sorted expansion and filters; focus brings hops (default 1); empty pin and limits are left out', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/workspaces/:id/map/view', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(view());
      }),
    );
    const { wrap } = wrapper();
    const { result } = renderHook(
      () =>
        useOrgMap('ws1', { expand: ['b', 'a'], filters: { provenance: 'inferred' }, focus: 'x' }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies[0]).toEqual({
      expand: ['a', 'b'],
      filters: { provenance: 'inferred' },
      focus: 'x',
      hops: 1,
    });
  });

  it('sends hops, limits and pins when given, and nothing about focus when there is none', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/workspaces/:id/map/view', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(view());
      }),
    );
    const { wrap } = wrapper();
    const a = renderHook(
      () =>
        useOrgMap('ws1', {
          expand: [],
          filters: {},
          focus: 'f',
          hops: 3,
          limits: { s: 9 },
          pin: ['p'],
        }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    expect(bodies[0]).toMatchObject({ focus: 'f', hops: 3, limits: { s: 9 }, pin: ['p'] });
    const b = renderHook(() => useOrgMap('ws2', { expand: [], filters: {} }), { wrapper: wrap });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(bodies[1]).toEqual({ expand: [], filters: {} });
  });

  it('does nothing without a workspace id', () => {
    const { wrap } = wrapper();
    const { result } = renderHook(() => useOrgMap(undefined, { expand: [], filters: {} }), {
      wrapper: wrap,
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('keeps asking while the server says it is refreshing, and stops when it is not', async () => {
    let calls = 0;
    server.use(
      http.post('/api/workspaces/:id/map/view', () => {
        calls++;
        return HttpResponse.json(view({ source: 'lain', refreshing: calls === 1 }));
      }),
    );
    const { wrap } = wrapper();
    const { result } = renderHook(() => useOrgMap('ws1', { expand: [], filters: {} }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.data?.meta.refreshing).toBe(true));
    await waitFor(() => expect(result.current.data?.meta.refreshing).toBe(false), {
      timeout: 6000,
    });
    const seen = calls;
    await new Promise((r) => setTimeout(r, 3500));
    expect(calls).toBe(seen);
  }, 15_000);
});

describe('useMapNode / useMapSearch', () => {
  it('asks for a node by id, and not at all without one', async () => {
    const urls: string[] = [];
    server.use(
      http.get('/api/workspaces/:id/map/node', ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json({ detail: null, meta: { source: 'lain' } });
      }),
    );
    const { wrap } = wrapper();
    const idle = renderHook(() => useMapNode('ws1', null), { wrapper: wrap });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const noWs = renderHook(() => useMapNode(undefined, 'x'), { wrapper: wrap });
    expect(noWs.result.current.fetchStatus).toBe('idle');
    const r = renderHook(() => useMapNode('ws1', 'svc:a b'), { wrapper: wrap });
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    expect(urls).toEqual(['?id=svc%3Aa+b']);
  });

  it('searches only from two characters, trimmed', async () => {
    const urls: string[] = [];
    server.use(
      http.get('/api/workspaces/:id/map/search', ({ request }) => {
        urls.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json({ results: [], meta: { source: 'lain' } });
      }),
    );
    const { wrap } = wrapper();
    const short = renderHook(() => useMapSearch('ws1', ' a '), { wrapper: wrap });
    expect(short.result.current.fetchStatus).toBe('idle');
    const noWs = renderHook(() => useMapSearch(undefined, 'abc'), { wrapper: wrap });
    expect(noWs.result.current.fetchStatus).toBe('idle');
    const ok = renderHook(() => useMapSearch('ws1', '  ab  '), { wrapper: wrap });
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(urls).toEqual(['ab']);
  });
});

describe('useRefreshMap', () => {
  it('posts the refresh and invalidates the map, node and search queries of that workspace only', async () => {
    let posted = 0;
    server.use(
      http.post('/api/workspaces/:id/map/refresh', () => {
        posted++;
        return HttpResponse.json({ meta: { source: 'lain' } });
      }),
    );
    const { wrap, client } = wrapper();
    client.setQueryData(['org-map', 'ws1', 1], { a: 1 });
    client.setQueryData(['org-map-node', 'ws1', 'n'], { a: 1 });
    client.setQueryData(['org-map-search', 'ws1', 'q'], { a: 1 });
    client.setQueryData(['org-map', 'other', 1], { a: 1 });
    const { result } = renderHook(() => useRefreshMap('ws1'), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(posted).toBe(1);
    const stale = (k: unknown[]) => client.getQueryState(k)?.isInvalidated;
    expect(stale(['org-map', 'ws1', 1])).toBe(true);
    expect(stale(['org-map-node', 'ws1', 'n'])).toBe(true);
    expect(stale(['org-map-search', 'ws1', 'q'])).toBe(true);
    expect(stale(['org-map', 'other', 1])).toBe(false);
  });
});

describe('useAsk and code fetchers', () => {
  it('posts the question with the org id', async () => {
    let body: unknown;
    server.use(
      http.post('/api/query', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          answer: 'a',
          explanation_status: 'complete',
          claims_summary: {},
          map_focus: null,
        });
      }),
    );
    const { wrap } = wrapper();
    const { result } = renderHook(() => useAsk('acme'), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync('q?');
    });
    expect(body).toEqual({ question: 'q?', orgId: 'acme' });
    const none = renderHook(() => useAsk(undefined), { wrapper: wrap });
    await act(async () => {
      await none.result.current.mutateAsync('x');
    });
    expect(body).toEqual({ question: 'x', orgId: '' });
  });

  it('fetchGraphRoot and fetchGraphSnippet build the exact query strings', async () => {
    const urls: string[] = [];
    server.use(
      http.get('/api/workspaces/:id/graph', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ graph: null, source: 'lain' });
      }),
      http.get('/api/workspaces/:id/graph/snippet', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ snippet: null, source: 'lain' });
      }),
    );
    await fetchGraphRoot('ws1', 'my repo');
    await fetchGraphSnippet('ws1', 'r', 'sym name');
    await fetchGraphSnippet('ws1', 'r', { path: 'a/b.rs' });
    const q = urls.map((u) => new URL(u));
    expect(q[0]?.pathname).toBe('/api/workspaces/ws1/graph');
    expect(q[0]?.searchParams.get('repo')).toBe('my repo');
    expect(Object.fromEntries(q[1]?.searchParams ?? [])).toEqual({ repo: 'r', symbol: 'sym name' });
    expect(Object.fromEntries(q[2]?.searchParams ?? [])).toEqual({ repo: 'r', path: 'a/b.rs' });
  });
});
