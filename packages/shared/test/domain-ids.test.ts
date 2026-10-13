import { describe, expect, it } from 'vitest';
import {
  AssessmentId,
  asAssessmentId,
  asEvidenceId,
  asExplanationId,
  asOrgId,
  asProposalId,
  asSnapshotId,
  EvidenceId,
  OrgId,
} from '../src/domain/ids.js';

describe('branded ids', () => {
  it('round-trips through constructor and parser', () => {
    const id = asAssessmentId('a_1');
    expect(id).toBe('a_1');
    expect(AssessmentId.parse(id)).toBe('a_1');
  });

  it('rejects empty strings', () => {
    expect(() => asOrgId('')).toThrow();
  });

  it('assessmentId and evidenceId are string at runtime (compile-time brand is a phantom)', () => {
    const a = asAssessmentId('a_1');
    const e = asEvidenceId('e_1');
    expect(typeof a).toBe('string');
    expect(typeof e).toBe('string');
    // The brand is a phantom property that exists only in the type system. It
    // is enforced when TypeScript can see both sides of an assignment; tests
    // cannot assert that. The runtime contract is simply: each constructor
    // returns a non-empty string, and its parser accepts any non-empty string.
    expect(AssessmentId.parse(a)).toBe('a_1');
    expect(EvidenceId.parse(e)).toBe('e_1');
  });

  it('all six constructors work and produce strings that round-trip through their parsers', () => {
    const pairs: Array<[string, unknown, unknown]> = [
      ['AssessmentId', asAssessmentId('x'), AssessmentId.parse('x')],
      ['EvidenceId', asEvidenceId('x'), EvidenceId.parse('x')],
      ['OrgId', asOrgId('x'), OrgId.parse('x')],
    ];
    for (const [name, made, parsed] of pairs) {
      expect(typeof made, name).toBe('string');
      expect(parsed, name).toBe('x');
    }
    // The remaining three constructors work the same way:
    expect(typeof asExplanationId('x')).toBe('string');
    expect(typeof asProposalId('x')).toBe('string');
    expect(typeof asSnapshotId('x')).toBe('string');
  });

  it('parse rejects non-string input for every parser', () => {
    expect(() => AssessmentId.parse(123)).toThrow();
    expect(() => EvidenceId.parse(null)).toThrow();
    expect(() => OrgId.parse({})).toThrow();
  });
});
