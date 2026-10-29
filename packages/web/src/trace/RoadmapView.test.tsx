import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlastRadiusDto } from '../api/hooks.js';
import { AssistantDock } from '../components/AssistantDock.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { BlastView, RoadmapView } from './RoadmapView.js';

afterEach(cleanup);

it('links an assessment from chat to its report', () => {
  renderWithQuery(
    <MemoryRouter>
      <RoadmapView roadmap={{ kind: 'assessment', orgId: 'ws1', assessmentId: 'a1' }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Open assessment' }).getAttribute('href')).toBe(
    '/app/orgs/ws1/assessments/a1',
  );
});

const blast: BlastRadiusDto = {
  key: 'graphql:query:products',
  service: 'saleor-api',
  repo: 'saleor',
  direct: [
    {
      service: 'saleor-dashboard',
      repo: 'saleor-dashboard',
      uses: 26,
      provenance: 'deterministic',
      fields: ['id', 'name'],
      sites: [{ repo: 'saleor-dashboard', path: 'src/channels/queries.ts', line: 135 }],
    },
    {
      service: 'saleor-storefront',
      repo: 'storefront',
      uses: 2,
      provenance: 'inferred',
      fields: [],
      sites: [],
    },
  ],
  ripple: [{ service: 'extension', repo: null, via: 'saleor-dashboard', uses: 3 }],
  totalUses: 28,
  caveats: ['saleor-storefront is linked by inference: treat as probable.'],
};

describe('BlastView', () => {
  it('shows each affected service with its uses, provenance, fields and call sites, then the second ring and the caveat', () => {
    renderWithQuery(<BlastView blast={blast} />);
    expect(screen.getByText('2 services')).toBeTruthy();
    expect(screen.getByText('28 call sites')).toBeTruthy();
    const dash = screen.getByTestId('blast-saleor-dashboard').textContent ?? '';
    expect(dash).toMatch(/26 uses.*recorded by the engine/);
    expect(dash).toMatch(/reads: id, name/);
    expect(dash).toMatch(/saleor-dashboard:src\/channels\/queries\.ts:135/);
    expect(screen.getByTestId('blast-saleor-storefront').textContent).toMatch(/inferred/);
    expect(screen.getByTestId('blast-ripple').textContent).toMatch(
      /extension.*depends on saleor-dashboard \(3 uses\)/,
    );
    expect(screen.getByTestId('blast-caveat').textContent).toMatch(/treat as probable/);
  });
});

describe('the assistant draws the roadmap under the answer', () => {
  it('an impact answer shows the structured blast radius, not only prose', async () => {
    server.use(
      http.post('/api/query', () =>
        HttpResponse.json({
          answer: 'Changing graphql:query:products directly affects 2 services.',
          explanation_status: 'available',
          topology: { nodes: [], edges: [] },
          evidence: [],
          citations: { accepted: [], rejected: [] },
          budget: null,
          tool_calls: [],
          model: null,
          claims: [],
          claims_summary: {
            total: 0,
            verified: 0,
            contradicted: 0,
            unverifiable: 0,
            supported: 0,
            unsupported: 0,
          },
          map_focus: null,
          conversation: null,
          roadmap: { kind: 'blast', blast },
        }),
      ),
    );
    renderWithQuery(
      <MemoryRouter>
        <AssistantDock workspaceId="ws1" docked />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Ask about your architecture'), {
      target: { value: 'blast radius of products' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('blast-view')).toBeTruthy());
    expect(screen.getByText(/directly affects 2 services/)).toBeTruthy();
  });
});
