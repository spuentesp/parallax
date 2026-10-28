import { describe, expect, it } from 'vitest';
import { buildHistory, factsLedger, type StoredTurn } from '../src/conversation/history.js';

const rel = (
  consumer: string,
  provider: string,
  verdict: 'verified' | 'contradicted' | 'unverifiable' | 'supported' | 'unsupported',
  polarity: 'present' | 'absent' = 'present',
  uses?: number,
) => ({
  claim: { kind: 'relation' as const, consumer, provider, polarity },
  verdict,
  ...(uses !== undefined ? { engine: { uses, endpoints: [], complete: true } } : {}),
});
const turn = (seq: number, over: Partial<StoredTurn> = {}): StoredTurn => ({
  seq,
  question: `question ${seq}`,
  answer: `answer ${seq}`,
  status: 'available',
  claims: [],
  ...over,
});

describe('factsLedger', () => {
  it('writes one line per relation with the engine verdict and use count', () => {
    const l = factsLedger([
      turn(1, {
        claims: [
          rel('billing', 'orders', 'verified', 'present', 3),
          rel('reports', 'orders', 'contradicted', 'absent', 1),
        ],
      }),
    ]);
    expect(l).toEqual([
      'billing → orders: engine verified, 3 uses',
      'reports ↛ orders: engine contradicted, 1 uses',
    ]);
  });

  it('keeps the latest verdict for the same relation, and treats presence and absence as different claims', () => {
    const l = factsLedger([
      turn(1, { claims: [rel('a', 'b', 'unverifiable'), rel('a', 'b', 'verified', 'absent')] }),
      turn(2, { claims: [rel('a', 'b', 'verified', 'present', 2)] }),
    ]);
    // El orden es el de la primera vez que apareció la relación; el veredicto, el último.
    expect(l).toEqual(['a → b: engine verified, 2 uses', 'a ↛ b: engine verified']);
  });

  it('ignores notes and verdicts that are not about what the engine adjudicated', () => {
    const l = factsLedger([
      turn(1, {
        claims: [
          { claim: { kind: 'note', text: 'x', evidence: ['ev'] }, verdict: 'supported' },
          rel('a', 'b', 'supported'),
          rel('a', 'c', 'unsupported'),
        ],
      }),
    ]);
    expect(l).toEqual([]);
  });

  it('a contradicted claim stays visible as contradicted, never as a fact', () => {
    expect(factsLedger([turn(1, { claims: [rel('a', 'b', 'contradicted')] })])).toEqual([
      'a → b: engine contradicted',
    ]);
  });
});

describe('buildHistory', () => {
  it('has nothing to say for an empty conversation', () => {
    expect(buildHistory([])).toEqual({ recent: [], context: null });
  });

  it('gives the last N turns verbatim, in order, and no context while nothing is older', () => {
    const h = buildHistory([turn(3), turn(1), turn(2)], { verbatim: 4 });
    expect(h.recent.map((t) => t.question)).toEqual(['question 1', 'question 2', 'question 3']);
    expect(h.context).toBeNull();
  });

  it('older turns become one line each; the ledger spans every turn', () => {
    const turns = [
      turn(1, {
        question: 'What repos exist?',
        claims: [rel('web', 'api', 'verified', 'present', 5)],
      }),
      turn(2, { status: 'failed:model_timeout' }),
      turn(3),
      turn(4),
      turn(5),
      turn(6),
    ];
    const h = buildHistory(turns, { verbatim: 2 });
    expect(h.recent.map((t) => t.question)).toEqual(['question 5', 'question 6']);
    expect(h.context).toContain('web → api: engine verified, 5 uses');
    expect(h.context).toContain('- Q1: What repos exist? → 1 verified');
    expect(h.context).toContain('- Q2: question 2 → failed:model_timeout');
    expect(h.context).not.toContain('Q5');
    expect(h.context).toMatch(/context only/);
  });

  it('never carries the prose of old turns into the context', () => {
    const h = buildHistory([turn(1, { answer: 'SECRET PROSE' }), turn(2), turn(3)], {
      verbatim: 1,
    });
    expect(h.context).not.toContain('SECRET PROSE');
  });

  it('clips long answers and a long context', () => {
    const long = 'x'.repeat(5000);
    const h = buildHistory([turn(1, { answer: long })], { maxAnswerChars: 100 });
    expect(h.recent[0]?.answer).toHaveLength(100);
    expect(h.recent[0]?.answer.endsWith('…')).toBe(true);
    const many = Array.from({ length: 80 }, (_, i) => turn(i + 1, { question: 'q'.repeat(100) }));
    const c = buildHistory(many, { verbatim: 1, maxContextChars: 500 }).context ?? '';
    expect(c.length).toBeLessThanOrEqual(500);
  });

  it('collapses whitespace in old questions and clips them', () => {
    const h = buildHistory([turn(1, { question: `a\n\n  b ${'z'.repeat(300)}` }), turn(2)], {
      verbatim: 1,
    });
    const line = (h.context ?? '').split('\n').find((l) => l.startsWith('- Q1')) ?? '';
    expect(line).not.toContain('\n');
    expect(line).toContain('a b zzz');
    expect(line.length).toBeLessThan(160);
  });
});
