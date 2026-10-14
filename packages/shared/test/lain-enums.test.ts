import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { EdgeType, FindingClass, LainView } from '../src/lain/enums.js';

describe('lain enums', () => {
  describe('FindingClass', () => {
    it('accepts the three known classes', () => {
      for (const v of ['Verified', 'NeedsInvestigation', 'NoKnownImpact'] as const) {
        expect(FindingClass.parse(v)).toBe(v);
      }
    });
    it('rejects unknown classes', () => {
      expect(() => FindingClass.parse('Maybe')).toThrow();
    });
  });

  describe('EdgeType', () => {
    it('accepts confirmed and heuristic', () => {
      expect(EdgeType.parse('confirmed')).toBe('confirmed');
      expect(EdgeType.parse('heuristic')).toBe('heuristic');
    });
    it('rejects unknown types', () => {
      expect(() => EdgeType.parse('guessed')).toThrow();
    });
  });

  describe('LainView', () => {
    it('accepts live', () => {
      expect(LainView.parse('live')).toBe('live');
    });
    it('accepts snap_<hex> ids', () => {
      expect(LainView.parse('snap_25817a1b18dee5c6b29d745b5be7f7a1')).toBe(
        'snap_25817a1b18dee5c6b29d745b5be7f7a1',
      );
      expect(LainView.parse('snap_abc')).toBe('snap_abc');
    });
    it('rejects malformed snapshot ids', () => {
      expect(() => LainView.parse('snap_')).toThrow();
      expect(() => LainView.parse('snap_xyz')).toThrow();
      expect(() => LainView.parse('snapshot:abc123')).toThrow();
      expect(() => LainView.parse('live:something')).toThrow();
    });
    it('infers the snapshot variant', () => {
      const v: z.infer<typeof LainView> = 'snap_abc123';
      expect(v).toBe('snap_abc123');
    });
  });
});
