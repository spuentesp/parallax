import { describe, expect, it } from 'vitest';
import { ApplyContractContextArgs, TraceFlowArgs, TraceFlowResponse } from '../src/lain/tools.js';

describe('Lain 0.13 native tool contracts', () => {
  it('requires exactly one trace seed and applies native defaults', () => {
    const parsed = TraceFlowArgs.parse({ from: { symbol: 'getOrder' } });
    expect(parsed).toMatchObject({ snapshot: 'live', strategy: 'breadth' });
    expect(TraceFlowArgs.safeParse({ from: {} }).success).toBe(false);
    expect(TraceFlowArgs.safeParse({ from: { symbol: 'getOrder', table: 'orders' } }).success).toBe(
      false,
    );
  });

  it('validates native trace responses including provenance and gaps', () => {
    const parsed = TraceFlowResponse.parse({
      from: { symbol: 'getOrder' },
      direction: 'downstream',
      seeds: ['getOrder'],
      paths: [
        {
          min_confidence: 1,
          boundary_hops: 1,
          hops: [
            {
              id: 'n1',
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
      gaps: [],
      truncated: false,
      truncation_reasons: [],
      nodes_visited: 1,
      scope: { reviewed: [], unreviewed: [] },
    });
    expect(parsed.paths[0]?.hops[0]?.engine_fact).toBe(true);
  });

  it('defaults contract context to a live dry run and rejects empty declarations', () => {
    const parsed = ApplyContractContextArgs.parse({
      provides: [{ service: 'api', key: 'http:GET /orders' }],
    });
    expect(parsed).toMatchObject({ snapshot: 'live', dry_run: true });
    expect(ApplyContractContextArgs.safeParse({}).success).toBe(false);
  });
});
