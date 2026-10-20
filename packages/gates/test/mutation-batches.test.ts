import { describe, expect, it } from 'vitest';
import { batchCacheKey, chunk } from '../src/mutation-gate.js';

describe('chunk', () => {
  it('splits items into batches of at most size, keeping order', () => {
    expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('returns no batches for no items', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('keeps a list shorter than size in one batch', () => {
    expect(chunk(['a'], 6)).toEqual([['a']]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a batch size of %s', (size) => {
    expect(() => chunk(['a'], size)).toThrow(RangeError);
  });
});

describe('batchCacheKey', () => {
  const inputs = { packageTree: 'tree1', lockfiles: 'lock1', files: ['src/a.ts', 'src/b.ts'] };

  it('is stable for the same inputs', () => {
    expect(batchCacheKey(inputs)).toBe(batchCacheKey({ ...inputs }));
  });

  it('does not depend on the order of the batch files', () => {
    expect(batchCacheKey(inputs)).toBe(
      batchCacheKey({ ...inputs, files: ['src/b.ts', 'src/a.ts'] }),
    );
  });

  it('changes when the package tree changes', () => {
    expect(batchCacheKey(inputs)).not.toBe(batchCacheKey({ ...inputs, packageTree: 'tree2' }));
  });

  it('changes when the lockfiles change', () => {
    expect(batchCacheKey(inputs)).not.toBe(batchCacheKey({ ...inputs, lockfiles: 'lock2' }));
  });

  it('changes when the batch membership changes', () => {
    expect(batchCacheKey(inputs)).not.toBe(batchCacheKey({ ...inputs, files: ['src/a.ts'] }));
  });
});
