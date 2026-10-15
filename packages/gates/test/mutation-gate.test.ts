import { describe, expect, it } from 'vitest';
import {
  type AllowlistEntry,
  findStaleEntries,
  gateDecision,
  parseAllowlistFile,
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
      description: 'block statement was removed',
      reason: 'equivalent: filter redundancy covered by the coverage property',
    },
  ];

  it('blocks Survived and NoCoverage mutants outside the allowlist', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, [], '@parallax/api');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
    expect(decision.allowlisted).toEqual([]);
  });

  it('matches by file+mutator+description so line shifts do not un-allowlist', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, allowlist, '@parallax/api');
    expect(decision.blocked).toEqual([]);
    expect(decision.allowlisted.map((m) => m.line)).toEqual([68]);
  });

  it('does not match the same file and mutator with a different description', () => {
    const mutants = parseMutationReport(REPORT);
    const wrongDescription: AllowlistEntry[] = [
      {
        package: '@parallax/api',
        file: 'src/coverage.ts',
        mutator: 'BlockStatement',
        description: 'something else',
        reason: 'equivalent',
      },
    ];
    const decision = gateDecision(mutants, wrongDescription, '@parallax/api');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
    expect(decision.allowlisted).toEqual([]);
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

describe('findStaleEntries', () => {
  it('reports allowlist entries that matched nothing in the run', () => {
    const mutants = parseMutationReport(REPORT);
    const stale = findStaleEntries(
      [
        {
          package: '@parallax/api',
          file: 'src/coverage.ts',
          mutator: 'BlockStatement',
          description: 'block statement was removed',
          reason: 'equivalent',
        },
        {
          package: '@parallax/api',
          file: 'src/gone.ts',
          mutator: 'BlockStatement',
          description: 'from a deleted file',
          reason: 'equivalent',
        },
      ],
      mutants,
      '@parallax/api',
    );
    expect(stale.map((e) => e.file)).toEqual(['src/gone.ts']);
  });
});

describe('validateAllowlist', () => {
  it('rejects entries without a reason or without a description', () => {
    const problems = validateAllowlist([
      {
        package: '@parallax/api',
        file: 'src/a.ts',
        mutator: 'X',
        description: 'd',
        reason: '',
      },
      {
        package: '@parallax/api',
        file: 'src/a.ts',
        mutator: 'X',
        description: '  ',
        reason: 'equivalent',
      },
    ]);
    expect(problems).toHaveLength(2);
  });

  it('accepts fully specified entries', () => {
    expect(validateAllowlist([])).toEqual([]);
  });
});

describe('parseAllowlistFile', () => {
  it('parses a well-formed allowlist', () => {
    const parsed = parseAllowlistFile('{"entries": []}');
    expect(parsed).toEqual({ ok: true, entries: [] });
  });

  it('returns a clean error for malformed JSON instead of throwing', () => {
    const parsed = parseAllowlistFile('{not json');
    expect(parsed.ok).toBe(false);
  });

  it('returns a clean error when the entries key is missing', () => {
    const parsed = parseAllowlistFile('{}');
    expect(parsed.ok).toBe(false);
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
