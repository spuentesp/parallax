// Límites de los argumentos de LAIN: cada cota numérica o de longitud se prueba
// en el valor aceptado y justo fuera de él. Un límite que se desplaza (p. ej.
// `max(1000)` leído como `max(1)`) tiene que romper un test, no pasar en silencio.
import { describe, expect, it } from 'vitest';
import {
  DiffContractsArgs,
  GetServiceArgs,
  ListServicesArgs,
  PrepareSnapshotArgs,
  ReadSourceArgs,
  ResolveEvidenceArgs,
  SnapshotId,
  TraceImpactArgs,
} from '../src/lain/tools.js';

const snap = 'snap_ab12';
const from = { endpoint: { key: 'http:GET /x', service: 'orders' } };
const trace = (extra: Record<string, unknown>) => ({ snapshot: snap, from, ...extra });

describe('limit (1..1000) on list tools', () => {
  it.each([1, 1000])('accepts %i', (limit) => {
    expect(ListServicesArgs.safeParse({ snapshot: snap, limit }).success).toBe(true);
  });

  it.each([0, 1001, 1.5])('rejects %s', (limit) => {
    expect(ListServicesArgs.safeParse({ snapshot: snap, limit }).success).toBe(false);
  });
});

describe('depth bounds', () => {
  it.each([1, 8])('GetServiceArgs accepts depth %i', (depth) => {
    expect(GetServiceArgs.safeParse({ snapshot: snap, service: 'a', depth }).success).toBe(true);
  });

  it.each([0, 9])('GetServiceArgs rejects depth %i', (depth) => {
    expect(GetServiceArgs.safeParse({ snapshot: snap, service: 'a', depth }).success).toBe(false);
  });

  it.each([1, 12])('TraceImpactArgs accepts depth %i', (depth) => {
    expect(TraceImpactArgs.safeParse(trace({ depth })).success).toBe(true);
  });

  it.each([0, 13])('TraceImpactArgs rejects depth %i', (depth) => {
    expect(TraceImpactArgs.safeParse(trace({ depth })).success).toBe(false);
  });
});

describe('cap bounds (1..500)', () => {
  it.each([1, 500])('DiffContractsArgs accepts cap %i', (cap) => {
    expect(DiffContractsArgs.safeParse({ base: snap, head: snap, cap }).success).toBe(true);
  });

  it.each([0, 501])('DiffContractsArgs rejects cap %i', (cap) => {
    expect(DiffContractsArgs.safeParse({ base: snap, head: snap, cap }).success).toBe(false);
  });
});

describe('wait_ms and max_base_age_s bounds', () => {
  it.each([0, 60000])('PrepareSnapshotArgs accepts wait_ms %i', (wait_ms) => {
    expect(PrepareSnapshotArgs.safeParse({ wait_ms }).success).toBe(true);
  });

  it.each([-1, 60001])('PrepareSnapshotArgs rejects wait_ms %i', (wait_ms) => {
    expect(PrepareSnapshotArgs.safeParse({ wait_ms }).success).toBe(false);
  });

  it('PrepareSnapshotArgs requires max_base_age_s >= 1', () => {
    expect(PrepareSnapshotArgs.safeParse({ max_base_age_s: 1 }).success).toBe(true);
    expect(PrepareSnapshotArgs.safeParse({ max_base_age_s: 0 }).success).toBe(false);
  });
});

describe('refs and context_lines bounds', () => {
  it('ResolveEvidenceArgs accepts 1 and 200 refs', () => {
    const one = { snapshot: snap, refs: ['r'] };
    const max = { snapshot: snap, refs: Array.from({ length: 200 }, (_, i) => `r${i}`) };
    expect(ResolveEvidenceArgs.safeParse(one).success).toBe(true);
    expect(ResolveEvidenceArgs.safeParse(max).success).toBe(true);
  });

  it('ResolveEvidenceArgs rejects 0 and 201 refs', () => {
    const none = { snapshot: snap, refs: [] };
    const over = { snapshot: snap, refs: Array.from({ length: 201 }, (_, i) => `r${i}`) };
    expect(ResolveEvidenceArgs.safeParse(none).success).toBe(false);
    expect(ResolveEvidenceArgs.safeParse(over).success).toBe(false);
  });

  it.each([0, 20])('ResolveEvidenceArgs accepts context_lines %i', (context_lines) => {
    expect(
      ResolveEvidenceArgs.safeParse({ snapshot: snap, refs: ['r'], context_lines }).success,
    ).toBe(true);
  });

  it.each([-1, 21])('ResolveEvidenceArgs rejects context_lines %i', (context_lines) => {
    expect(
      ResolveEvidenceArgs.safeParse({ snapshot: snap, refs: ['r'], context_lines }).success,
    ).toBe(false);
  });
});

describe('confidence bounds (0..1)', () => {
  it.each([0, 1])('TraceImpactArgs accepts min_confidence %i', (min_confidence) => {
    expect(TraceImpactArgs.safeParse(trace({ min_confidence })).success).toBe(true);
  });

  it.each([-0.01, 1.01])('TraceImpactArgs rejects min_confidence %s', (min_confidence) => {
    expect(TraceImpactArgs.safeParse(trace({ min_confidence })).success).toBe(false);
  });
});

describe('ReadSourceArgs line range', () => {
  it('accepts line 0 as the start of a range', () => {
    const args = { snapshot: snap, repo: 'r', path: 'p', start: 0, end: 0 };
    expect(ReadSourceArgs.safeParse(args).success).toBe(true);
  });

  it.each([
    { start: -1, end: 0 },
    { start: 0, end: -1 },
  ])('rejects negative lines %o', ({ start, end }) => {
    const args = { snapshot: snap, repo: 'r', path: 'p', start, end };
    expect(ReadSourceArgs.safeParse(args).success).toBe(false);
  });
});

describe('SnapshotId format', () => {
  it.each(['snap_0', 'snap_deadbeef'])('accepts %s', (id) => {
    expect(SnapshotId.safeParse(id).success).toBe(true);
  });

  it.each(['snap_', 'snap_XYZ', 'snap_ab12 ', 'xsnap_ab12', 'live', 'snap_ab12\n'])(
    'rejects %j',
    (id) => {
      expect(SnapshotId.safeParse(id).success).toBe(false);
    },
  );
});
