import { arbSha, arbText } from '@parallax/shared/test/prop-arbitraries';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  detectClassificationConflicts,
  extractCitationRefs,
  serializeExplanation,
} from '../../src/agent/investigator.js';
import { fcDefaults } from './harness.js';

describe('extractCitationRefs properties', () => {
  it('never throws and never duplicates refs', () => {
    fc.assert(
      fc.property(arbText, fc.array(arbText, { maxLength: 4 }), (answer: string, delivered: string[]) => {
        const refs = extractCitationRefs(answer, delivered);
        expect(new Set(refs).size).toBe(refs.length);
      }),
      fcDefaults(),
    );
  });

  it('never invents a ref: every ref appears in the answer or in deliveredRefs', () => {
    fc.assert(
      fc.property(arbText, fc.array(arbSha, { maxLength: 3 }), (answer: string, delivered: string[]) => {
        const refs = extractCitationRefs(answer, delivered);
        for (const ref of refs) {
          expect(answer.includes(ref) || delivered.includes(ref)).toBe(true);
        }
      }),
      fcDefaults(),
    );
  });

  it('extracts delivered ids that appear verbatim in the answer', () => {
    fc.assert(
      fc.property(arbSha, arbText, arbText, (id: string, before: string, after: string) => {
        const answer = `${before} ${id} ${after}`;
        expect(extractCitationRefs(answer, [id])).toContain(id);
      }),
      fcDefaults(),
    );
  });
});

describe('serializeExplanation properties (INV 2)', () => {
  it('copies engine finding classes verbatim, never renames them', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.stringMatching(/^[a-z:/.-]{3,20}$/),
            service: fc.stringMatching(/^[a-z]{1,10}$/),
            class: fc.constantFrom('Verified', 'NeedsInvestigation', 'NoKnownImpact'),
          }),
          { maxLength: 4 },
        ),
        arbText,
        (
          findings: Array<{ key: string; service: string; class: string }>,
          answer: string,
        ) => {
          const engineFindings = findings.map((f) => ({
            endpoint: { key: f.key, service: f.service },
            impact: { class: f.class },
          }));
          const payload = serializeExplanation(
            {
              promptVersion: 'v1',
              effectiveModel: 'test-model',
              answer,
              citations: [],
              conflictingClaims: [],
              budget: { maxToolCalls: 8, toolCallsUsed: 0 },
              toolCallLog: [],
              modelLog: [],
              errors: [],
            } as never,
            { question: 'q', engineFindings },
          );
          expect(payload.engine_finding_classes.map((c) => c.class)).toEqual(
            findings.map((f) => f.class),
          );
          expect(payload.engine_finding_classes.map((c) => c.endpoint)).toEqual(
            findings.map((f) => f.key),
          );
        },
      ),
      fcDefaults(),
    );
  });

  it('drops malformed findings instead of inventing entries', () => {
    const payload = serializeExplanation(
      {
        promptVersion: 'v1',
        effectiveModel: 'm',
        answer: 'a',
        citations: [],
        conflictingClaims: [],
        budget: { maxToolCalls: 8, toolCallsUsed: 0 },
        toolCallLog: [],
        modelLog: [],
        errors: [],
      } as never,
      {
        question: 'q',
        engineFindings: [{}, { endpoint: {} }, { impact: { class: 'Verified' } }, null],
      },
    );
    expect(payload.engine_finding_classes).toEqual([]);
  });

  it('survives null entries in engineFindings', () => {
    expect(() =>
      detectClassificationConflicts('some answer', [null, {}, { endpoint: { key: 'k' } }]),
    ).not.toThrow();
  });
});

describe('detectClassificationConflicts properties', () => {
  it('reported conflicts never claim the engine class itself', () => {
    fc.assert(
      fc.property(arbText, arbText, (sentence: string, key: string) => {
        const answer = `${key} is definitely NoKnownImpact. ${sentence}`;
        const conflicts = detectClassificationConflicts(answer, [
          { endpoint: { key, service: 'svc' }, impact: { class: 'Verified' } },
        ]);
        for (const c of conflicts) {
          expect(c.claimedClass).not.toBe(c.engineClass);
        }
      }),
      fcDefaults(),
    );
  });
});
