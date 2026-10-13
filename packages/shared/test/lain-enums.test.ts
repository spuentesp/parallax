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
    it('accepts snapshot:<id>', () => {
      expect(LainView.parse('snapshot:abc123')).toBe('snapshot:abc123');
    });
    it('rejects malformed snapshot ids', () => {
      expect(() => LainView.parse('snapshot:')).toThrow();
      expect(() => LainView.parse('live:something')).toThrow();
      expect(() => LainView.parse('snapshot')).toThrow();
    });
    it('infers the literal type for the snapshot variant', () => {
      const v: z.infer<typeof LainView> = 'snapshot:xyz';
      expect(v).toBe('snapshot:xyz');
    });
  });
});
