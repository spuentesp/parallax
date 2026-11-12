import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { useCodeLayer } from './useCodeLayer.js';

const n = (name: string, type: string) => ({ id: `${type}-${name}`, name, type, kind: 'other' });

function serve() {
  const calls = { root: [] as string[], children: [] as Array<Record<string, string>> };
  server.use(
    http.get('/api/workspaces/:id/graph', ({ request }) => {
      calls.root.push(new URL(request.url).searchParams.get('repo') ?? '');
      return HttpResponse.json({
        graph: { repos: [{ repo: 'orders', nodes: [n('main.rs', 'File')], truncated: true }] },
        source: 'lain',
      });
    }),
    http.get('/api/workspaces/:id/graph/children', ({ request }) => {
      calls.children.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json({
        children: [n('main', 'Function')],
        childrenTruncated: false,
        communications: [{ edge: 'Uses', nodes: [n('S', 'Struct')] }],
        source: 'lain',
      });
    }),
  );
  return calls;
}

describe('useCodeLayer', () => {
  it('opening a root asks LAIN once for that repo, marks it open, and stores what came back', async () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.toggle('code:orders', false));
    expect(result.current.open.has('code:orders')).toBe(true);
    expect(result.current.state['code:orders']).toEqual({ state: 'loading' });
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('ready'));
    const entry = result.current.state['code:orders'];
    expect(entry).toMatchObject({ state: 'ready', truncated: true, communications: [] });
    expect(entry?.state === 'ready' && entry.children.map((c) => c.name)).toEqual(['main.rs']);
    expect(calls.root).toEqual(['orders']);
  });

  it('closing keeps what it has and asks nothing; reopening does not ask again', async () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.toggle('code:orders', false));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('ready'));
    act(() => result.current.toggle('code:orders', true));
    expect(result.current.open.has('code:orders')).toBe(false);
    expect(result.current.state['code:orders']?.state).toBe('ready');
    act(() => result.current.toggle('code:orders', false));
    expect(calls.root).toHaveLength(1);
  });

  it('a node asks for its children by repo/type/name and keeps its relationships', async () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    const id = 'sym:orders|File|main.rs';
    act(() => result.current.toggle(id, false));
    await waitFor(() => expect(result.current.state[id]?.state).toBe('ready'));
    expect(calls.children).toEqual([{ repo: 'orders', type: 'File', name: 'main.rs' }]);
    const entry = result.current.state[id];
    expect(entry).toMatchObject({ state: 'ready', truncated: false });
    expect(entry?.state === 'ready' && entry.communications[0]?.edge).toBe('Uses');
  });

  it('ensure loads without opening, and never twice', async () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    const id = 'sym:orders|Function|f';
    act(() => {
      result.current.ensure(id);
      result.current.ensure(id);
    });
    await waitFor(() => expect(result.current.state[id]?.state).toBe('ready'));
    expect(result.current.open.has(id)).toBe(false);
    expect(calls.children).toHaveLength(1);
  });

  it('ignores ids that are not code ids', () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.ensure('svc:orders'));
    expect(result.current.state).toEqual({});
    expect(calls.root.length + calls.children.length).toBe(0);
  });

  it('a LAIN failure becomes an error entry, and can be retried', async () => {
    let fail = true;
    server.use(
      http.get('/api/workspaces/:id/graph', () =>
        fail
          ? HttpResponse.json({
              graph: {
                repos: [{ repo: 'orders', nodes: [], truncated: false, error: 'timed out' }],
              },
              source: 'lain',
            })
          : HttpResponse.json({
              graph: { repos: [{ repo: 'orders', nodes: [n('a', 'File')], truncated: false }] },
              source: 'lain',
            }),
      ),
    );
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.toggle('code:orders', false));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('error'));
    expect(result.current.state['code:orders']).toEqual({ state: 'error', message: 'timed out' });
    fail = false;
    act(() => result.current.ensure('code:orders'));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('ready'));
  });

  it('a non-lain source, an empty reply, or a transport error are all reported, never empty listings', async () => {
    server.use(
      http.get('/api/workspaces/:id/graph', () =>
        HttpResponse.json({ graph: null, source: 'unconfigured' }),
      ),
      http.get('/api/workspaces/:id/graph/children', () =>
        HttpResponse.json({ source: 'error', error: 'boom' }),
      ),
    );
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.ensure('code:orders'));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('error'));
    expect(result.current.state['code:orders']).toEqual({
      state: 'error',
      message: 'code graph unavailable',
    });
    act(() => result.current.ensure('sym:orders|File|x'));
    await waitFor(() => expect(result.current.state['sym:orders|File|x']?.state).toBe('error'));
    expect(result.current.state['sym:orders|File|x']).toEqual({ state: 'error', message: 'boom' });

    server.use(
      http.get('/api/workspaces/:id/graph/children', () => HttpResponse.json({}, { status: 500 })),
    );
    act(() => result.current.ensure('sym:orders|File|y'));
    await waitFor(() => expect(result.current.state['sym:orders|File|y']?.state).toBe('error'));
  });

  it('missing children/communications in a healthy reply mean none, not undefined', async () => {
    server.use(
      http.get('/api/workspaces/:id/graph/children', () => HttpResponse.json({ source: 'lain' })),
    );
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.ensure('sym:orders|File|z'));
    await waitFor(() => expect(result.current.state['sym:orders|File|z']?.state).toBe('ready'));
    expect(result.current.state['sym:orders|File|z']).toEqual({
      state: 'ready',
      children: [],
      truncated: false,
      hidden: 0,
      communications: [],
    });
  });

  it('reset forgets state and open nodes, and allows asking again', async () => {
    const calls = serve();
    const { result } = renderHook(() => useCodeLayer('ws1'));
    act(() => result.current.toggle('code:orders', false));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('ready'));
    act(() => result.current.reset());
    expect(result.current.state).toEqual({});
    expect(result.current.open.size).toBe(0);
    act(() => result.current.toggle('code:orders', false));
    await waitFor(() => expect(result.current.state['code:orders']?.state).toBe('ready'));
    expect(calls.root).toHaveLength(2);
  });
});
