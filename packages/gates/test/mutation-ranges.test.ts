import { describe, expect, it } from 'vitest';
import { changedLineRanges, fileOfSpec, mutationRangeSpec } from '../src/mutation-gate.js';

const diff = [
  'diff --git a/packages/api/src/a.ts b/packages/api/src/a.ts',
  'index 1111..2222 100644',
  '--- a/packages/api/src/a.ts',
  '+++ b/packages/api/src/a.ts',
  '@@ -10 +10 @@ const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '@@ -40,0 +41,3 @@ function f() {',
  '+  one();',
  '+  two();',
  '+  three();',
  '@@ -60,2 +62,0 @@',
  '-gone();',
  '-gone();',
  'diff --git a/packages/api/src/new.ts b/packages/api/src/new.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/packages/api/src/new.ts',
  '@@ -0,0 +1,4 @@',
  '+export const a = 1;',
].join('\n');

describe('changedLineRanges', () => {
  it('reads each added or modified hunk as its new-side line range', () => {
    const ranges = changedLineRanges(diff);
    expect(ranges.get('packages/api/src/a.ts')).toEqual([
      { start: 10, end: 10 },
      { start: 41, end: 43 },
    ]);
  });

  it('treats a new file as all of its lines', () => {
    expect(changedLineRanges(diff).get('packages/api/src/new.ts')).toEqual([{ start: 1, end: 4 }]);
  });

  it('keeps a file that only deletes lines, with no ranges to mutate', () => {
    const onlyDeletes = [
      'diff --git a/packages/api/src/d.ts b/packages/api/src/d.ts',
      '--- a/packages/api/src/d.ts',
      '+++ b/packages/api/src/d.ts',
      '@@ -3,2 +2,0 @@',
      '-a();',
      '-b();',
    ].join('\n');
    expect(changedLineRanges(onlyDeletes).get('packages/api/src/d.ts')).toEqual([]);
  });

  it('returns nothing for an empty diff', () => {
    expect(changedLineRanges('').size).toBe(0);
  });
});

describe('mutation range specs', () => {
  it('writes a file and an inclusive line range as a Stryker spec', () => {
    expect(mutationRangeSpec('src/a.ts', { start: 41, end: 43 })).toBe('src/a.ts:41-43');
  });

  it('recovers the file from a spec', () => {
    expect(fileOfSpec('src/a.ts:41-43')).toBe('src/a.ts');
  });
});
