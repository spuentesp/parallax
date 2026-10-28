import { describe, expect, it } from 'vitest';
import {
  type AllowlistEntry,
  findStaleEntries,
  gateDecision,
  isMutableSourceFile,
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

describe('isMutableSourceFile', () => {
  it('picks up production .ts and .tsx sources and nothing else', () => {
    expect(isMutableSourceFile('packages/api/src/coverage.ts')).toBe(true);
    expect(isMutableSourceFile('packages/web/src/routes/OrgLayout.tsx')).toBe(true);
  });

  it('skips tests, type declarations and non-source paths', () => {
    expect(isMutableSourceFile('packages/web/src/routes/demo-flow.test.tsx')).toBe(false);
    expect(isMutableSourceFile('packages/api/src/coverage.test.ts')).toBe(false);
    expect(isMutableSourceFile('packages/shared/src/lain/shapes.spec.ts')).toBe(false);
    expect(isMutableSourceFile('packages/shared/src/types.d.ts')).toBe(false);
    expect(isMutableSourceFile('packages/web/src/test/render.tsx')).toBe(false);
    expect(isMutableSourceFile('packages/gates/test/mutation-gate.test.ts')).toBe(false);
    expect(isMutableSourceFile('docs/testing/red-team-protocol.md')).toBe(false);
  });
});

describe('parseMutationReport (edges)', () => {
  it('defaults missing fields and ignores entries with no mutants list', () => {
    const mutants = parseMutationReport({
      files: {
        'src/a.ts': { mutants: [{ location: {} }, { location: { start: {} } }, {}] },
        'src/b.ts': {},
      },
    });
    expect(mutants).toEqual([
      { file: 'src/a.ts', mutator: '', line: 0, status: 'Unknown', description: '' },
      { file: 'src/a.ts', mutator: '', line: 0, status: 'Unknown', description: '' },
      { file: 'src/a.ts', mutator: '', line: 0, status: 'Unknown', description: '' },
    ]);
  });

  it('uses the replacement text as identity when the tool reports no description', () => {
    const mutants = parseMutationReport({
      files: {
        'src/a.ts': {
          mutants: [
            {
              mutatorName: 'BlockStatement',
              status: 'NoCoverage',
              location: { start: { line: 7 } },
              replacement: '{}',
            },
          ],
        },
      },
    });
    expect(mutants).toEqual([
      {
        file: 'src/a.ts',
        mutator: 'BlockStatement',
        line: 7,
        status: 'NoCoverage',
        description: '{}',
      },
    ]);

    const decision = gateDecision(
      mutants,
      [
        {
          package: '@parallax/mcp',
          file: 'src/a.ts',
          mutator: 'BlockStatement',
          description: '{}',
          reason:
            'wiring pinned by a subprocess smoke; child-process coverage is invisible to stryker',
        },
      ],
      '@parallax/mcp',
    );
    expect(decision.blocked).toEqual([]);
    expect(decision.allowlisted).toEqual(mutants);
  });
});

describe('gateDecision (matching)', () => {
  const mutant = {
    file: 'src/coverage.ts',
    mutator: 'BlockStatement',
    line: 68,
    status: 'Survived',
    description: 'block statement was removed',
  };

  it('does not allowlist a hit that differs in file or mutator', () => {
    const wrongFile: AllowlistEntry[] = [
      {
        package: '@parallax/api',
        file: 'src/other.ts',
        mutator: 'BlockStatement',
        description: 'block statement was removed',
        reason: 'equivalent',
      },
    ];
    const wrongMutator: AllowlistEntry[] = [
      {
        package: '@parallax/api',
        file: 'src/coverage.ts',
        mutator: 'Other',
        description: 'block statement was removed',
        reason: 'equivalent',
      },
    ];
    expect(gateDecision([mutant], wrongFile, '@parallax/api').blocked).toEqual([mutant]);
    expect(gateDecision([mutant], wrongMutator, '@parallax/api').blocked).toEqual([mutant]);
  });

  it('blocks NoCoverage mutants just like Survived ones', () => {
    const uncovered = { ...mutant, line: 7, status: 'NoCoverage' };
    const decision = gateDecision([uncovered], [], '@parallax/api');
    expect(decision.blocked).toEqual([uncovered]);
  });
});

describe('findStaleEntries (scoping)', () => {
  it('never reports entries of another package as stale', () => {
    const mutants = parseMutationReport(REPORT);
    const stale = findStaleEntries(
      [
        {
          package: '@parallax/shared',
          file: 'src/gone.ts',
          mutator: 'BlockStatement',
          description: 'from elsewhere',
          reason: 'equivalent',
        },
      ],
      mutants,
      '@parallax/api',
    );
    expect(stale).toEqual([]);
  });
});

describe('parseAllowlistFile (messages)', () => {
  it('names the file and the missing key so a human can fix the entry', () => {
    const badJson = parseAllowlistFile('{not json');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.error).toContain('mutation-allowlist.json is not valid JSON');

    const missing = parseAllowlistFile('{}');
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.error).toBe('mutation-allowlist.json must contain an "entries" array');
  });
});

describe('validateAllowlist (whitespace)', () => {
  it('treats whitespace-only justification as empty and says which field', () => {
    const problems = validateAllowlist([
      {
        package: '@parallax/api',
        file: 'src/a.ts',
        mutator: 'X',
        description: 'd',
        reason: '   ',
      },
      {
        package: '@parallax/api',
        file: 'src/b.ts',
        mutator: 'X',
        description: '  ',
        reason: 'equivalent',
      },
    ]);
    expect(problems).toEqual([
      'allowlist entry without reason: @parallax/api src/a.ts X',
      'allowlist entry without description: @parallax/api src/b.ts X',
    ]);
  });
});

describe('isMutableSourceFile (anchors)', () => {
  it('classifies by repo-relative shape, not by substrings anywhere in the path', () => {
    expect(isMutableSourceFile('docs/packages/api/src/a.ts')).toBe(false);
    expect(isMutableSourceFile('packages/api/src/report.ts.bak')).toBe(false);
    expect(isMutableSourceFile('packages/api/src/vendored/packages/gates/src/test/helper.ts')).toBe(
      true,
    );
    expect(isMutableSourceFile('packages/api/src/a.test.tsx.ts')).toBe(true);
    expect(isMutableSourceFile('packages/api/src/a.d.ts.ts')).toBe(true);
  });
});
