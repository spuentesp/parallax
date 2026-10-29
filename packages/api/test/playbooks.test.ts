// Los ejemplos de trabajo (few-shot) se eligen por tipo de pregunta, sin modelo, son cortos
// y sólo se inyecta el que corresponde. Las preguntas de la evaluación no pueden vivir en
// ellos (el conjunto de evaluación y los ejemplos se mantienen separados).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse } from '../src/agent/nemotron.js';
import { classifyQuestion, playbookFor, type QuestionType } from '../src/agent/playbooks.js';
import { createLainMock } from '../src/lain-adapter/mock.js';

const CASES: Array<[string, QuestionType]> = [
  ['What breaks if we rename Order.total?', 'blast'],
  ['What is the blast radius of changing the product query?', 'blast'],
  ['Trace the checkout create call end to end', 'trace'],
  ['How does the storefront request reach the database?', 'trace'],
  ['What is OAuth PKCE and how does it work?', 'orientation'],
  ["What's the difference between a mutation and a query in GraphQL?", 'orientation'],
  ['Why do payment adjustments take a row lock?', 'why'],
  ['How do we run the tests?', 'why'],
  ['Which services depend on billing?', 'relation'],
  ['Where is the discount applied to an order?', 'locate'],
  ['What does select_for_update do in Django?', 'orientation'],
  ['Is Celery retry safe for idempotent tasks?', 'orientation'],
  ['hello', 'other'],
];

describe('question classifier', () => {
  it.each(CASES)('%s -> %s', (q, type) => {
    expect(classifyQuestion(q)).toBe(type);
  });
});

describe('playbooks', () => {
  it('each example is short (about 500 tokens at most) and none is injected for an unrecognised type', () => {
    for (const [q, type] of CASES) {
      const { text } = playbookFor(q, { web: true });
      if (type === 'other') expect(text).toBeNull();
      else expect((text ?? '').length).toBeLessThanOrEqual(1400);
    }
  });

  it('every example ends by requiring the claims array (prose-only answers were measured to creep in without it)', () => {
    for (const [q, type] of CASES) {
      if (type === 'other') continue;
      expect(playbookFor(q, { web: true }).text).toMatch(/MUST carry the "claims" array/);
    }
  });

  it('the orientation example only mentions web_search when the tool exists', () => {
    const q = 'What is OAuth PKCE and how does it work?';
    expect(playbookFor(q, { web: true }).text).toContain('web_search');
    expect(playbookFor(q, { web: false }).text).not.toContain('web_search');
  });

  it('never reuses a question of the evaluation set', () => {
    const evalSrc = readFileSync(resolve(process.cwd(), 'scripts/eval-saleor.ts'), 'utf8');
    const evalQuestions = [...evalSrc.matchAll(/question:\s*[`'"]([^`'"$]{20,})/g)].map((m) =>
      (m[1] as string).toLowerCase(),
    );
    expect(evalQuestions.length).toBeGreaterThan(0);
    for (const [q] of CASES) {
      const { text } = playbookFor(q, { web: true });
      for (const evq of evalQuestions) expect((text ?? '').toLowerCase()).not.toContain(evq);
    }
  });
});

describe('injection into the investigation', () => {
  class Scripted implements ChatCompleter {
    readonly seen: ChatMessage[][] = [];
    async complete(messages: ChatMessage[]): Promise<NemotronResponse> {
      this.seen.push(structuredClone(messages));
      return {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        model: 'fake',
        latencyMs: 1,
      };
    }
  }
  const firstUser = (m: Scripted): string =>
    String(m.seen[0]?.find((x) => x.role === 'user')?.content ?? '');

  it('puts exactly the matching example in the first user message, and reports the type', async () => {
    const model = new Scripted();
    const result = await investigate({
      question: 'What breaks if we rename Order.total?',
      lain: createLainMock(),
      model,
    });
    const text = firstUser(model);
    expect(text).toContain('Example (blast radius)');
    expect(text).not.toContain('Example (end-to-end trace)');
    expect(result.questionType).toBe('blast');
  });

  it('injects nothing for a question of no recognised type', async () => {
    const model = new Scripted();
    const result = await investigate({ question: 'hello', lain: createLainMock(), model });
    expect(firstUser(model)).not.toContain('Example (');
    expect(result.questionType).toBe('other');
  });
});
