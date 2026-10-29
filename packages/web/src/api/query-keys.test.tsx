// Las claves de caché separan los datos de cada workspace y no piden nada sin workspace.
// Dos observadores comparten un mismo QueryClient, como en la app real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { useCiSettings, useOpenPrs } from './hooks.js';

afterEach(() => {
  cleanup();
});

function PrCount({ orgId }: { orgId: string | undefined }) {
  const q = useOpenPrs(orgId);
  return <p>{q.data ? `prs:${q.data.prs.length}` : 'pending'}</p>;
}

function CiMode({ orgId }: { orgId: string | undefined }) {
  const q = useCiSettings(orgId);
  return <p>{q.data ? `mode:${q.data.mode}` : 'pending'}</p>;
}

const listing = (count: number) => ({
  prs: Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    url: `https://github.com/acme/shop/pull/${i + 1}`,
    title: 't',
    author: null,
    draft: false,
    baseRef: 'main',
    headRef: 'f',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    updatedAt: '2026-10-17T12:00:00Z',
    repo: 'https://github.com/acme/shop.git',
  })),
  skipped: [],
  errors: [],
  truncated: [],
});

describe('query keys', () => {
  it('keeps one workspace’s PR listing out of another workspace’s view', async () => {
    server.use(
      http.get('/api/workspaces/ws1/prs', () => HttpResponse.json(listing(1))),
      http.get('/api/workspaces/ws2/prs', () => HttpResponse.json(listing(2))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PrCount orgId="ws1" />
        <PrCount orgId="ws2" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('prs:1')).toBeTruthy());
    expect(await screen.findByText('prs:2')).toBeTruthy();
    expect(client.getQueryData(['open-prs', 'ws1'])).toMatchObject({ prs: [expect.anything()] });
    expect(client.getQueryData(['open-prs', 'ws2'])).toMatchObject({ prs: expect.any(Array) });
  });

  it('keeps CI settings separate per workspace', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.get('/api/workspaces/ws2/ci', () =>
        HttpResponse.json({ mode: 'on-open-and-update', baseBranch: null, reportComments: false }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CiMode orgId="ws1" />
        <CiMode orgId="ws2" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('mode:off')).toBeTruthy();
    expect(await screen.findByText('mode:on-open-and-update')).toBeTruthy();
  });

  it('does not request CI settings or PRs until a workspace is known', async () => {
    let requests = 0;
    server.use(
      http.get('*/ci', () => {
        requests += 1;
        return HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false });
      }),
      http.get('*/prs', () => {
        requests += 1;
        return HttpResponse.json(listing(0));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CiMode orgId={undefined} />
        <PrCount orgId={undefined} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toBe(0);
    expect(screen.getAllByText('pending')).toHaveLength(2);
  });
});
