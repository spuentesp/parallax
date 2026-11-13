import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

const item = (key: string, reason: string, candidates: string[], candidateCount: number) => ({
  key,
  kind: 'unresolved',
  repo: 'dash',
  path: `src/${key}.ts`,
  line: 4,
  reason,
  detail: {},
  candidates,
  candidateCount,
  assessment: null,
});

describe('Coverage page', () => {
  it('lists unresolved consumers from the engine, filters by reason and shows repo health', async () => {
    server.use(
      http.get('/api/workspaces/:id/loose-ends', () =>
        HttpResponse.json({
          source: 'lain',
          generatedAt: 1,
          items: [
            item('a', 'no_match', ['graphql:query:checkout'], 1),
            // Varios candidatos NO es ambiguo: es un destino dinámico.
            item('b', 'env_unmapped', ['x', 'y'], 2),
            {
              ...item('c', 'ambiguous', [], 0),
              kind: 'inferred',
              detail: { targetService: 'fabric', endpoint: 'http:POST /', confidence: 0.3 },
            },
          ],
          summary: { total: 2, byCategory: {}, pendingCases: 0 },
          run: { state: 'idle', done: 0, total: 0 },
        }),
      ),
      http.get('/api/workspaces/:id/repos/status', () =>
        HttpResponse.json({
          source: 'lain',
          repos: [
            { id: 'dash', uri: 'u', sha: null, local: null, lainRepoId: 'dash', state: 'indexed' },
            { id: 'api', uri: 'u', sha: null, local: null, lainRepoId: 'api', state: 'unreviewed' },
          ],
          untracked: [],
        }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/coverage'] });
    renderWithQuery(<RouterProvider router={router} />);

    expect(await screen.findByText('src/a.ts:4')).toBeTruthy();
    expect(screen.getByText('src/b.ts:4')).toBeTruthy();
    expect(await screen.findByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('ambiguous, never auto-bound').previousSibling?.textContent).toBe('1');
    // Lo atado sólo por heurística se lista aparte, con su confianza.
    const heur = within(screen.getByRole('region', { name: 'Bound only by heuristic' }));
    expect(heur.getByText('fabric · http:POST /')).toBeTruthy();
    expect(heur.getByText('0.30')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'env_unmapped 1' }));
    expect(screen.queryByText('src/a.ts:4')).toBeNull();
    expect(screen.getByText('src/b.ts:4')).toBeTruthy();

    const health = within(screen.getByRole('region', { name: 'Repository index health' }));
    expect(health.getByText('ready')).toBeTruthy();
    expect(health.getByText('not reviewed')).toBeTruthy();
  });
});

describe('Resolve this call site', () => {
  const withRefs = (key: string) => ({
    ...item(key, 'no_match', ['http:POST /a'], 2),
    consumerId: `dash:Function:src/${key}.ts:call:4`,
    candidateRefs: [
      { key: 'http:POST /a', service: 'api', reason: 'pattern' },
      { key: 'http:POST /b', service: 'api', reason: 'pattern' },
    ],
  });
  const serve = (items: unknown[], check: (body: unknown) => Record<string, unknown>) => {
    const asked: unknown[] = [];
    server.use(
      http.get('/api/workspaces/:id/loose-ends', () =>
        HttpResponse.json({
          source: 'lain',
          generatedAt: 1,
          items,
          summary: { total: items.length, byCategory: {}, pendingCases: 0 },
          run: { state: 'idle', done: 0, total: 0 },
        }),
      ),
      http.get('/api/workspaces/:id/repos/status', () =>
        HttpResponse.json({ source: 'lain', repos: [], untracked: [] }),
      ),
      http.post('/api/workspaces/:id/bindings/check', async ({ request }) => {
        const body = await request.json();
        asked.push(body);
        return HttpResponse.json(check(body));
      }),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/coverage'] });
    renderWithQuery(<RouterProvider router={router} />);
    return asked;
  };

  it('asks the engine about the picked endpoint and shows the repos.yaml entry it accepts', async () => {
    const yaml = '- consumer:\n    repo: dash\n  provider:\n    key: http:POST /a\n';
    const asked = serve([withRefs('a')], () => ({
      source: 'lain',
      valid: true,
      reasons: [],
      methodMatch: true,
      templateMatch: 'exact',
      bindingsEntry: yaml,
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'src/a.ts:4' }));
    fireEvent.click(await screen.findByRole('radio', { name: /http:POST \/a/ }));
    expect(await screen.findByText('The engine accepts this link')).toBeTruthy();
    // Lo que se le pregunta al motor es el consumidor real y el endpoint elegido.
    expect(asked).toEqual([
      {
        consumer: 'dash:Function:src/a.ts:call:4',
        endpoint: { key: 'http:POST /a', service: 'api' },
      },
    ]);
    const pre = screen.getByText(/provider:/);
    expect(pre.textContent).toContain('key: http:POST /a');
    expect(screen.getByRole('button', { name: 'Copy YAML' })).toBeTruthy();
    // Parallax no escribe el cambio: lo dice, no finge un "abrir PR".
    expect(screen.getByText(/does not write this/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pull request/i })).toBeNull();
  });

  it('shows why the engine rejects a link, with no YAML to copy', async () => {
    serve([withRefs('a')], () => ({
      source: 'lain',
      valid: false,
      reasons: ['same_service', 'template_mismatch'],
      methodMatch: true,
      templateMatch: 'none',
      bindingsEntry: null,
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'src/a.ts:4' }));
    fireEvent.click(await screen.findByRole('radio', { name: /http:POST \/b/ }));
    expect(await screen.findByText('The engine rejects this link')).toBeTruthy();
    expect(screen.getByText(/same service/)).toBeTruthy();
    expect(screen.getByText(/URL template of the call does not match/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy YAML' })).toBeNull();
  });

  it('says so when the engine offered no candidates, instead of an empty picker', async () => {
    serve([item('z', 'dynamic_target', [], 0)], () => ({}));
    fireEvent.click(await screen.findByRole('button', { name: 'src/z.ts:4' }));
    expect(await screen.findByText(/offered no candidate endpoints/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('Coverage breakdown', () => {
  const cls = (id: string, label: string, count: number, gap: boolean, hint = `${label} hint`) => ({
    id,
    label,
    hint,
    gap,
    count,
  });
  const serve = (breakdown: unknown | null) => {
    server.use(
      http.get('/api/workspaces/:id/loose-ends', () =>
        HttpResponse.json({
          source: 'lain',
          generatedAt: 1,
          items: [item('own', 'no_match', ['x'], 1), item('lone', 'no_match', [], 0)],
          summary: { total: 2, byCategory: {}, pendingCases: 0 },
          run: { state: 'idle', done: 0, total: 0 },
        }),
      ),
      http.get('/api/workspaces/:id/repos/status', () =>
        HttpResponse.json({ source: 'lain', repos: [], untracked: [] }),
      ),
      http.get('/api/workspaces/:id/coverage/breakdown', () =>
        breakdown === null ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(breakdown),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme/coverage'] });
    renderWithQuery(<RouterProvider router={router} />);
  };
  const full = {
    source: 'lain',
    total: 324,
    gaps: 45,
    byKey: { own: 'internal', lone: 'no_candidate' },
    classes: [
      cls('no_candidate', 'No candidate offered', 28, true),
      cls('internal', 'Call inside one service', 52, false),
      cls('test_or_tooling', 'Test or tooling code', 227, false),
      cls('heuristic', 'Bound only by a heuristic', 25, false),
    ],
  };

  it('says how many are real gaps, and lists what the rest are with what each means', async () => {
    serve(full);
    const box = within(await screen.findByTestId('coverage-breakdown'));
    expect(box.getByText('45 of 324 loose ends are real gaps in product code')).toBeTruthy();
    expect(box.getByText('227')).toBeTruthy();
    expect(box.getByText('Test or tooling code hint')).toBeTruthy();
    // Sólo lo que es un hueco se marca como tal.
    expect(box.getAllByText('gap')).toHaveLength(1);
  });

  it('clicking a class narrows the table to it, and clicking again clears it', async () => {
    serve(full);
    await screen.findByTestId('coverage-breakdown');
    expect(await screen.findByText('src/own.ts:4')).toBeTruthy();
    expect(screen.getByText('src/lone.ts:4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Call inside one service/ }));
    expect(screen.getByText('src/own.ts:4')).toBeTruthy();
    expect(screen.queryByText('src/lone.ts:4')).toBeNull();
    // Los contadores de las razones siguen a la clase: 1 de 2 (antes "All 2").
    expect(screen.getByRole('button', { name: 'All 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'no_match 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Call inside one service/ }));
    expect(screen.getByText('src/lone.ts:4')).toBeTruthy();
  });

  it('the heuristic class is not a filter of this table, so it is not clickable', async () => {
    serve(full);
    await screen.findByTestId('coverage-breakdown');
    expect(
      (screen.getByRole('button', { name: /Bound only by a heuristic/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows nothing when the engine cannot classify, instead of a made-up breakdown', async () => {
    serve(null);
    await screen.findByText('src/own.ts:4');
    await waitFor(() => expect(screen.queryByText(/Classifying the loose ends/)).toBeNull());
    expect(screen.queryByTestId('coverage-breakdown')).toBeNull();
  });
});
