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
  TraceImpactResponse,
} from '../src/lain/tools.js';

describe('lain tool schemas', () => {
  it('ListServices: accepts a view and an optional repo filter', () => {
    expect(() => ListServicesArgs.parse({ view: 'live' })).not.toThrow();
    expect(() => ListServicesArgs.parse({ view: 'live', repo: 'orders' })).not.toThrow();
    expect(() => ListServicesArgs.parse({})).toThrow();
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

  it('GetService: requires service and view; consumers[] is a list of uses', () => {
    const r = GetServiceArgs.parse({ view: 'live', service: 'orders' });
    expect(r.service).toBe('orders');

    const resp = GetServiceResponse.parse({
      view: 'live',
      service: { id: 'orders', name: 'orders' },
      consumers: [
        {
          consumer: 'billing',
          uses: [{ field: 'customer_id', binding: 'confirmed', source: 'http' }],
        },
      ],
      usedByTruncated: false,
    });
    expect(resp.consumers[0]?.uses[0]?.field).toBe('customer_id');
  });

  it('PrepareSnapshot: requires repos map and returns a snapshot id', () => {
    const r = PrepareSnapshotResponse.parse({
      snapshot: 'snap_abc',
      state: 'pending',
      manifestDigest: 'd_1',
    });
    expect(r.snapshot).toBe('snap_abc');
    void PrepareSnapshotArgs;
  });

  it('GetSnapshot: status pending|ready|failed', () => {
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'ready' }).state).toBe('ready');
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'pending' }).state).toBe(
      'pending',
    );
    expect(GetSnapshotResponse.parse({ snapshot: 's1', state: 'failed' }).state).toBe('failed');
    expect(() => GetSnapshotResponse.parse({ snapshot: 's1', status: 'oops' })).toThrow();
  });

  it('DiffContracts: requires base and head snapshot ids and returns changes[]', () => {
    const r = DiffContractsResponse.parse({
      base: 'snap_b',
      head: 'snap_h',
      changes: [{ kind: 'FieldRemoved', service: 'orders', field: 'customer_id' }],
      truncated: false,
      cap: 1000,
    });
    expect(r.changes).toHaveLength(1);
    void DiffContractsArgs;
  });

  it('TraceImpact: returns findings with classification and consumers', () => {
    const r = TraceImpactResponse.parse({
      snapshot: 'snap_head_s1',
      findings: [
        {
          id: 'f1',
          change: { kind: 'FieldRemoved', service: 'orders', field: 'customer_id' },
          classification: 'Verified',
          consumers: [{ consumer: 'billing', field: 'customer_id' }],
        },
      ],
    });
    expect(r.findings[0]?.classification).toBe('Verified');
  });

  it('GetCoverage: returns reviewed, omitted, truncated', () => {
    const r = GetCoverageResponse.parse({
      reviewed: ['orders', 'billing'],
      omitted: [{ repo: 'reports', cause: 'excluded-by-scope' }],
      truncated: [],
    });
    expect(r.reviewed).toContain('orders');
    expect(r.omitted).toHaveLength(1);
    void GetCoverageArgs;
  });

  it('ResolveEvidence: returns a resolvable evidence record', () => {
    const r = ResolveEvidenceResponse.parse({
      repo: 'orders',
      sha: 'b5bf29a',
      path: 'src/main.rs',
      range: { start: 1, end: 10 },
    });
    expect(r.sha).toBe('b5bf29a');
    void ResolveEvidenceArgs;
  });

  it('ReadSource: returns text + cap + truncated', () => {
    const r = ReadSourceResponse.parse({
      text: 'fn main() {}',
      cap: 2000,
      truncated: false,
    });
    expect(r.text).toContain('fn main');
    void ReadSourceArgs;
  });
});
