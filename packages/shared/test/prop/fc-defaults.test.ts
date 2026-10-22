import { afterEach, describe, expect, it } from 'vitest';
import { fcDefaults } from './arbitraries.js';

const ORIGINAL_RUNS = process.env.FC_RUNS;
const ORIGINAL_SEED = process.env.FC_SEED;

afterEach(() => {
  if (ORIGINAL_RUNS === undefined) delete process.env.FC_RUNS;
  else process.env.FC_RUNS = ORIGINAL_RUNS;
  if (ORIGINAL_SEED === undefined) delete process.env.FC_SEED;
  else process.env.FC_SEED = ORIGINAL_SEED;
});

describe('fcDefaults', () => {
  it('honors FC_RUNS and FC_SEED for reproducible replays', () => {
    process.env.FC_RUNS = '7';
    process.env.FC_SEED = '42';
    expect(fcDefaults()).toEqual({ numRuns: 7, endOnFailure: true, seed: 42 });
  });

  it('omits seed unless FC_SEED is set, and lets callers override runs', () => {
    delete process.env.FC_RUNS;
    delete process.env.FC_SEED;
    expect(fcDefaults()).toEqual({ numRuns: 100, endOnFailure: true });
    expect(fcDefaults({ numRuns: 3 })).toEqual({ numRuns: 3, endOnFailure: true });
  });
});
