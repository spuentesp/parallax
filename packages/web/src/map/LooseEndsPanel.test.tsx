import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LooseEndDto, LooseEndsReportDto } from '../api/hooks.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { LooseEndsPanel } from './LooseEndsPanel.js';

afterEach(cleanup);

const item = (over: Partial<LooseEndDto> = {}): LooseEndDto => ({
  key: `k${Math.random()}`,
  group: 'g',
  kind: 'unresolved',
  repo: 'storefront',
  path: 'src/lib/auth/bff-client.ts',
  line: 20,
  reason: 'no_match',
  detail: {},
  candidates: [],
  candidateCount: 0,
  assessment: null,
  ...over,
});
const none = {
  likely_real_link: 0,
  external_call: 0,
  dynamic_target: 0,
  not_a_call: 0,
  test_or_tooling: 0,
  unclear: 0,
};
const report = (over: Partial<LooseEndsReportDto> = {}): LooseEndsReportDto => ({
  source: 'lain',
  generatedAt: 1,
  items: [],
  summary: { total: 0, byCategory: { ...none }, pendingCases: 0 },
  run: { state: 'idle', done: 0, total: 0 },
  ...over,
});
const serve = (r: LooseEndsReportDto) =>
  server.use(http.get('/api/workspaces/:id/loose-ends', () => HttpResponse.json(r)));

function mount(
  over: Partial<Parameters<typeof LooseEndsPanel>[0]> = {},
  opts: Parameters<typeof renderWithQuery>[1] = {},
) {
  const h = { onSelect: vi.fn(), onClose: vi.fn() };
  renderWithQuery(<LooseEndsPanel workspaceId="ws1" {...h} {...over} />, opts);
  return h;
}

const sample = report({
  items: [
    item({
      key: 'a',
      path: 'src/lib/auth/bff-client.ts',
      assessment: {
        category: 'likely_real_link',
        reason: 'Hardcoded POST to /api/auth/login.',
        evidence: 'x:1',
        source: 'model',
      },
    }),
    item({
      key: 'b',
      repo: 'saleor',
      path: 'saleor/checkout/tasks.py',
      line: 206,
      reason: 'dynamic_topic',
      assessment: {
        category: 'dynamic_target',
        reason: 'topic built at runtime',
        evidence: null,
        source: 'rule',
      },
    }),
    item({
      key: 'c',
      kind: 'inferred',
      repo: 'saleor-dashboard',
      path: 'src/graphql/authFetch.ts',
      line: 138,
      reason: 'unbound_host',
      detail: { endpoint: 'http:ANY /', confidence: 0.6 },
    }),
  ],
  summary: {
    total: 3,
    byCategory: { ...none, likely_real_link: 1, dynamic_target: 1 },
    pendingCases: 1,
  },
});

describe('LooseEndsPanel', () => {
  it('lists loose ends grouped by what they are, the most worth looking at first, each tagged Rule or Model', async () => {
    serve(sample);
    mount();
    const panel = within(await screen.findByTestId('loose-ends'));
    expect(await panel.findByText('Loose ends · 3')).toBeTruthy();
    const headings = panel.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Probably a real link the engine missed · 1',
      'Target built at runtime · 1',
      'Not classified yet · 1',
    ]);
    // Una vez en la explicación de arriba y una por cada fila con ese origen.
    expect(panel.getAllByText('Model')).toHaveLength(2);
    expect(panel.getAllByText('Rule')).toHaveLength(2);
    // El motivo del motor y la relación inferida se ven tal cual.
    expect(panel.getByText(/engine: unbound_host → http:ANY \/ \(0\.60\)/)).toBeTruthy();
    expect(panel.getByText('src/lib/auth/bff-client.ts', { exact: false })).toBeTruthy();
  });

  it('says plainly that a Model verdict is not an engine fact', async () => {
    serve(sample);
    mount();
    expect((await screen.findByTestId('loose-ends')).textContent).toMatch(/not an engine fact/);
  });

  it('a category chip narrows the list; pressing it again restores it', async () => {
    serve(sample);
    mount();
    const panel = within(await screen.findByTestId('loose-ends'));
    await panel.findByText('Loose ends · 3');
    fireEvent.click(panel.getByRole('button', { name: /1 Target built at runtime/ }));
    expect(panel.getAllByRole('heading', { level: 4 })).toHaveLength(1);
    fireEvent.click(panel.getByRole('button', { name: /1 Target built at runtime/ }));
    expect(panel.getAllByRole('heading', { level: 4 })).toHaveLength(3);
  });

  it('clicking a row points the map at that repo', async () => {
    serve(sample);
    const { onSelect } = mount();
    const panel = within(await screen.findByTestId('loose-ends'));
    fireEvent.click(await panel.findByText(/saleor-dashboard:src\/graphql\/authFetch\.ts:138/));
    expect(onSelect).toHaveBeenCalledWith('repo:saleor-dashboard');
  });

  it('classifying posts to the server and the button reflects the pending count', async () => {
    serve(sample);
    let posted = 0;
    server.use(
      http.post('/api/workspaces/:id/loose-ends/assess', () => {
        posted++;
        return HttpResponse.json({ status: 'started' }, { status: 202 });
      }),
    );
    mount();
    const btn = await screen.findByRole('button', { name: 'Classify 1 with Nemotron' });
    fireEvent.click(btn);
    await waitFor(() => expect(posted).toBe(1));
  });

  it('nothing pending: the classify button is disabled (no model call to spend)', async () => {
    serve(
      report({
        items: [
          item({
            assessment: { category: 'unclear', reason: 'r', evidence: null, source: 'model' },
          }),
        ],
        summary: { total: 1, byCategory: { ...none, unclear: 1 }, pendingCases: 0 },
      }),
    );
    mount();
    expect(
      (await screen.findByRole('button', { name: /Classify 0/ })).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('while running it shows progress and cannot be started twice', async () => {
    serve({ ...sample, run: { state: 'running', done: 5, total: 20 } });
    mount();
    expect((await screen.findByTestId('loose-progress')).textContent).toMatch(/5 of 20 cases/);
    expect(screen.getByRole('button', { name: 'Classifying…' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('after a run it says what it cost: calls, tokens, seconds', async () => {
    serve({
      ...sample,
      run: {
        state: 'done',
        done: 20,
        total: 20,
        usage: { modelCalls: 5, completionTokens: 1350, ms: 21_300 },
      },
    });
    mount();
    expect((await screen.findByTestId('loose-usage')).textContent).toMatch(
      /5 model calls · 1350 tokens · 21 s/,
    );
  });

  it('a stopped run (budget or error) is said, and what was stored is kept', async () => {
    serve({
      ...sample,
      run: {
        state: 'failed',
        done: 10,
        total: 20,
        error: 'budget: 20 model calls per run reached',
      },
    });
    mount();
    expect((await screen.findByRole('status')).textContent).toMatch(
      /budget: 20 model calls per run reached.*already stored are kept/,
    );
  });

  it('a workspace without LAIN, or an engine error, is said instead of showing an empty list', async () => {
    serve(report({ source: 'unconfigured' }));
    mount();
    expect((await screen.findByTestId('loose-unavailable')).textContent).toMatch(/no LAIN server/);
    cleanup();
    serve(report({ source: 'error', error: 'lain down' }));
    mount();
    expect((await screen.findByTestId('loose-unavailable')).textContent).toMatch(/lain down/);
  });

  it('closes', async () => {
    serve(sample);
    const { onClose } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Close loose ends' }));
    expect(onClose).toHaveBeenCalled();
  });
});
