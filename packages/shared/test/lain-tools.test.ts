import { describe, expect, it } from 'vitest';
import {
  DiffContractsArgs,
  DiffContractsResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotResponse,
  ListServicesArgs,
  ListServicesResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  TraceImpactArgs,
  TraceImpactResponse,
} from '../src/lain/tools.js';

describe('lain tool schemas', () => {
  it('ListServices: requires snapshot, accepts repo/cursor/limit, rejects view', () => {
    expect(() => ListServicesArgs.parse({ snapshot: 'live' })).not.toThrow();
    expect(() => ListServicesArgs.parse({ snapshot: 'snap_0123456789abcdef' })).not.toThrow();
    expect(() => ListServicesArgs.parse({ snapshot: 'live', repo: 'orders' })).not.toThrow();
    expect(() => ListServicesArgs.parse({})).toThrow();
    expect(() => ListServicesArgs.parse({ view: 'live' })).toThrow();
    expect(() => ListServicesArgs.parse({ snapshot: 'live', nope: true })).toThrow();
  });

  it('ListServicesResponse: parses items with service and repo', () => {
    const r = ListServicesResponse.parse({
      items: [
        {
          service: 'orders',
          repo: 'orders',
          endpoints: 5,
          consumer_services: 1,
          unresolved_inbound: 0,
          paths: [],
        },
        {
          service: 'billing',
          repo: 'billing',
          endpoints: 2,
          consumer_services: 2,
          unresolved_inbound: 0,
          paths: [],
        },
      ],
      scope: {
        configured_only: true,
        reviewed: [
          { repo: 'orders', commit: 'b5bf29a', dirty: false },
          { repo: 'billing', commit: '9726517', dirty: false },
        ],
        unreviewed: [],
      },
    });
    expect(r.items).toHaveLength(2);
    expect(r.scope.reviewed).toHaveLength(2);
  });

  it('GetService: requires snapshot + service; consumers[] lists uses per consumer', () => {
    const r = GetServiceArgs.parse({ snapshot: 'live', service: 'orders' });
    expect(r.service).toBe('orders');
    expect(() => GetServiceArgs.parse({ snapshot: 'live' })).toThrow();

    const resp = GetServiceResponse.parse({
      service: 'orders',
      consumers: [
        {
          service: 'billing',
          repo: 'billing',
          uses: [
            {
              binding: { confidence: 1, kind: 'static', source: 'Regex' },
              endpoint: { key: 'graphql:query:orders', service: 'orders' },
              fields: ['customer_id'],
              match: 'exact',
            },
          ],
        },
      ],
      endpoints: ['graphql:query:orders'],
    });
    expect(resp.consumers[0]?.service).toBe('billing');
    expect(resp.consumers[0]?.uses[0]?.endpoint?.key).toBe('graphql:query:orders');
  });

  it('PrepareSnapshot: repos/exclude/from/max_base_age_s/configHash, none required', () => {
    expect(() => PrepareSnapshotArgs.parse({})).not.toThrow();
    expect(() =>
      PrepareSnapshotArgs.parse({
        repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' },
        exclude: ['reports'],
        max_base_age_s: 3600,
        configHash: 'ch_1',
      }),
    ).not.toThrow();
    expect(() => PrepareSnapshotArgs.parse({ from: 'live' })).toThrow();
    const r = PrepareSnapshotResponse.parse({
      snapshot: 'snap_abc',
      state: 'pending',
      created_unix: 1791952849,
    });
    expect(r.snapshot).toBe('snap_abc');
  });

  it('GetSnapshot: status pending|ready|failed', () => {
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'ready' }).state).toBe('ready');
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'pending' }).state).toBe('pending');
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'failed' }).state).toBe('failed');
    expect(() => GetSnapshotResponse.parse({ snapshot: 's1', status: 'oops' })).toThrow();
  });

  it('DiffContracts: base/head must be snap_ ids; returns changes[]', () => {
    const args = DiffContractsArgs.parse({ base: 'snap_deadbeef', head: 'snap_cafebabe' });
    expect(args.base).toBe('snap_deadbeef');
    expect(() => DiffContractsArgs.parse({ base: 'live', head: 'snap_cafebabe' })).toThrow();
    expect(() => DiffContractsArgs.parse({ base: 'snap_deadbeef' })).toThrow();

    const r = DiffContractsResponse.parse({
      changes: [{ kind: 'FieldRemoved', service: 'orders', field: 'customer_id' }],
      compatible_changes: 0,
    });
    expect(r.changes).toHaveLength(1);
    expect(r.compatible_changes).toBe(0);
  });

  it('TraceImpact: from needs one of endpoint/field/symbol; returns impact paths', () => {
    expect(() =>
      TraceImpactArgs.parse({
        snapshot: 'live',
        from: { endpoint: { key: 'http:GET /api/orders/me', service: 'orders' } },
      }),
    ).not.toThrow();
    expect(() => TraceImpactArgs.parse({ snapshot: 'live', from: {} })).toThrow();
    expect(() => TraceImpactArgs.parse({ snapshot: 'live' })).toThrow();

    const r = TraceImpactResponse.parse({
      paths: [
        {
          start: 'orders:Field:openapi.yaml:customer_id:27',
          min_confidence: 1,
          hops: [
            {
              edge: 'Calls',
              node: 'billing:Function:src/main.py:fetch_me:35',
              node_type: 'Function',
            },
          ],
        },
      ],
      truncated: false,
    });
    expect(r.paths[0]?.start).toContain('customer_id');
    expect(r.paths[0]?.hops[0]?.node_type).toBe('Function');
  });

  it('GetCoverage: complete flag plus the scope the view saw', () => {
    expect(() => GetCoverageArgs.parse({ snapshot: 'live' })).not.toThrow();
    expect(() =>
      GetCoverageArgs.parse({ snapshot: 'live', endpoint: { key: 'http:GET /x', service: 's' } }),
    ).not.toThrow();
    expect(() => GetCoverageArgs.parse({})).toThrow();

    const r = GetCoverageResponse.parse({
      complete: false,
      scope: {
        configured_only: true,
        reviewed: [{ repo: 'orders', commit: 'b5bf29a', dirty: false }],
        unreviewed: ['reports'],
      },
    });
    expect(r.complete).toBe(false);
    expect(r.scope?.unreviewed).toContain('reports');
  });

  it('ResolveEvidence: refs[] required, items report exists/snippet/reason', () => {
    const args = ResolveEvidenceArgs.parse({
      snapshot: 'live',
      refs: ['orders@b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf:src/main.rs:12'],
    });
    expect(args.refs).toHaveLength(1);
    expect(() => ResolveEvidenceArgs.parse({ snapshot: 'live' })).toThrow();
    expect(() => ResolveEvidenceArgs.parse({ snapshot: 'live', refs: [] })).toThrow();

    const r = ResolveEvidenceResponse.parse({
      items: [
        {
          exists: true,
          ref: 'orders@b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf:src/main.rs:12',
          snippet: 'fn main() {}',
        },
        { exists: false, ref: 'bogus', reason: 'malformed' },
      ],
    });
    expect(r.items[0]?.exists).toBe(true);
    expect(r.items[1]?.reason).toBe('malformed');
  });

  it('ReadSource: snapshot/repo/path/start/end in, text + range metadata out', () => {
    const args = ReadSourceArgs.parse({
      snapshot: 'live',
      repo: 'orders',
      path: 'src/main.rs',
      start: 1,
      end: 10,
    });
    expect(args.start).toBe(1);
    expect(() =>
      ReadSourceArgs.parse({ snapshot: 'live', repo: 'orders', path: 'src/main.rs' }),
    ).toThrow();

    const r = ReadSourceResponse.parse({
      text: 'fn main() {}',
      path: 'src/main.rs',
      start: 1,
      end: 10,
      commit: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
      total_lines: 42,
    });
    expect(r.text).toContain('fn main');
    expect(r.total_lines).toBe(42);
  });
});
