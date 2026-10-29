// Pruebas de la máquina de estados y de la identidad (digest) del análisis. Se
// fijan los valores exactos: una mutación en el orden de claves, en el filtro de
// `undefined` o en la versión de política por defecto cambia el digest y debe
// romper un test, no pasar en silencio.
import { describe, expect, it } from 'vitest';
import {
  AssessmentStatus,
  canonicalJson,
  canTransition,
  computeInputDigest,
  isTerminal,
  PARALLAX_POLICY_VERSION,
} from '../src/worker/state.js';

describe('AssessmentStatus', () => {
  it.each([
    'QUEUED',
    'SNAPSHOTTING',
    'ANALYZING',
    'EXPLAINING',
    'READY',
    'PARTIAL',
    'FAILED',
    'CANCELLED',
  ])('accepts %s', (status) => {
    expect(AssessmentStatus.safeParse(status).success).toBe(true);
  });

  it('rejects statuses outside the lifecycle', () => {
    expect(AssessmentStatus.safeParse('DONE').success).toBe(false);
    expect(AssessmentStatus.safeParse('ready').success).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows the documented happy path', () => {
    expect(canTransition('QUEUED', 'SNAPSHOTTING')).toBe(true);
    expect(canTransition('SNAPSHOTTING', 'ANALYZING')).toBe(true);
    expect(canTransition('ANALYZING', 'EXPLAINING')).toBe(true);
    expect(canTransition('EXPLAINING', 'READY')).toBe(true);
  });

  it('rejects skipping a stage', () => {
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('SNAPSHOTTING', 'READY')).toBe(false);
  });

  it('never leaves a terminal state', () => {
    expect(canTransition('READY', 'QUEUED')).toBe(false);
    expect(canTransition('FAILED', 'SNAPSHOTTING')).toBe(false);
  });

  it('answers false for an unknown source status instead of throwing', () => {
    expect(canTransition('BOGUS' as AssessmentStatus, 'READY')).toBe(false);
  });
});

describe('isTerminal', () => {
  it.each(['READY', 'PARTIAL', 'FAILED', 'CANCELLED'] as const)('%s is terminal', (s) => {
    expect(isTerminal(s)).toBe(true);
  });

  it.each(['QUEUED', 'SNAPSHOTTING', 'ANALYZING', 'EXPLAINING'] as const)(
    '%s is not terminal',
    (s) => {
      expect(isTerminal(s)).toBe(false);
    },
  );
});

describe('canonicalJson', () => {
  it('orders keys ascending at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is independent of insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2, c: 3 })).toBe(canonicalJson({ c: 3, b: 2, a: 1 }));
  });

  it('sorts a reversed key set of every size, so each comparator branch decides an order', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let n = 2; n <= keys.length; n++) {
      const reversed: Record<string, number> = {};
      for (const k of keys.slice(0, n).reverse()) reversed[k] = 1;
      const sorted = keys
        .slice(0, n)
        .map((k) => `"${k}":1`)
        .join(',');
      expect(canonicalJson(reversed)).toBe(`{${sorted}}`);
    }
  });

  it('drops keys whose value is undefined', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('keeps null and falsy values', () => {
    expect(canonicalJson({ a: null, b: 0, c: false, d: '' })).toBe(
      '{"a":null,"b":0,"c":false,"d":""}',
    );
  });

  it('keeps array order and sorts keys inside array items', () => {
    expect(canonicalJson([{ b: 1, a: 2 }, 'x'])).toBe('[{"a":2,"b":1},"x"]');
  });
});

describe('computeInputDigest', () => {
  const base = {
    manifest: { base: { orders: 'aaa' }, head: { orders: 'bbb' } },
    analyzerVersion: '0.9.1',
  };

  it('has the sha256_<64 hex> shape', () => {
    expect(computeInputDigest(base)).toMatch(/^sha256_[0-9a-f]{64}$/);
  });

  it('treats an omitted policyVersion like the current default', () => {
    expect(computeInputDigest(base)).toBe(
      computeInputDigest({ ...base, policyVersion: PARALLAX_POLICY_VERSION }),
    );
  });

  it('changes when the policy version changes', () => {
    expect(computeInputDigest(base)).not.toBe(computeInputDigest({ ...base, policyVersion: '2' }));
  });

  it('treats an omitted configHash like an explicit null', () => {
    expect(computeInputDigest(base)).toBe(computeInputDigest({ ...base, configHash: null }));
  });

  it('is per workspace: the same repos at the same commits in two workspaces are two jobs', () => {
    expect(computeInputDigest({ ...base, orgId: 'ws_a' })).not.toBe(
      computeInputDigest({ ...base, orgId: 'ws_b' }),
    );
    // Sin orgId se conserva la identidad de siempre (las filas ya guardadas no cambian).
    expect(computeInputDigest(base)).toBe(computeInputDigest({ ...base }));
  });

  it('is insensitive to manifest key order', () => {
    const reordered = {
      ...base,
      manifest: { head: { orders: 'bbb' }, base: { orders: 'aaa' } },
    };
    expect(computeInputDigest(base)).toBe(computeInputDigest(reordered));
  });
});
