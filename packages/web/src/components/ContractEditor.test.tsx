import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecommendationDto, RecommendationsResult } from '../api/hooks.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { ContractEditor, mergeIntoContext } from './ContractEditor.js';

afterEach(() => cleanup());

describe('ContractEditor', () => {
  it('previews and applies native Lain contract context through HTTP', async () => {
    const bodies: Array<{ dry_run: boolean; snapshot: string }> = [];
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', async ({ request }) => {
        const body = (await request.json()) as { dry_run: boolean; snapshot: string };
        bodies.push(body);
        return HttpResponse.json(
          body.dry_run
            ? { applied: false, dry_run: true, yaml: 'provides:\n  - service: api\n' }
            : {
                applied: true,
                dry_run: false,
                backup: '/tmp/repos.yaml.bak',
                yaml: 'provides:\n  - service: api\n',
              },
        );
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect((await screen.findByTestId('remediation-result')).textContent).toBe('Dry-run preview');
    expect(screen.getByTestId('contract-preview').textContent).toContain('service: api');

    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect((await screen.findByTestId('remediation-result')).textContent).toBe('Applied by Lain');
    expect(screen.getByText(/repos.yaml.bak/)).toBeTruthy();
    expect(bodies.map((body) => [body.snapshot, body.dry_run])).toEqual([
      ['live', true],
      ['live', false],
    ]);
  });

  it('shows invalid JSON without sending a write request', async () => {
    let writes = 0;
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', () => {
        writes++;
        return HttpResponse.json({});
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText('Context JSON'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/Expected property name|unexpected token/i)).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('validates the native declaration schema before writing', async () => {
    let writes = 0;
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', () => {
        writes++;
        return HttpResponse.json({});
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText('Context JSON'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/at least one contract declaration/i)).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('does not offer writes to a read-only session', () => {
    renderWithQuery(<ContractEditor workspaceId="ws1" />, { signedIn: { readOnly: true } });
    expect(screen.getByRole('button', { name: 'Preview changes' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Apply changes' })).toHaveProperty('disabled', true);
  });
});

const binding = (over: Partial<RecommendationDto> = {}): RecommendationDto => ({
  id: 'r1',
  kind: 'binding',
  title: 'web:src/a.ts:10 → api http:POST /a',
  site: { repo: 'web', path: 'src/a.ts', line: 10 },
  declaration: {
    consumer: { repo: 'web', path: 'src/a.ts', symbol: 'POST /a', key: 'http:POST /a' },
    provider: { service: 'api', key: 'http:POST /a' },
  },
  basis: 'engine_verified',
  basisDetail: 'check_binding accepts it (template exact); the only candidate that passes',
  alternatives: [],
  rationale: null,
  modelPicked: false,
  ...over,
});
const result = (over: Partial<RecommendationsResult> = {}): RecommendationsResult => ({
  source: 'lain',
  recommendations: [],
  skipped: [],
  model: { used: true, name: 'nemotron', note: null },
  ...over,
});
const serveRecs = (r: RecommendationsResult) =>
  server.use(
    http.post('/api/workspaces/ws1/contracts/recommendations', () => HttpResponse.json(r)),
  );
const suggest = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Suggest with assistant' }));

describe('ContractEditor recommendations', () => {
  it('lists each recommendation with who backs it; the ones the engine accepted on its own start selected', async () => {
    serveRecs(
      result({
        recommendations: [
          binding({ rationale: 'It posts the order to the API.' }),
          binding({
            id: 'r2',
            title: 'web:src/b.ts:4 → api http:POST /b',
            modelPicked: true,
            basisDetail:
              'check_binding accepts it, and so do 1 other candidate; the assistant picked this one from the code',
            alternatives: [{ key: 'http:POST /c', service: 'api' }],
          }),
        ],
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    suggest();
    const list = within(await screen.findByTestId('recommendations'));
    expect(list.getByText('engine verified')).toBeTruthy();
    expect(list.getByText('assistant picked · engine accepts')).toBeTruthy();
    // El juicio del modelo va rotulado como tal, no como un hecho.
    expect(list.getByText(/Assistant's reading, not an engine fact/)).toBeTruthy();
    expect(list.getByText('It posts the order to the API.')).toBeTruthy();
    expect(list.getByText(/also accepts/i).textContent).toMatch(/http:POST \/c/);
    const box = (name: RegExp) => list.getByRole('checkbox', { name }) as HTMLInputElement;
    expect(box(/src\/a\.ts/).checked).toBe(true);
    expect(box(/src\/b\.ts/).checked).toBe(false);
  });

  it('adding replaces the placeholder example, and Preview then sends exactly the chosen declaration', async () => {
    serveRecs(
      result({
        recommendations: [
          binding(),
          binding({
            id: 'r2',
            title: 'web:src/b.ts:4 → api http:POST /b',
            declaration: {
              consumer: { repo: 'web', path: 'src/b.ts', symbol: 'POST /b', key: 'http:POST /b' },
              provider: { service: 'api', key: 'http:POST /b' },
            },
          }),
        ],
      }),
    );
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ applied: false, dry_run: true, yaml: 'bindings: []' });
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    suggest();
    await screen.findByTestId('recommendations');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected to the context' }));

    const text = (screen.getByLabelText('Context JSON') as HTMLTextAreaElement).value;
    const ctx = JSON.parse(text) as {
      provides: unknown[];
      bindings: unknown[];
      host_aliases: unknown[];
    };
    // El proveedor de ejemplo ("api GET /orders") ya no está: no era del usuario.
    expect(ctx.provides).toEqual([]);
    expect(ctx.bindings).toHaveLength(2);
    expect(ctx.host_aliases).toEqual([]);
    expect(screen.getByRole('status').textContent).toMatch(
      /Preview changes to have the engine validate/,
    );

    // Nada se escribe al añadir; la vista previa es de sólo lectura.
    expect(bodies).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // Lo que se envía a la vista previa son exactamente las dos declaraciones elegidas.
    expect(bodies[0]).toMatchObject({ dry_run: true });
    expect(
      (bodies[0] as { bindings: Array<{ provider: { key: string } }> }).bindings.map(
        (b) => b.provider.key,
      ),
    ).toEqual(['http:POST /a', 'http:POST /b']);
  });

  it('adding twice does not duplicate, and keeps what the user had already written', () => {
    const mine = JSON.stringify({
      provides: [{ service: 'api', key: 'http:GET /mine' }],
      bindings: [],
    });
    const once = mergeIntoContext(mine, [binding()]);
    if ('error' in once) throw new Error(once.error);
    const twice = mergeIntoContext(once.text, [binding()]);
    if ('error' in twice) throw new Error(twice.error);
    const ctx = JSON.parse(twice.text) as { provides: unknown[]; bindings: unknown[] };
    expect(ctx.provides).toEqual([{ service: 'api', key: 'http:GET /mine' }]);
    expect(ctx.bindings).toHaveLength(1);
  });

  it('will not add into a context that is not valid JSON, and says so', async () => {
    serveRecs(result({ recommendations: [binding()] }));
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText('Context JSON'), { target: { value: '{oops' } });
    suggest();
    await screen.findByTestId('recommendations');
    fireEvent.click(screen.getByRole('button', { name: /Add 1 selected/ }));
    expect(await screen.findByText(/not valid JSON/)).toBeTruthy();
    expect((screen.getByLabelText('Context JSON') as HTMLTextAreaElement).value).toBe('{oops');
  });

  it('with nothing to recommend it says so, with the reason and what was left out', async () => {
    serveRecs(
      result({
        model: {
          used: false,
          name: null,
          note: 'No model is configured: these are only the proposals the engine checked.',
        },
        skipped: [
          { reason: 'the engine rejects every candidate', count: 57 },
          { reason: 'test, tooling or not a real call', count: 202 },
        ],
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    suggest();
    expect((await screen.findByTestId('no-recommendations')).textContent).toMatch(
      /No model is configured/,
    );
    const left = within(
      screen.getByText('What was left out, and why').closest('details') as HTMLElement,
    );
    expect(left.getByText('57 · the engine rejects every candidate')).toBeTruthy();
    expect(left.getByText('202 · test, tooling or not a real call')).toBeTruthy();
  });

  it('is available to a read-only session (it only reads), while Apply stays disabled', async () => {
    serveRecs(result({ recommendations: [binding()] }));
    renderWithQuery(<ContractEditor workspaceId="ws1" />, { signedIn: { readOnly: true } });
    suggest();
    expect(await screen.findByTestId('recommendations')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toHaveProperty('disabled', true);
  });

  it('reports an engine problem instead of an empty list', async () => {
    serveRecs(result({ source: 'error', error: 'lain unreachable' }));
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    suggest();
    expect(await screen.findByText(/LAIN error: lain unreachable/)).toBeTruthy();
  });
});
