import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationSummaryDto, TurnDto } from '../api/hooks.js';
import { turnsToMessages } from '../components/AssistantDock.js';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(cleanup);

const turn = (seq: number, over: Partial<TurnDto> = {}): TurnDto => ({
  seq,
  question: `question ${seq}`,
  answer: `answer ${seq}`,
  status: 'available',
  claims: [],
  focus: null,
  model: 'nemotron',
  createdAt: 1,
  ...over,
});
const summary = (id: string, title: string, turns = 1): ConversationSummaryDto => ({
  id,
  workspaceId: 'acme',
  title,
  createdAt: 1,
  updatedAt: 2,
  turns,
});
const claims = {
  total: 0,
  verified: 0,
  contradicted: 0,
  unverifiable: 0,
  supported: 0,
  unsupported: 0,
};

function mount(url = '/orgs/acme') {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}
const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Ask about your architecture'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Ask the architecture' }));

describe('turnsToMessages', () => {
  it('turns stored turns into the chat thread, with the engine verdict summary of each', () => {
    const msgs = turnsToMessages([
      turn(1, {
        claims: [
          {
            claim: { kind: 'relation', consumer: 'a', provider: 'b', polarity: 'present' },
            verdict: 'verified',
            reason: 'r',
          },
          {
            claim: { kind: 'relation', consumer: 'c', provider: 'b', polarity: 'absent' },
            verdict: 'contradicted',
            reason: 'r',
          },
        ],
        focus: { seed: 'svc:b', ids: ['svc:b'], relations: [], query: '' },
      }),
      turn(2, { answer: '' }),
    ]);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[0]?.content).toBe('question 1');
    expect(msgs[1]).toMatchObject({ content: 'answer 1', status: 'available' });
    expect(msgs[1]?.claims).toEqual({ ...claims, total: 2, verified: 1, contradicted: 1 });
    expect(msgs[1]?.focus?.seed).toBe('svc:b');
    expect(msgs[1]?.verdicts).toHaveLength(2);
    expect(msgs[3]?.content).toBe('No answer was produced.');
  });
});

describe('the assistant thread', () => {
  it('the first question starts a conversation (no id sent); the URL keeps it; the next question continues it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/query', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({
          answer: `reply ${bodies.length}`,
          explanation_status: 'available',
          claims_summary: claims,
          map_focus: null,
          conversation: { id: 'conv_1', seq: bodies.length },
        });
      }),
    );
    const router = mount();
    open();
    send('first');
    expect(await screen.findByText('reply 1')).toBeTruthy();
    expect(bodies[0]).toEqual({ question: 'first', orgId: 'acme' });
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('conv')).toBe('conv_1'),
    );
    send('second');
    expect(await screen.findByText('reply 2')).toBeTruthy();
    expect(bodies[1]).toEqual({ question: 'second', orgId: 'acme', conversationId: 'conv_1' });
  });

  it('opening a link with ?conv= brings the thread back, with the assistant already open', async () => {
    server.use(
      http.get('/api/conversations/:id', () =>
        HttpResponse.json({ conversation: summary('conv_9', 'x', 2), turns: [turn(1), turn(2)] }),
      ),
    );
    mount('/orgs/acme?conv=conv_9');
    expect(await screen.findByText('answer 2')).toBeTruthy();
    expect(screen.getByText('question 1')).toBeTruthy();
    expect(screen.getByText('answer 1')).toBeTruthy();
    expect(screen.getByLabelText('Ask about your architecture')).toBeTruthy();
  });

  it('a conversation that is gone says so, and the next question starts a new one', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/query', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          answer: 'ok',
          explanation_status: 'available',
          claims_summary: claims,
          map_focus: null,
          conversation: { id: 'conv_new', seq: 1 },
        });
      }),
    );
    mount('/orgs/acme?conv=conv_gone');
    open();
    expect((await screen.findByRole('status')).textContent).toMatch(/not available/i);
    send('hello');
    await screen.findByText('ok');
    expect(bodies[0]).toEqual({ question: 'hello', orgId: 'acme' });
  });

  it('lists earlier conversations; opening one loads its thread and marks it active', async () => {
    server.use(
      http.get('/api/conversations', () =>
        HttpResponse.json({
          conversations: [
            summary('c1', 'Who consumes orders?', 3),
            summary('c2', 'Checkout flow', 1),
          ],
        }),
      ),
      http.get('/api/conversations/:id', ({ params }) =>
        HttpResponse.json({
          conversation: summary(String(params.id), 't'),
          turns: [turn(1, { question: `Q of ${params.id}`, answer: `A of ${params.id}` })],
        }),
      ),
    );
    const router = mount();
    open();
    const list = within(await screen.findByTestId('conversation-list'));
    expect(screen.getByText('Earlier conversations (2)')).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /^Checkout flow/ }));
    expect(await screen.findByText('A of c2')).toBeTruthy();
    expect(new URLSearchParams(router.state.location.search).get('conv')).toBe('c2');
    expect(list.getByRole('button', { name: /^Checkout flow/ }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      list.getByRole('button', { name: /^Who consumes orders/ }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('New clears the thread and the URL; deleting the active conversation does too', async () => {
    let deleted: string | null = null;
    server.use(
      http.get('/api/conversations', () =>
        HttpResponse.json({ conversations: [summary('c1', 'Mine', 1)] }),
      ),
      http.get('/api/conversations/:id', () =>
        HttpResponse.json({ conversation: summary('c1', 'Mine'), turns: [turn(1)] }),
      ),
      http.delete('/api/conversations/:id', ({ params }) => {
        deleted = String(params.id);
        return HttpResponse.json({ deleted: true });
      }),
    );
    const router = mount('/orgs/acme?conv=c1');
    expect(await screen.findByText('answer 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect(screen.queryByText('answer 1')).toBeNull());
    expect(new URLSearchParams(router.state.location.search).get('conv')).toBeNull();

    fireEvent.click(
      within(screen.getByTestId('conversation-list')).getByRole('button', { name: /^Mine/ }),
    );
    expect(await screen.findByText('answer 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Mine' }));
    await waitFor(() => expect(deleted).toBe('c1'));
    await waitFor(() => expect(screen.queryByText('answer 1')).toBeNull());
    expect(new URLSearchParams(router.state.location.search).get('conv')).toBeNull();
  });

  it('the assistant is on every section of the workspace, and the thread continues when you change section', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/query', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          answer: `reply ${bodies.length}`,
          explanation_status: 'available',
          claims_summary: claims,
          map_focus: null,
          conversation: { id: 'conv_7', seq: bodies.length },
        });
      }),
    );
    const router = mount();
    open();
    send('on the map');
    expect(await screen.findByText('reply 1')).toBeTruthy();

    for (const section of ['repos', 'contracts', 'assessments']) {
      await router.navigate(`/orgs/acme/${section}`);
      expect(await screen.findByText('reply 1'), section).toBeTruthy();
      expect(screen.getByLabelText('Ask about your architecture'), section).toBeTruthy();
    }
    // La URL de esta sección ya no lleva ?conv=, pero el hilo sigue siendo el mismo.
    expect(new URLSearchParams(router.state.location.search).get('conv')).toBeNull();
    send('on assessments');
    expect(await screen.findByText('reply 2')).toBeTruthy();
    expect(bodies[1]).toEqual({
      question: 'on assessments',
      orgId: 'acme',
      conversationId: 'conv_7',
    });
  });
});
