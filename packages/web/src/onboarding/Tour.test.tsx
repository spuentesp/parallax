import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { BriefingDto } from '../api/hooks.js';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { CHAPTERS } from './chapters.js';

afterEach(cleanup);

const briefing: BriefingDto = {
  totals: { repos: 3, services: 3, contracts: 120, relations: 2 },
  repos: [
    {
      id: 'repo:saleor',
      name: 'saleor',
      lainRepoId: 'saleor',
      services: [
        {
          id: 'svc:saleor-api',
          name: 'saleor-api',
          contracts: 118,
          groups: [
            { key: 'gql-mutation', label: 'GraphQL mutations', count: 80 },
            { key: 'celery', label: 'Celery tasks', count: 30 },
            {
              key: 'http-methodless',
              label: 'HTTP patterns (no method)',
              count: 8,
              note: 'not real routes',
            },
          ],
        },
      ],
    },
    {
      id: 'repo:storefront',
      name: 'storefront',
      lainRepoId: null,
      services: [
        {
          id: 'svc:storefront',
          name: 'saleor-storefront',
          contracts: 2,
          groups: [{ key: 'http', label: 'HTTP routes', count: 2 }],
        },
      ],
    },
  ],
  relations: [
    {
      from: 'saleor-dashboard',
      to: 'saleor-api',
      uses: 593,
      deterministic: 593,
      inferred: 0,
      contractsUsed: 302,
    },
    {
      from: 'saleor-dashboard',
      to: 'saleor-storefront',
      uses: 8,
      deterministic: 0,
      inferred: 8,
      contractsUsed: 1,
    },
  ],
  hubs: [{ service: 'saleor-api', repo: 'saleor', consumerServices: 2, uses: 601 }],
  topOperations: [
    {
      key: 'graphql:query:products',
      service: 'saleor-api',
      group: 'GraphQL queries',
      uses: 26,
      consumers: 2,
    },
  ],
  gaps: [{ repo: 'storefront', reason: 'its code is not in the engine index' }],
};
const serveBriefing = (b: BriefingDto | null = briefing, meta: object = { source: 'lain' }) =>
  server.use(
    http.get('/api/workspaces/:id/map/briefing', () => HttpResponse.json({ briefing: b, meta })),
  );

const claims = {
  total: 0,
  verified: 0,
  contradicted: 0,
  unverifiable: 0,
  supported: 0,
  unsupported: 0,
};
function serveQuery(bodies: Array<Record<string, unknown>>) {
  server.use(
    http.post('/api/query', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({
        answer: `reply ${bodies.length}`,
        explanation_status: 'available',
        claims_summary: claims,
        map_focus: null,
        conversation: { id: 'c1', seq: bodies.length },
      });
    }),
  );
}

function mount() {
  const router = createMemoryRouter(routes, { initialEntries: ['/orgs/acme'] });
  renderWithQuery(<RouterProvider router={router} />);
  return router;
}
const startTour = async (role = 'Full-stack', task?: string) => {
  fireEvent.click(await screen.findByRole('button', { name: /take the guided tour/i }));
  fireEvent.click(screen.getByRole('button', { name: role }));
  if (task) fireEvent.change(screen.getByLabelText('My first task'), { target: { value: task } });
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
};
const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
const sentTask = (b: Record<string, unknown> | undefined) => String(b?.question ?? '');

describe('the guided tour', () => {
  it('is offered in an empty chat; setup asks for the role and the task, with a sensible default task', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /take the guided tour/i }));
    const setup = within(screen.getByTestId('tour-setup'));
    expect((setup.getByLabelText('My first task') as HTMLInputElement).value).toBe(
      'Add a delivery note to checkout',
    );
    expect(setup.getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Frontend', 'Backend', 'Full-stack', 'Start', 'Not now']),
    );
    fireEvent.click(setup.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('tour-setup')).toBeNull();
  });

  it('chapter 1 answers without any model call: what is here, from the map itself, and what it cannot see', async () => {
    serveBriefing();
    const bodies: Array<Record<string, unknown>> = [];
    serveQuery(bodies);
    mount();
    await startTour();
    const card = within(await screen.findByTestId('orient-card'));
    expect(card.getByText('3 repositories')).toBeTruthy();
    expect(card.getByText(/mostly graphql mutations \(80\)/i)).toBeTruthy();
    expect(card.getByText('saleor-api', { selector: 'b' }).textContent).toBe('saleor-api');
    expect(card.getByTestId('orient-gap').textContent).toMatch(
      /storefront.*not in the engine index/,
    );
    expect(bodies).toHaveLength(0);
    expect(screen.getByText('Chapter 1 · Orient')).toBeTruthy();
    // El estepper señala el capítulo actual.
    expect(screen.getByRole('button', { name: /1\. Orient/ }).getAttribute('aria-current')).toBe(
      'step',
    );
  });

  it('chapter 2 lists the doors by kind, who uses what, and flags a relation that is only inferred', async () => {
    serveBriefing();
    mount();
    await startTour();
    await screen.findByTestId('orient-card');
    next();
    const card = within(await screen.findByTestId('doors-card'));
    expect(
      card.getByText(/80 graphql mutations · 30 celery tasks · 8 http patterns \(no method\)/),
    ).toBeTruthy();
    expect(card.getByText(/593 uses across 302 contracts/)).toBeTruthy();
    expect(card.getByText(/8 only inferred: check it/)).toBeTruthy();
    expect(card.getByText(/graphql:query:products|query:products/)).toBeTruthy();
    // La explicación del grupo sin método: no son rutas reales.
    expect(card.getByText(/route-like strings nobody calls/)).toBeTruthy();
  });

  it('chapter 3 sends a scripted question that carries the task, aimed by role; the bubble is a short label, the prompt is one click away', async () => {
    serveBriefing();
    const bodies: Array<Record<string, unknown>> = [];
    serveQuery(bodies);
    mount();
    await startTour('Frontend', 'Add a delivery note to checkout');
    await screen.findByTestId('orient-card');
    next();
    await screen.findByTestId('doors-card');
    next();
    await waitFor(() => expect(bodies).toHaveLength(1));
    const q = sentTask(bodies[0]);
    expect(q).toMatch(/Add a delivery note to checkout/);
    expect(q).toMatch(/do not describe the workspace map/);
    expect(q).toMatch(/Start from the UI code/);
    expect(q).toMatch(/path:line .* and add a location claim/);
    // Un recién llegado con una función NUEVA necesita la más parecida que ya existe.
    expect(q).toMatch(/EXISTING request that is closest/);
    expect(await screen.findByText('Chapter 3 · Follow a request')).toBeTruthy();
    expect(await screen.findByText('reply 1')).toBeTruthy();
  });

  it('a backend role starts from the API operation instead', async () => {
    serveBriefing();
    const bodies: Array<Record<string, unknown>> = [];
    serveQuery(bodies);
    mount();
    await startTour('Backend');
    await screen.findByTestId('orient-card');
    next();
    await screen.findByTestId('doors-card');
    next();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentTask(bodies[0])).toMatch(/Start from the API operation and its resolver/);
  });

  it('the questions go through the normal path: the follow-up continues the same conversation', async () => {
    serveBriefing();
    const bodies: Array<Record<string, unknown>> = [];
    serveQuery(bodies);
    mount();
    await startTour();
    await screen.findByTestId('orient-card');
    next();
    await screen.findByTestId('doors-card');
    next();
    await screen.findByText('reply 1');
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.conversationId).toBe('c1');
  });

  it('the last chapter offers Finish; finishing marks it complete and keeps the conversation', async () => {
    serveBriefing();
    serveQuery([]);
    mount();
    await startTour();
    await screen.findByTestId('orient-card');
    for (let i = 1; i < CHAPTERS.length; i++) {
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: /^Next:|^Finish tour/ }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      if (i === CHAPTERS.length) break;
      next();
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: new RegExp(`^${i + 1}\\. `) })
            .getAttribute('aria-current'),
        ).toBe('step'),
      );
    }
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Finish tour' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish tour' }));
    expect((await screen.findByTestId('tour-done')).textContent).toMatch(/Tour complete/);
  });

  it('remembers where you were: reloading brings the stepper back at the same chapter, and leaving clears it', async () => {
    serveBriefing();
    mount();
    await startTour('Backend', 'Add an export button');
    await screen.findByTestId('orient-card');
    next();
    await screen.findByTestId('doors-card');
    cleanup();
    serveBriefing();
    mount();
    const bar = await screen.findByTestId('tour-bar');
    expect(bar.textContent).toMatch(/Backend/);
    expect(bar.textContent).toMatch(/Add an export button/);
    expect(
      within(bar)
        .getByRole('button', { name: /2\. The doors/ })
        .getAttribute('aria-current'),
    ).toBe('step');
    expect(within(bar).getByRole('button', { name: /1\. Orient/ }).textContent).toMatch(/✓/);
    fireEvent.click(within(bar).getByRole('button', { name: 'Leave tour' }));
    expect(screen.queryByTestId('tour-bar')).toBeNull();
    expect(await screen.findByRole('button', { name: /take the guided tour/i })).toBeTruthy();
  });

  it('while a question is being answered the stepper does not let you jump ahead', async () => {
    serveBriefing();
    server.use(http.post('/api/query', async () => new Promise(() => {})));
    mount();
    await startTour();
    await screen.findByTestId('orient-card');
    next();
    await screen.findByTestId('doors-card');
    next();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Next:/ }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByRole('button', { name: /1\. Orient/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('with no map (workspace without LAIN) the cards say so instead of inventing a description', async () => {
    serveBriefing(null, { source: 'unconfigured' });
    mount();
    await startTour();
    expect(await screen.findByText(/no LAIN server configured/i)).toBeTruthy();
  });

  describe('chapter 5 — what the team wrote down', () => {
    const docs = [
      {
        repo: 'saleor',
        path: 'AGENTS.md',
        kind: 'conventions',
        title: 'Saleor',
        summary: 'Deployment model.',
      },
      {
        repo: 'saleor',
        path: 'docs/adr/0004-race-safe.md',
        kind: 'decision',
        title: 'Balance adjustments must be race-safe',
        summary: 'Money movement can be concurrent.',
      },
      ...[1, 2, 3, 4, 5].map((i) => ({
        repo: 'saleor',
        path: `docs/adr/000${i}-x.md`,
        kind: 'decision',
        title: `ADR ${i}`,
        summary: '',
      })),
    ];
    const goToDocs = async () => {
      server.use(
        http.get('/api/workspaces/:id/docs', () => HttpResponse.json({ source: 'lain', docs })),
      );
      serveBriefing();
      mount();
      await startTour();
      await screen.findByTestId('orient-card');
      for (let i = 1; i < 5; i++) {
        await waitFor(() =>
          expect(
            (screen.getByRole('button', { name: /^Next:/ }) as HTMLButtonElement).disabled,
          ).toBe(false),
        );
        next();
      }
      return screen.findByTestId('docs-card');
    };

    it('lists the documents the repos carry, grouped by what they are for, with what each one says', async () => {
      serveQuery([]);
      const card = await goToDocs();
      expect(card.textContent).toMatch(/7 documents/);
      expect(within(card).getByText('Conventions for working here · 1')).toBeTruthy();
      expect(within(card).getByText(/Decisions \(ADRs\) · 6/)).toBeTruthy();
      expect(within(card).getByText('Money movement can be concurrent.')).toBeTruthy();
      // lo largo se pliega
      expect(within(card).queryByTestId('doc-docs/adr/0005-x.md')).toBeNull();
      fireEvent.click(within(card).getByRole('button', { name: 'Show all 6' }));
      expect(within(card).getByTestId('doc-docs/adr/0005-x.md')).toBeTruthy();
    });

    it('"Explain" asks the assistant to READ that file and tie it to the task, naming the repo and path', async () => {
      const bodies: Array<Record<string, unknown>> = [];
      serveQuery(bodies);
      const card = await goToDocs();
      fireEvent.click(
        within(within(card).getByTestId('doc-docs/adr/0004-race-safe.md')).getByRole('button', {
          name: 'Explain',
        }),
      );
      await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
      const q = sentTask(bodies.at(-1));
      expect(q).toMatch(
        /Read docs\/adr\/0004-race-safe\.md in the saleor repository with get_code_snippet/,
      );
      expect(q).toMatch(/Add a delivery note to checkout/);
      expect(q).toMatch(/documented/);
    });

    it('says plainly when the repos carry no documentation', async () => {
      server.use(
        http.get('/api/workspaces/:id/docs', () => HttpResponse.json({ source: 'lain', docs: [] })),
      );
      serveBriefing();
      mount();
      await startTour();
      await screen.findByTestId('orient-card');
      for (let i = 1; i < 5; i++) {
        await waitFor(() =>
          expect(
            (screen.getByRole('button', { name: /^Next:/ }) as HTMLButtonElement).disabled,
          ).toBe(false),
        );
        next();
      }
      expect((await screen.findByTestId('docs-card')).textContent).toMatch(
        /No documentation files were found/,
      );
    });
  });
});
