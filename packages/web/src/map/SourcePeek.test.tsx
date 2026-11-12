import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { SourcePeek } from './SourcePeek.js';

afterEach(cleanup);

function serve(body: unknown) {
  const calls: Array<Record<string, string>> = [];
  server.use(
    http.get('/api/workspaces/:id/graph/snippet', ({ request }) => {
      calls.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(body as object);
    }),
  );
  return calls;
}

describe('SourcePeek', () => {
  it('asks nothing until the button is pressed, then shows the path and the text', async () => {
    const calls = serve({
      snippet: { symbol: 's', repo: 'orders', path: 'src/a.rs', text: 'fn a() {}' },
      source: 'lain',
    });
    renderWithQuery(<SourcePeek workspaceId="ws1" repo="orders" target="create_order" />);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect((await screen.findByTestId('source-peek')).textContent).toBe('fn a() {}');
    expect(screen.getByText('src/a.rs')).toBeTruthy();
    expect(calls).toEqual([{ repo: 'orders', symbol: 'create_order' }]);
    expect(screen.queryByRole('button', { name: 'View source' })).toBeNull();
  });

  it('asks by path for a file target', async () => {
    const calls = serve({
      snippet: { symbol: 'p', repo: 'orders', path: 'src/a.rs', text: 'x' },
      source: 'lain',
    });
    renderWithQuery(<SourcePeek workspaceId="ws1" repo="orders" target={{ path: 'src/a.rs' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    await screen.findByTestId('source-peek');
    expect(calls).toEqual([{ repo: 'orders', path: 'src/a.rs' }]);
  });

  it('says what went wrong: an engine error, or a snippet error with no text', async () => {
    serve({ snippet: null, source: 'error', error: 'lain unreachable' });
    renderWithQuery(<SourcePeek workspaceId="ws1" repo="orders" target="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(await screen.findByText('lain unreachable')).toBeTruthy();
    expect(screen.queryByTestId('source-peek')).toBeNull();
    cleanup();

    serve({
      snippet: {
        symbol: 'x',
        repo: 'orders',
        path: null,
        text: null,
        error: 'explain_symbol did not report a path',
      },
      source: 'lain',
    });
    renderWithQuery(<SourcePeek workspaceId="ws2" repo="orders" target="y" />);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(await screen.findByText('explain_symbol did not report a path')).toBeTruthy();
  });

  it('shows a transport failure instead of hanging on "Loading source…"', async () => {
    server.use(
      http.get('/api/workspaces/:id/graph/snippet', () => HttpResponse.json({}, { status: 500 })),
    );
    renderWithQuery(<SourcePeek workspaceId="ws3" repo="orders" target="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(await screen.findByText('could not load the source')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Loading source…')).toBeNull());
  });

  it('shows a loading note while the request is in flight', async () => {
    server.use(
      http.get('/api/workspaces/:id/graph/snippet', async () => {
        await new Promise((r) => setTimeout(r, 60));
        return HttpResponse.json({
          snippet: { symbol: 's', repo: 'r', path: 'p', text: 't' },
          source: 'lain',
        });
      }),
    );
    renderWithQuery(<SourcePeek workspaceId="ws4" repo="orders" target="slow" />);
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(screen.getByText('Loading source…')).toBeTruthy();
    await screen.findByTestId('source-peek');
    expect(screen.queryByText('Loading source…')).toBeNull();
  });
});
