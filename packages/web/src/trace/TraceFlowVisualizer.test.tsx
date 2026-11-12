import { cleanup, fireEvent, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { TraceFlowVisualizer } from './TraceFlowVisualizer.js';

afterEach(() => cleanup());

const result = {
  from: { endpoint: { key: 'http:GET /orders', service: 'api' } },
  direction: 'downstream',
  seeds: ['http:GET /orders'],
  paths: [
    {
      min_confidence: 1,
      boundary_hops: 1,
      hops: [
        {
          id: 'handler',
          name: 'getOrder',
          node_type: 'Function',
          edge_type: null,
          engine_fact: true,
          repo: 'api',
          path: 'src/orders.ts',
          line: 4,
        },
      ],
    },
  ],
  gaps: [{ node: 'db', name: 'orders', kind: 'no_table_access', reason: 'no access indexed' }],
  truncated: false,
  truncation_reasons: [],
  nodes_visited: 1,
  scope: { reviewed: [], unreviewed: [] },
  strategy: 'depth',
};

describe('TraceFlowVisualizer', () => {
  it('runs the selected native strategy and renders real hops and gaps', async () => {
    const bodies: Array<{ strategy: string; depth: number }> = [];
    const capture = async (request: Request) => {
      const body = (await request.json()) as { strategy: string; depth: number };
      bodies.push(body);
      return HttpResponse.json(result);
    };
    server.use(
      http.post('/api/workspaces/ws1/trace/flow/stream', ({ request }) => capture(request)),
      http.post('/api/workspaces/ws1/trace/flow', ({ request }) => capture(request)),
    );
    renderWithQuery(
      <TraceFlowVisualizer
        workspaceId="ws1"
        contract={{ key: 'http:GET /orders', service: 'api' }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'depth' } });
    fireEvent.change(screen.getByLabelText('Max depth'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run native flow' }));

    expect(await screen.findByText('getOrder')).toBeTruthy();
    expect(screen.getByText('api:src/orders.ts:4')).toBeTruthy();
    expect(screen.getByText(/no access indexed/)).toBeTruthy();
    expect(screen.getByTestId('native-flow-stats').textContent).toContain('1 nodes visited');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ strategy: 'depth', depth: 4, snapshot: 'live' });
  });
});
