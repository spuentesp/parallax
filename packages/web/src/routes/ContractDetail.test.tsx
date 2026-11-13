import { cleanup, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContractDetailDto } from '../api/hooks.js';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { fieldRows, provenanceOf } from './ContractDetail.js';

afterEach(cleanup);

const site = (path: string, line = 3) => ({ repo: 'saleor-dashboard', path, line });
const read = (field: string, confidence = 1, provenance = 'static') => ({
  field,
  confidence,
  provenance,
  site: site('src/q.ts'),
});
// Forma de la respuesta real de get_contract (graphql:query:exportFile de Saleor),
// ya normalizada por el servidor.
const dto = (over: Partial<ContractDetailDto> = {}): ContractDetailDto => ({
  source: 'lain',
  key: 'graphql:query:exportFile',
  service: 'saleor',
  kind: 'graphql query',
  providers: [{ repo: 'saleor', path: 'saleor/graphql/schema.graphql', line: 1219, symbol: null }],
  schemas: [
    {
      direction: 'response',
      fields: ['id', 'status', 'message', 'url'].map((name) => ({
        name,
        type: name === 'id' ? 'string' : 'unknown',
        nullable: name === 'message',
        required: name === 'id',
        enumValues: null,
      })),
    },
  ],
  consumers: [
    {
      repo: 'saleor-dashboard',
      caller: 'graphql-call:query:exportFile',
      site: site('src/containers/BackgroundTasks/queries.ts'),
      match: 'exact',
      confidence: 1,
      bindingKind: 'static',
      bindingSource: 'Regex',
      readsComplete: true,
      reads: [read('id'), read('status')],
    },
  ],
  ...over,
});

function mount(d: ContractDetailDto) {
  server.use(http.get('/api/workspaces/:id/contracts/detail', () => HttpResponse.json(d)));
  const router = createMemoryRouter(routes, {
    initialEntries: ['/orgs/ws1/contracts/detail?key=graphql%3Aquery%3AexportFile&service=saleor'],
  });
  renderWithQuery(<RouterProvider router={router} />);
}

describe('ContractDetail', () => {
  it('shows the provider, how many fields nobody reads, and who reads each field', async () => {
    mount(dto());
    expect(await screen.findByRole('heading', { name: 'exportFile' })).toBeTruthy();
    const provider = within(screen.getByRole('region', { name: 'Provider' }));
    expect(provider.getByText('saleor/graphql/schema.graphql:1219')).toBeTruthy();
    const contract = within(screen.getByRole('region', { name: 'Contract' }));
    expect(contract.getByText(/4 fields: 2 read by consumers/)).toBeTruthy();
    expect(contract.getByText('2').tagName).toBe('B');

    const fields = within(screen.getByRole('region', { name: 'Fields' }));
    const idRow = fields.getByText('id').closest('tr') as HTMLElement;
    expect(within(idRow).getByText('saleor-dashboard (1)')).toBeTruthy();
    expect(within(idRow).getByText('proven')).toBeTruthy();
    const messageRow = fields.getByText('message').closest('tr') as HTMLElement;
    expect(within(messageRow).getByText('no known reader')).toBeTruthy();
  });

  it('does not overstate: says when a consumer may read fields the engine did not see', async () => {
    const d = dto();
    const c = d.consumers[0] as ContractDetailDto['consumers'][number];
    mount({ ...d, consumers: [{ ...c, readsComplete: false }] });
    expect(
      await screen.findByText(/some consumers may read fields the engine did not see/),
    ).toBeTruthy();
  });

  it('a contract the engine has no schema for says so instead of inventing fields', async () => {
    mount(dto({ schemas: [] }));
    expect(await screen.findByText('The engine has no schema for this contract.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Fields' })).toBeNull();
  });

  it('"Trace impact" opens the end-to-end trace of this contract on the map', async () => {
    mount(dto());
    const link = await screen.findByRole('link', { name: 'Trace impact' });
    const url = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/orgs/ws1');
    expect(url.searchParams.get('trace')).toBe('graphql:query:exportFile');
    expect(url.searchParams.get('tservice')).toBe('saleor');
  });

  it('links to the assistant with the contract as the topic', async () => {
    mount(dto());
    const link = await screen.findByRole('link', { name: 'Ask about this' });
    expect(link.getAttribute('href')).toMatch(/^\/orgs\/ws1\?ask=.*exportFile/);
  });
});

describe('provenance and field cross-referencing', () => {
  it('proven means a static binding with full confidence; anything else is inferred with its score', () => {
    expect(provenanceOf({ bindingKind: 'static', confidence: 1 })).toEqual({
      proven: true,
      label: 'proven',
    });
    expect(provenanceOf({ bindingKind: 'static', confidence: 0.6 }).label).toBe('inferred 0.60');
    expect(provenanceOf({ bindingKind: 'heuristic', confidence: 1 }).proven).toBe(false);
  });
  it('a field is only "proven" read when every read of it is', () => {
    const d = dto();
    const c = d.consumers[0] as ContractDetailDto['consumers'][number];
    const rows = fieldRows({ ...d, consumers: [{ ...c, reads: [read('id', 0.5, 'heuristic')] }] });
    expect(rows.find((r) => r.name === 'id')?.readers[0]?.proven).toBe(false);
    expect(rows.find((r) => r.name === 'status')?.readers).toEqual([]);
  });
});
