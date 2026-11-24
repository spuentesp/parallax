import { act, cleanup, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

// ?ask= hands a question to the assistant. A repeat of the same ?ask= right after (a stale
// setSearchParams snapshot putting it back when ?conv= arrives) must not send it again,
// but asking the same thing again later is a new question.
describe('assistant: question handed over by ?ask=', () => {
  const asked: string[] = [];
  beforeEach(() => {
    asked.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    server.use(
      http.post('/api/query', async ({ request }) => {
        asked.push(((await request.json()) as { question: string }).question);
        return HttpResponse.json({ answer: 'ok', claims: [], status: 'ok', conversationId: 'c1' });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const open = (url: string) => {
    const router = createMemoryRouter(routes, { initialEntries: [url] });
    renderWithQuery(<RouterProvider router={router} />);
    return router;
  };

  it('sends once even if ?ask= is put back with the same question', async () => {
    const router = open('/orgs/acme?ask=Where%20are%20the%20loose%20ends%3F');
    await waitFor(() => expect(asked).toHaveLength(1));
    await act(async () => {
      await router.navigate('/orgs/acme?ask=Where%20are%20the%20loose%20ends%3F', {
        replace: true,
      });
    });
    await waitFor(() => expect(router.state.location.search).not.toContain('ask='));
    expect(asked).toHaveLength(1);
  });

  it('sends the same question again once the window has passed', async () => {
    const router = open('/orgs/acme?ask=Where%20are%20the%20loose%20ends%3F');
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() => expect(router.state.location.search).not.toContain('ask='));
    vi.setSystemTime(Date.now() + 61_000);
    await act(async () => {
      await router.navigate('/orgs/acme?ask=Where%20are%20the%20loose%20ends%3F');
    });
    await waitFor(() => expect(asked).toHaveLength(2));
  });

  it('does not send again when a slow answer (longer than the window) brings ?conv= back', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.post('/api/query', async ({ request }) => {
        asked.push(((await request.json()) as { question: string }).question);
        await gate;
        return HttpResponse.json({
          answer: 'ok',
          claims: [],
          status: 'ok',
          conversation: { id: 'c1' },
        });
      }),
    );
    const router = open('/orgs/acme?ask=Where%20are%20the%20loose%20ends%3F');
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() => expect(router.state.location.search).not.toContain('ask='));
    vi.setSystemTime(Date.now() + 90_000);
    release();
    await waitFor(() => expect(router.state.location.search).toContain('conv=c1'));
    expect(router.state.location.search).not.toContain('ask=');
    expect(asked).toHaveLength(1);
  });
});
