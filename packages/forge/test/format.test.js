// Tests for the panel's wording and colour rules.
import { describe, expect, it } from 'vitest';
import {
  countsLine,
  driftTone,
  expectedLine,
  prUrl,
  reachLine,
  statusLabel,
} from '../panel/src/format.js';

describe('expectedLine', () => {
  it('says when the ticket names nothing', () => {
    expect(expectedLine({ targets: 0 })).toMatch(/names no service or endpoint/);
    expect(expectedLine(undefined)).toMatch(/names no service or endpoint/);
  });
  it('says all consumers are proven when they are', () => {
    expect(expectedLine({ targets: 2, consumers: 3, provenByCode: 3, inferredOnly: 0 })).toBe(
      'Names 2 things in the architecture · 3 consumers, all proven by code.',
    );
  });
  it('mixes proven and inferred and never hides the inferred ones', () => {
    expect(expectedLine({ targets: 1, consumers: 4, provenByCode: 1, inferredOnly: 3 })).toBe(
      'Names 1 thing in the architecture · 4 consumers, 1 proven by code · 3 inferred only.',
    );
  });
  it('says plainly when nothing depends on the named things', () => {
    expect(expectedLine({ targets: 1, consumers: 0, provenByCode: 0, inferredOnly: 0 })).toBe(
      'Names 1 thing in the architecture · nothing else depends on them.',
    );
  });
});

describe('driftTone', () => {
  const tone = (verdict, extra = {}) => driftTone({ verdict, ...extra });
  it('is good only when the PR did what the ticket said', () => {
    expect(tone('aligned')).toBe('good');
  });
  it('warns when the ticket and the PR disagree', () => {
    for (const v of ['wider-than-ticket', 'different', 'ticket-named-nothing']) {
      expect(tone(v)).toBe('warning');
    }
  });
  it('warns on high-risk code edits and only notices lower risk', () => {
    expect(tone('code-only', { codeChanges: { highestRisk: 'high' } })).toBe('warning');
    expect(tone('code-only', { codeChanges: { highestRisk: 'low' } })).toBe('notice');
  });
  it('is neutral with nothing to report, and for no drift at all', () => {
    expect(tone('pr-touched-no-contracts')).toBe('neutral');
    expect(driftTone(undefined)).toBe('neutral');
  });
});

describe('statusLabel', () => {
  it('never calls an incomplete analysis complete', () => {
    expect(statusLabel('READY', true)).toBe('Complete');
    expect(statusLabel('READY', false)).toBe('Ready, coverage incomplete');
    expect(statusLabel('PARTIAL', false)).toBe('Partial');
    expect(statusLabel(undefined)).toBe('Unknown');
  });
});

describe('countsLine', () => {
  it('lists only the classes that occur', () => {
    expect(countsLine({ verified: 0, needsInvestigation: 9, noKnownImpact: 0 })).toBe(
      '9 need investigation',
    );
    expect(countsLine({ verified: 2, needsInvestigation: 1, noKnownImpact: 4 })).toBe(
      '2 verified · 1 need investigation · 4 no known impact',
    );
  });
  it('says so when there are no contract findings', () => {
    expect(countsLine({ verified: 0, needsInvestigation: 0, noKnownImpact: 0 })).toBe(
      'no contract findings',
    );
    expect(countsLine(undefined)).toBe('no contract findings');
  });
});

describe('prUrl', () => {
  it('rebuilds the GitHub link from the stored reference', () => {
    expect(prUrl('NVIDIA/NemoClaw#13812')).toBe('https://github.com/NVIDIA/NemoClaw/pull/13812');
  });
  it('returns null for anything that is not a reference', () => {
    expect(prUrl('nonsense')).toBeNull();
    expect(prUrl(undefined)).toBeNull();
  });
});

describe('reachLine', () => {
  it('calls the reach of a proven finding consumers, with the repositories they live in', () => {
    expect(
      reachLine({
        class: 'Verified',
        affectedDistinct: 3,
        affectedByRepo: { NemoClaw: 2, 'NeMo-Fabric': 1 },
      }),
    ).toBe('3 consumers in NemoClaw, NeMo-Fabric');
    expect(reachLine({ class: 'Verified', affectedDistinct: 1, affectedByRepo: {} })).toBe(
      '1 consumer',
    );
  });
  it('does not call unresolved candidates consumers', () => {
    // Regression: "99 consumers" for a finding the engine could not bind overstated what is known.
    expect(
      reachLine({
        class: 'NeedsInvestigation',
        affectedDistinct: 99,
        affectedByRepo: { 'NeMo-Fabric': 40, NemoClaw: 59 },
      }),
    ).toBe('99 possible call sites in NeMo-Fabric, NemoClaw');
    expect(reachLine({ class: 'NeedsInvestigation', affectedDistinct: 1 })).toBe(
      '1 possible call site',
    );
  });
  it('says when there are none', () => {
    expect(reachLine({ affectedDistinct: 0 })).toBe('no consumers found');
    expect(reachLine(undefined)).toBe('no consumers found');
  });
});
