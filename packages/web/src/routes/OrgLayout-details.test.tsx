import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}

describe('legacy service URL', () => {
  it('redirects to the hub with the service selected and focused, url-encoded', async () => {
    const router = renderAt('/orgs/acme/services/orders%20api');
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme'));
    expect(router.state.location.search).toBe(
      '?focus=svc%3Aorders+api&hops=1&sel=svc%3Aorders+api',
    );
  });
  it('replaces the history entry instead of stacking a redirect', async () => {
    const router = renderAt('/orgs/acme/services/orders');
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/acme'));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('hub header and assistant', () => {
  it('the map page has no header of its own: the workspace name lives in the sidebar and the map fills the page', async () => {
    renderAt('/orgs/acme');
    expect(await screen.findByTestId('map-explorer')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('on the map the assistant is docked and open; it can be hidden and brought back from the edge tab', () => {
    renderAt('/orgs/acme');
    expect(screen.getByLabelText('Ask about your architecture')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask the architecture' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide assistant' }));
    expect(screen.queryByLabelText('Ask about your architecture')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the architecture' }));
    expect(screen.getByLabelText('Ask about your architecture')).toBeTruthy();
  });

  it('on the other sections it floats and starts closed; hiding it on the map does not open it there', async () => {
    const router = renderAt('/orgs/acme');
    fireEvent.click(screen.getByRole('button', { name: 'Hide assistant' }));
    await router.navigate('/orgs/acme/repos');
    const toggle = await screen.findByRole('button', { name: 'Ask the architecture' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Ask about your architecture')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Ask about your architecture')).toBeTruthy();
  });

  const ask = (text: string) => {
    fireEvent.change(screen.getByLabelText('Ask about your architecture'), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  it('shows the user question, then the answer with its status and verdicts', async () => {
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({
          answer: 'billing consumes orders.',
          explanation_status: 'failed:no_model_configured',
          claims_summary: {
            total: 1,
            verified: 1,
            contradicted: 0,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          claims: [
            {
              claim: {
                kind: 'relation',
                consumer: 'billing',
                provider: 'orders',
                polarity: 'present',
              },
              verdict: 'verified',
              reason: 'engine records 3 use(s)',
            },
          ],
          map_focus: null,
        }),
      ),
    );
    renderAt('/orgs/acme');
    ask('who?');
    expect(screen.getByText('who?')).toBeTruthy();
    expect(await screen.findByText('billing consumes orders.')).toBeTruthy();
    expect(screen.getByText('Explanation: failed:no_model_configured')).toBeTruthy();
    expect(screen.getByTestId('claims-summary').textContent).toMatch(/1 verified/);
    expect(screen.getByTestId('verdicts').textContent).toMatch(/billing → orders.*verified/);
  });

  it('an empty answer is said plainly, not left blank', async () => {
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({
          answer: '',
          explanation_status: 'complete',
          claims_summary: {
            total: 0,
            verified: 0,
            contradicted: 0,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          map_focus: null,
        }),
      ),
    );
    renderAt('/orgs/acme');
    ask('anything');
    expect(await screen.findByText('No answer was produced.')).toBeTruthy();
  });

  it('a failed request is reported with its reason', async () => {
    server.use(http.post('/api/query', () => HttpResponse.json({ code: 'Boom' }, { status: 502 })));
    renderAt('/orgs/acme');
    ask('anything');
    expect(await screen.findByText(/The question could not be answered: api 502/)).toBeTruthy();
  });

  it('"Show on map" rewrites the URL in place (no extra history) with focus, one hop and the selection', async () => {
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({
          answer: 'yes',
          explanation_status: 'complete',
          claims_summary: {
            total: 1,
            verified: 1,
            contradicted: 0,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          map_focus: { seed: 'svc:orders', ids: ['svc:orders'], relations: [], query: '' },
        }),
      ),
    );
    const router = renderAt('/orgs/acme?tab=x');
    ask('q');
    fireEvent.click(await screen.findByRole('button', { name: /show on map · 1 nodes/i }));
    await waitFor(() => expect(router.state.location.search).toContain('focus=svc%3Aorders'));
    const q = new URLSearchParams(router.state.location.search);
    expect([q.get('focus'), q.get('hops'), q.get('sel'), q.get('tab')]).toEqual([
      'svc:orders',
      '1',
      'svc:orders',
      'x',
    ]);
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
