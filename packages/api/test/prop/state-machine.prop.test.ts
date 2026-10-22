import { AssessmentStatus as SharedAssessmentStatus } from '@parallax/shared/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AssessmentStatus,
  canTransition,
  isTerminal,
  TRANSITIONS,
} from '../../src/worker/state.js';
import { arbStatus } from './arbitraries.js';
import { fcDefaults } from './harness.js';

const statuses = AssessmentStatus.options;

describe('state machine laws', () => {
  it('isTerminal(s) iff TRANSITIONS[s] has no exits', () => {
    for (const s of statuses) {
      expect(isTerminal(s)).toBe(TRANSITIONS[s].length === 0);
    }
  });

  it('no state transitions to itself and every target is a valid status', () => {
    fc.assert(
      fc.property(arbStatus, (s: (typeof statuses)[number]) => {
        expect(canTransition(s, s)).toBe(false);
        for (const target of TRANSITIONS[s]) {
          expect(statuses).toContain(target);
        }
      }),
      fcDefaults(),
    );
  });

  it('every non-terminal state reaches a terminal state (liveness)', () => {
    for (const s of statuses) {
      const seen = new Set<string>([s]);
      const queue = [...TRANSITIONS[s]];
      let reachesTerminal = isTerminal(s);
      while (queue.length > 0) {
        const next = queue.shift() as (typeof statuses)[number];
        if (isTerminal(next)) {
          reachesTerminal = true;
          break;
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(...TRANSITIONS[next]);
        }
      }
      expect(reachesTerminal).toBe(true);
    }
  });

  it('nothing transitions back into QUEUED (single entry state)', () => {
    for (const s of statuses) {
      expect(canTransition(s, 'QUEUED')).toBe(false);
    }
  });

  it('READY is only reachable through EXPLAINING', () => {
    for (const s of statuses) {
      if (s !== 'EXPLAINING') expect(canTransition(s, 'READY')).toBe(false);
    }
    expect(canTransition('EXPLAINING', 'READY')).toBe(true);
  });

  it('the documented happy path is a legal transition chain', () => {
    const chain = [
      ['QUEUED', 'SNAPSHOTTING'],
      ['SNAPSHOTTING', 'ANALYZING'],
      ['ANALYZING', 'EXPLAINING'],
      ['EXPLAINING', 'READY'],
    ] as const;
    for (const [from, to] of chain) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('shared and api AssessmentStatus enums define the same values', () => {
    expect([...SharedAssessmentStatus.options].sort()).toEqual(
      [...AssessmentStatus.options].sort(),
    );
  });
});
