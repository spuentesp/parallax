import { describe, expect, it } from 'vitest';
import { PARALLAX_VERSION } from '../src/index.js';

describe('@parallax/shared smoke', () => {
  it('exports a version string', () => {
    expect(PARALLAX_VERSION).toBe('0.1.0');
  });
});
