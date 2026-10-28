import { describe, expect, it } from 'vitest';
import { LainCoverage, type RepoOmission, type Truncation } from '../src/lain/coverage.js';
import { LainEvidence, type LainEvidenceRef, paginate } from '../src/lain/evidence.js';
import { type Binding, LainChangeType, LainFinding, type Match } from '../src/lain/findings.js';

describe('lain findings', () => {
  it("LainChangeType enumerates the design's change kinds", () => {
    for (const k of [
      'FieldRemoved',
      'FieldAdded',
      'CompatibleChange',
      'FieldTypeChanged',
      'RouteRemoved',
      'RouteAdded',
      'RouteChanged',
    ] as const) {
      expect(LainChangeType.parse(k)).toBe(k);
    }
  });
  it('Binding has a kind and a confidence', () => {
    const b: Binding = { kind: 'confirmed', confidence: 0.95, source: 'openapi' };
    expect(b.kind).toBe('confirmed');
  });
  it('Match has a field and an evidence ref', () => {
    const m: Match = { field: 'customer_id', evidence: { repo: 'orders', sha: 'a' } };
    expect(m.field).toBe('customer_id');
  });
  it('LainFinding accepts all classification values', () => {
    for (const c of ['Verified', 'NeedsInvestigation', 'NoKnownImpact'] as const) {
      const f = LainFinding.parse({
        id: 'f1',
        change: { kind: 'FieldRemoved', service: 'orders', field: 'x' },
        classification: c,
        consumers: [],
      });
      expect(f.classification).toBe(c);
    }
  });
});

describe('lain coverage', () => {
  it('LainCoverage is a structured object, not a string', () => {
    const c = LainCoverage.parse({
      reviewed: ['orders'],
      omitted: [],
      truncated: [],
    });
    expect(c.reviewed).toEqual(['orders']);
  });
  it('RepoOmission requires repo and cause', () => {
    const o: RepoOmission = { repo: 'reports', cause: 'excluded-by-scope' };
    expect(o.cause).toBe('excluded-by-scope');
  });
  it('Truncation has surface', () => {
    const t: Truncation = { repo: 'orders', surface: 'diff_contracts' };
    expect(t.surface).toBe('diff_contracts');
  });
});

describe('lain evidence', () => {
  it('LainEvidenceRef is fully resolvable (repo + sha + path)', () => {
    const e: LainEvidenceRef = { repo: 'orders', sha: 'b5bf29a', path: 'src/main.rs' };
    expect(e.sha).toMatch(/[0-9a-f]{7,}/);
  });
  it('LainEvidence has view + ref', () => {
    const e = LainEvidence.parse({
      id: 'e1',
      view: 'snap_abc123',
      ref: { repo: 'orders', sha: 'b5bf29a', path: 'src/main.rs' },
    });
    expect(e.view).toBe('snap_abc123');
  });
  it('paginate slices a list and reports truncation', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const page1 = paginate(items, 0, 100);
    const _page2 = paginate(items, 100, 100);
    const page3 = paginate(items, 200, 100);
    expect(page1.items).toHaveLength(100);
    expect(page3.items).toHaveLength(50);
    expect(page3.truncated).toBe(false);
  });
  it('paginate reports truncated when more remains', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const page = paginate(items, 0, 100);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBe('100');
  });
});
