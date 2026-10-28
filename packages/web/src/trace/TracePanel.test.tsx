import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TraceHopDto, TraceLinkDto, TraceResultDto } from '../api/hooks.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { TracePanel, TraceView } from './TracePanel.js';

afterEach(cleanup);

const hop = (over: Partial<TraceHopDto> & Pick<TraceHopDto, 'id' | 'lane'>): TraceHopDto => ({
  label: over.id,
  repo: 'saleor',
  path: `src/${over.id}.py`,
  line: 10,
  contains: over.id,
  status: 'verified',
  reason: 'the engine read it',
  origin: 'model',
  ...over,
});
const link = (from: string, to: string, over: Partial<TraceLinkDto> = {}): TraceLinkDto => ({
  from,
  to,
  relation: 'calls',
  basis: 'asserted',
  because: 'asserted by the model',
  ...over,
});
const trace = (over: Partial<TraceResultDto> = {}): TraceResultDto => ({
  seed: { key: 'graphql:query:products', service: 'saleor-api' },
  summary: 'products flows from the Product model to the dashboard list',
  hops: [
    hop({ id: 'h1', lane: 'data', label: 'Product model (table inferred)' }),
    hop({ id: 'h2', lane: 'data_access', label: 'resolve_products' }),
    hop({
      id: 'contract',
      lane: 'contract',
      label: 'graphql:query:products',
      origin: 'engine',
      reason: 'location recorded by the engine',
    }),
    hop({
      id: 'call1',
      lane: 'client_call',
      repo: 'saleor-dashboard',
      label: 'dashboard calls products',
      origin: 'engine',
    }),
    hop({ id: 'h5', lane: 'sink', repo: 'saleor-dashboard', label: 'ProductList renders rows' }),
  ],
  rejected: [],
  links: [
    link('h1', 'h2', { relation: 'reads' }),
    link('h2', 'contract', {
      relation: 'serves',
      basis: 'engine',
      because: 'call graph',
      note: 'resolver serves the field',
    }),
    link('contract', 'call1', {
      relation: 'consumes',
      basis: 'engine',
      because: 'recorded by the engine',
    }),
    link('call1', 'h5', { relation: 'renders', basis: 'not_found', because: 'no path' }),
  ],
  gaps: [],
  sink: { hop: 'h5', kind: 'rendered', note: 'in the product list' },
  complete: true,
  status: 'available',
  usage: { modelCalls: 14, toolCalls: 9, promptTokens: 1, completionTokens: 1, ms: 31_000 },
  errors: [],
  ...over,
});

describe('TraceView', () => {
  it('draws the chain in order, each hop with its lane and where it was read, and the repos it crosses', () => {
    const onSelect = vi.fn();
    renderWithQuery(<TraceView trace={trace()} onSelect={onSelect} />);
    const order = screen.getAllByTestId(/^hop-/).map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual(['hop-h1', 'hop-h2', 'hop-contract', 'hop-call1', 'hop-h5']);
    const first = within(screen.getByTestId('hop-h1'));
    expect(first.getByText('Data')).toBeTruthy();
    expect(first.getByText('Product model (table inferred)')).toBeTruthy();
    expect(first.getByTitle('Show this repository on the map').textContent).toBe(
      'saleor:src/h1.py:10',
    );
    fireEvent.click(
      within(screen.getByTestId('hop-call1')).getByTitle('Show this repository on the map'),
    );
    expect(onSelect).toHaveBeenCalledWith('repo:saleor-dashboard');
  });

  it('every link says who backs it: engine fact, asserted by the model, or no path found — and the tally adds up', () => {
    renderWithQuery(<TraceView trace={trace()} onSelect={() => {}} />);
    const links = screen.getAllByTestId('trace-link').map((l) => l.textContent ?? '');
    expect(links[0]).toMatch(/reads.*asserted by the model/);
    expect(links[1]).toMatch(/serves.*resolver serves the field.*engine fact/);
    expect(links[3]).toMatch(/renders.*engine found no call path/);
    const tally = screen.getByTestId('trace-tally').textContent ?? '';
    expect(tally).toMatch(/5 hops read/);
    expect(tally).toMatch(/2 links are engine facts/);
    expect(tally).toMatch(/1 asserted by the model/);
    expect(tally).toMatch(/1 the engine found no path for/);
    expect(tally).toMatch(/reaches its end: rendered/);
  });

  it('a hop the engine could only partly check is labelled, with its reason on hover', () => {
    renderWithQuery(
      <TraceView
        trace={trace({
          hops: trace().hops.map((h) =>
            h.id === 'h2' ? { ...h, status: 'unverifiable', reason: 'repo not in the view' } : h,
          ),
        })}
        onSelect={() => {}}
      />,
    );
    expect(within(screen.getByTestId('hop-h2')).getByText('repo not in the view')).toBeTruthy();
  });

  it('shows where the trail was lost, in place, and says the trace does not reach its end', () => {
    renderWithQuery(
      <TraceView
        trace={trace({
          gaps: [
            {
              after: 'call1',
              reason: 'the generated code that executes the document is not in the index',
            },
          ],
          sink: null,
          complete: false,
        })}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('trace-gap').textContent).toMatch(/Trail lost: the generated code/);
    expect(screen.getByTestId('trace-no-sink').textContent).toMatch(
      /did not reach where the value ends/,
    );
    expect(screen.getByTestId('trace-tally').textContent).toMatch(/does not reach its end/);
  });

  it('what the model proposed and the engine could not find is set apart, not drawn as part of the chain', () => {
    const ghost = hop({
      id: 'x',
      lane: 'client_logic',
      label: 'Channels component',
      status: 'contradicted',
      reason: 'src/Channels.tsx does not exist in the index',
    });
    renderWithQuery(<TraceView trace={trace({ rejected: [ghost] })} onSelect={() => {}} />);
    expect(screen.queryByTestId('hop-x')).toBeNull();
    const box = screen.getByTestId('trace-rejected');
    expect(box.textContent).toMatch(/1 proposed by the model, not found in the code/);
    expect(box.textContent).toMatch(/Channels component/);
    expect(box.textContent).toMatch(/does not exist in the index/);
  });

  it('reports what the trace cost', () => {
    renderWithQuery(<TraceView trace={trace()} onSelect={() => {}} />);
    expect(screen.getByTestId('trace-usage').textContent).toBe(
      '14 model calls · 9 engine reads · 31 s',
    );
  });

  it('explains the line styles so the picture can be read without guessing', () => {
    renderWithQuery(<TraceView trace={trace()} onSelect={() => {}} />);
    const t = screen.getByTestId('trace-view').textContent ?? '';
    expect(t).toMatch(/Solid line: a fact the engine recorded or confirmed/);
    expect(t).toMatch(/Dashed: asserted by the model/);
    expect(t).toMatch(/not a contradiction/);
  });
});

const enc = new TextEncoder();
function sse(chunks: string[]): Response {
  const stream = new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        c.enqueue(enc.encode(ch));
        await new Promise((r) => setTimeout(r, 5));
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}
const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('TracePanel', () => {
  const mount = (key = 'graphql:query:products', service: string | null = 'saleor-api') => {
    const h = { onSelect: vi.fn(), onClose: vi.fn() };
    renderWithQuery(<TracePanel workspaceId="ws1" contract={{ key, service }} {...h} />);
    return h;
  };

  it('starts the trace when it opens, shows the reads as they happen, then the result', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/workspaces/:id/trace/stream', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return sse([
          ev('progress', {
            type: 'round',
            round: 1,
            toolCallsUsed: 0,
            maxToolCalls: 16,
            forced: false,
          }),
          ev('progress', {
            type: 'tool',
            tool: 'search_code',
            summary: 'Product · in saleor',
            ok: true,
            ms: 9,
          }),
          ev('progress', { type: 'verify', claims: 5 }),
          ev('result', trace()),
        ]);
      }),
    );
    mount();
    expect(await screen.findByTestId('trace-running')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('trace-running').textContent).toMatch(
        /search_code · Product · in saleor|Reading every hop/,
      ),
    );
    expect(await screen.findByTestId('trace-view')).toBeTruthy();
    expect(bodies).toEqual([{ key: 'graphql:query:products', service: 'saleor-api' }]);
    expect(screen.queryByTestId('trace-running')).toBeNull();
  });

  it('does not start a second trace when it re-renders', async () => {
    let n = 0;
    server.use(
      http.post('/api/workspaces/:id/trace/stream', () => {
        n++;
        return sse([ev('result', trace())]);
      }),
    );
    mount();
    await screen.findByTestId('trace-view');
    expect(n).toBe(1);
  });

  it('a server without the stream still answers through the plain route', async () => {
    server.use(http.post('/api/workspaces/:id/trace', () => HttpResponse.json(trace())));
    mount();
    expect(await screen.findByTestId('trace-view')).toBeTruthy();
  });

  it("says why it could not trace, with the server's reason, and offers to try again", async () => {
    server.use(
      http.post('/api/workspaces/:id/trace/stream', () =>
        HttpResponse.json(
          { code: 'NoModel', detail: 'Nemotron is not configured (NEBIUS_TOKEN)' },
          { status: 409 },
        ),
      ),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Nemotron is not configured/);
    server.use(http.post('/api/workspaces/:id/trace/stream', () => sse([ev('result', trace())])));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('trace-view')).toBeTruthy();
  });

  it('a rate-limited trace says so plainly', async () => {
    server.use(
      http.post('/api/workspaces/:id/trace/stream', () =>
        HttpResponse.json({ detail: 'x' }, { status: 429 }),
      ),
    );
    mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/limited per hour/);
  });

  it('a trace that failed (no submission, model error) is reported, never drawn as an empty chain', async () => {
    server.use(
      http.post('/api/workspaces/:id/trace/stream', () =>
        sse([
          ev(
            'result',
            trace({
              status: 'failed:invalid_trace',
              hops: [],
              errors: ['invalid submit_trace: hops.0.lane: nope'],
            }),
          ),
        ]),
      ),
    );
    mount();
    const failed = await screen.findByTestId('trace-failed');
    expect(failed.textContent).toMatch(/invalid trace/);
    expect(failed.textContent).toMatch(/invalid submit_trace/);
    expect(screen.queryByTestId('trace-view')).toBeNull();
  });

  it('closes', async () => {
    server.use(http.post('/api/workspaces/:id/trace/stream', () => sse([ev('result', trace())])));
    const { onClose } = mount();
    await screen.findByTestId('trace-view');
    fireEvent.click(screen.getByRole('button', { name: 'Close trace' }));
    expect(onClose).toHaveBeenCalled();
  });
});
