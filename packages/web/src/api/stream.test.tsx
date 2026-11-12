import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { ApiClient, ApiError } from './client.js';

afterEach(cleanup);

const enc = new TextEncoder();
/** Un flujo que entrega los trozos con una pausa entre ellos (como el servidor real). */
function sse(chunks: string[], gate?: Promise<void>): Response {
  const stream = new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        if (gate && ch === '__GATE__') {
          await gate;
          continue;
        }
        c.enqueue(enc.encode(ch));
        await new Promise((r) => setTimeout(r, 5));
      }
      c.close();
    },
  });
  return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
}
const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('ApiClient.postSse', () => {
  const client = new ApiClient({});

  it('delivers each event as it arrives and returns the result, even when events are split across chunks', async () => {
    const full = ev('progress', { type: 'round', round: 1 }) + ev('result', { answer: 'ok' });
    const cut = Math.floor(full.length / 2);
    server.use(http.post('/api/q', () => sse([full.slice(0, cut), full.slice(cut)])));
    const seen: unknown[] = [];
    const r = await client.postSse<{ answer: string }>('/api/q', {}, (e, d) => seen.push([e, d]));
    expect(r).toEqual({ answer: 'ok' });
    expect(seen).toEqual([['progress', { type: 'round', round: 1 }]]);
  });

  it('returns null when the server has no stream (404) or answers with something that is not one', async () => {
    server.use(http.post('/api/q', () => new HttpResponse(null, { status: 404 })));
    expect(await client.postSse('/api/q', {}, () => {})).toBeNull();
    server.use(http.post('/api/q', () => HttpResponse.json({ answer: 'x' })));
    expect(await client.postSse('/api/q', {}, () => {})).toBeNull();
  });

  it('a JSON error before the stream (429, 409) is an ApiError with its body', async () => {
    server.use(
      http.post('/api/q', () => HttpResponse.json({ title: 'Too Many Requests' }, { status: 429 })),
    );
    await expect(client.postSse('/api/q', {}, () => {})).rejects.toMatchObject({
      status: 429,
      body: { title: 'Too Many Requests' },
    });
  });

  it('an error event, or a stream that ends without a result, is an error — never a silent success', async () => {
    server.use(http.post('/api/q', () => sse([ev('error', { detail: 'boom' })])));
    await expect(client.postSse('/api/q', {}, () => {})).rejects.toBeInstanceOf(ApiError);
    server.use(http.post('/api/q', () => sse([ev('progress', { type: 'round' })])));
    await expect(client.postSse('/api/q', {}, () => {})).rejects.toMatchObject({ status: 502 });
  });

  it('ignores a malformed event instead of breaking the stream', async () => {
    server.use(
      http.post('/api/q', () =>
        sse(['event: progress\ndata: {not json\n\n', ev('result', { ok: 1 })]),
      ),
    );
    expect(await client.postSse('/api/q', {}, () => {})).toEqual({ ok: 1 });
  });
});

describe('the assistant shows what the investigator is doing, live', () => {
  const claims = {
    total: 0,
    verified: 0,
    contradicted: 0,
    unverifiable: 0,
    supported: 0,
    unsupported: 0,
  };
  const done = {
    answer: 'final answer',
    explanation_status: 'available',
    claims_summary: claims,
    map_focus: null,
    conversation: { id: 'c1', seq: 1 },
  };

  it('reads and rounds appear while the answer is pending, then the answer replaces them', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.post('/api/query/stream', () =>
        sse(
          [
            ev('progress', {
              type: 'round',
              round: 1,
              toolCallsUsed: 0,
              maxToolCalls: 10,
              forced: false,
            }),
            ev('progress', {
              type: 'tool',
              tool: 'search_code',
              summary: 'checkout shipping · in saleor',
              ok: true,
              ms: 40,
            }),
            ev('progress', {
              type: 'round',
              round: 2,
              toolCallsUsed: 1,
              maxToolCalls: 10,
              forced: false,
            }),
            ev('progress', {
              type: 'tool',
              tool: 'get_service',
              summary: 'saleor-api',
              ok: false,
              ms: 3,
              note: 'duplicate_call',
            }),
            '__GATE__',
            ev('progress', { type: 'verify', claims: 3 }),
            ev('result', done),
          ],
          gate,
        ),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText('Ask about your architecture'), {
      target: { value: 'where?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const steps = await screen.findByTestId('progress-steps');
    await waitFor(() =>
      expect(steps.textContent).toMatch(/search_code · checkout shipping · in saleor/),
    );
    // Los pasos llegan por un flujo: el segundo puede tardar un instante tras el primero.
    await waitFor(() =>
      expect(steps.textContent).toMatch(/get_service · saleor-api \(refused: duplicate call\)/),
    );
    await waitFor(() =>
      expect(screen.getByTestId('progress-count').textContent).toBe('1 of 10 reads'),
    );
    expect(screen.getByTestId('progress-doing').textContent).toMatch(
      /Reading the result|Deciding the next step/,
    );
    expect(screen.queryByText('final answer')).toBeNull();

    release();
    await waitFor(() =>
      expect(screen.getByTestId('progress-doing').textContent).toMatch(/Checking 3 claims/),
    );
    expect(await screen.findByText('final answer')).toBeTruthy();
    expect(screen.queryByTestId('investigating')).toBeNull();
  });

  it('a server without the stream still answers (no progress, same answer)', async () => {
    server.use(http.post('/api/query', () => HttpResponse.json(done)));
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText('Ask about your architecture'), {
      target: { value: 'q' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('final answer')).toBeTruthy();
  });

  it('a limit hit before the stream shows as a failed question, with the reason', async () => {
    server.use(
      http.post('/api/query/stream', () =>
        HttpResponse.json({ detail: 'Question limit reached' }, { status: 429 }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
    renderWithQuery(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText('Ask about your architecture'), {
      target: { value: 'q' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByText(/could not be answered/)).textContent).toMatch(/429/);
  });
});
