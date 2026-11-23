import { describe, expect, it } from 'vitest';
import { ApplyContractContextArgs, TraceFlowArgs, TraceFlowResponse } from '../src/lain/tools.js';

// Contratos del batch v0.15.0 de lain dev (b7fd2935), recapturados de
// tools/list del build de dev: los campos opcionales del motor no llevan
// defaults en el espejo (snapshot lo fija el despachante, no el schema).
describe('Lain dev (v0.15.0 batch) native tool contracts', () => {
  it('requires exactly one trace seed', () => {
    const parsed = TraceFlowArgs.parse({ snapshot: 'live', from: { symbol: 'getOrder' } });
    expect(parsed.from).toMatchObject({ symbol: 'getOrder' });
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
          hops: [{ id: 'n1', name: 'getOrder', node_type: 'Function', edge_type: null }],
        },
      ],
      gaps: [{ node: 'n2', name: 'checkout', kind: 'endpoint', reason: 'unreviewed repo' }],
      truncated: true,
      truncation_reasons: ['cap'],
      nodes_visited: 1,
    });
    expect(parsed.paths[0]?.hops[0]?.id).toBe('n1');
    expect(parsed.gaps[0]?.reason).toBe('unreviewed repo');
    // Los vacíos ausentes se normalizan a [] (un vacío sigue siendo un vacío).
    expect(TraceFlowResponse.parse({ from: {} }).paths).toEqual([]);
  });

  it('requires a live snapshot for contract context and accepts a dry run', () => {
    const parsed = ApplyContractContextArgs.parse({
      snapshot: 'live',
      provides: [{ service: 'api', key: 'http:GET /orders' }],
    });
    expect(parsed.dry_run).toBeUndefined();
    expect(ApplyContractContextArgs.safeParse({}).success).toBe(false);
    expect(ApplyContractContextArgs.safeParse({ snapshot: 'snap_abc', provides: [] }).success).toBe(
      false,
    );
  });
});
