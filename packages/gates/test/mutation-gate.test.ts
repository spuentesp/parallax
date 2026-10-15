import { describe, expect, it } from 'vitest';
import {
  type AllowlistEntry,
  gateDecision,
  parseMutationReport,
  partitionRunnable,
  validateAllowlist,
} from '../src/mutation-gate.js';

const REPORT = {
  files: {
    'src/coverage.ts': {
      source: 'x',
      mutants: [
        {
          id: '1',
          mutatorName: 'BlockStatement',
          status: 'Survived',
          location: { start: { line: 68, column: 1 }, end: { line: 68, column: 5 } },
          description: 'block statement was removed',
        },
        {
          id: '2',
          mutatorName: 'EqualityOperator',
          status: 'Killed',
          location: { start: { line: 88, column: 3 }, end: { line: 88, column: 9 } },
        },
      ],
    },
  },
};

describe('parseMutationReport', () => {
  it('flattens the mutation-testing-report schema into summaries', () => {
    const mutants = parseMutationReport(REPORT);
    expect(mutants).toHaveLength(2);
    expect(mutants[0]).toEqual({
      file: 'src/coverage.ts',
      mutator: 'BlockStatement',
      line: 68,
      status: 'Survived',
      description: 'block statement was removed',
    });
  });

  it('returns an empty list for an empty or malformed report', () => {
    expect(parseMutationReport({})).toEqual([]);
    expect(parseMutationReport(null)).toEqual([]);
  });
});

describe('gateDecision', () => {
  const allowlist: AllowlistEntry[] = [
    {
      package: '@parallax/api',
      file: 'src/coverage.ts',
      mutator: 'BlockStatement',
      line: 68,
      reason: 'equivalent: filter redundancy covered by Task 4 property',
    },
  ];

  it('blocks Survived and NoCoverage mutants outside the allowlist', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, [], '@parallax/api');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
    expect(decision.allowlisted).toEqual([]);
  });

  it('moves allowlisted survivors out of the blocked set', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, allowlist, '@parallax/api');
    expect(decision.blocked).toEqual([]);
    expect(decision.allowlisted.map((m) => m.line)).toEqual([68]);
  });

  it('does not apply an allowlist entry to another package', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, allowlist, '@parallax/shared');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
  });

  it('ignores Killed mutants entirely', () => {
    const mutants = parseMutationReport(REPORT).filter((m) => m.status === 'Killed');
    expect(gateDecision(mutants, [], '@parallax/api').blocked).toEqual([]);
  });
});

describe('validateAllowlist', () => {
  it('rejects entries without a reason', () => {
    const problems = validateAllowlist([
      { package: '@parallax/api', file: 'src/a.ts', mutator: 'X', line: 1, reason: '' },
      { package: '@parallax/api', file: 'src/a.ts', mutator: 'X', line: 2, reason: '   ' },
    ]);
    expect(problems).toHaveLength(2);
  });

  it('accepts fully specified entries', () => {
    expect(validateAllowlist([])).toEqual([]);
  });
});

describe('partitionRunnable', () => {
  it('skips packages without a stryker config instead of crashing', () => {
    const byPackage = new Map([
      ['api', ['src/coverage.ts']],
      ['gates', ['src/mutation-gate.ts']],
    ]);
    const result = partitionRunnable(byPackage, new Set(['api']));
    expect([...result.runnable.keys()]).toEqual(['api']);
    expect(result.skipped).toEqual(['gates']);
  });

  it('returns everything as runnable when all packages are configured', () => {
    const byPackage = new Map([['shared', ['src/lain/evidence.ts']]]);
    const result = partitionRunnable(byPackage, new Set(['shared']));
    expect(result.skipped).toEqual([]);
    expect(result.runnable.get('shared')).toEqual(['src/lain/evidence.ts']);
  });
});
