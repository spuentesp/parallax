import { describe, expect, it } from 'vitest';
import { evaluateDiff } from '../src/heldout-separation.js';

describe('evaluateDiff', () => {
  it('flags a changeset that touches both implementation and test-heldout', () => {
    const report = evaluateDiff([
      'packages/api/src/coverage.ts',
      'packages/api/test-heldout/lifecycle.heldout.test.ts',
    ]);
    expect(report.violation).toBe(true);
    expect(report.implFiles).toEqual(['packages/api/src/coverage.ts']);
    expect(report.heldoutFiles).toEqual(['packages/api/test-heldout/lifecycle.heldout.test.ts']);
  });

  it('allows held-out-only changesets (red-team PRs)', () => {
    const report = evaluateDiff([
      'packages/api/test-heldout/lifecycle.heldout.test.ts',
      'packages/shared/test-heldout/x.heldout.test.ts',
    ]);
    expect(report.violation).toBe(false);
  });

  it('allows implementation-only changesets (implementer PRs)', () => {
    const report = evaluateDiff([
      'packages/api/src/coverage.ts',
      'packages/api/test/prop/coverage.prop.test.ts',
    ]);
    expect(report.violation).toBe(false);
  });

  it('ignores docs, configs and unrelated paths', () => {
    const report = evaluateDiff(['docs/testing/red-team-protocol.md', 'package.json', 'README.md']);
    expect(report.violation).toBe(false);
    expect(report.implFiles).toEqual([]);
    expect(report.heldoutFiles).toEqual([]);
  });

  it('treats packages/gates/src as implementation (the guard is not self-exempt)', () => {
    const report = evaluateDiff([
      'packages/gates/src/heldout-separation.ts',
      'packages/api/test-heldout/x.heldout.test.ts',
    ]);
    expect(report.violation).toBe(true);
  });
});
