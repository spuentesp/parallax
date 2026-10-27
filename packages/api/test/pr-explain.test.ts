// Explicación de PR: los hallazgos del motor entran en el contexto, el modelo los
// explica por id y el backend verifica la entrega y compone lo que es hecho.

import { describe, expect, it } from 'vitest';
import type { ChatCompleter } from '../src/agent/investigator.js';
import { investigate, serializeExplanation } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import {
  buildFindings,
  coverageLine,
  PR_TOOL_BUDGET,
  renderFindingsBlock,
} from '../src/agent/pr-explain.js';
import { createLainMock } from '../src/lain-adapter/mock.js';

const START = 'billing:HttpClientCall:client.py:GET /orders/{}:7';

const changes = [
  {
    kind: 'EndpointRemoved',
    compat: 'Breaking',
    endpoint: { key: 'http:GET /orders/{}', service: 'orders' },
    impact: { class: 'Verified', reasons: ['static_binding'] },
    affected: [{ service: 'billing', class: 'Verified', reasons: 'static_binding' }],
    paths: [{ start: START, hops: [{ node: 'billing:File:client.py:client.py:0' }] }],
  },
  {
    kind: 'EndpointAdded',
    compat: 'Compatible',
    endpoint: { key: 'http:POST /orders/bulk', service: 'orders' },
    impact: { class: 'NeedsInvestigation', reasons: ['unresolved_candidates'] },
    affected: [],
  },
];
const coverage = { complete: false, missing: ['engine unreviewed: reports'] };

function resp(partial: Partial<NemotronResponse>): NemotronResponse {
  return {
    content: null,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1 },
    model: 'fake/nemotron',
    latencyMs: 1,
    ...partial,
  };
}
const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const submit = (args: unknown): NemotronResponse =>
  resp({ toolCalls: [call('s1', 'submit_answer', args)], finishReason: 'tool_calls' });

class Scripted implements ChatCompleter {
  readonly calls: Array<{ messages: ChatMessage[] }> = [];
  constructor(private readonly script: NemotronResponse[]) {}
  async complete(messages: ChatMessage[]): Promise<NemotronResponse> {
    this.calls.push({ messages: [...messages] });
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  }
}

const run = (model: ChatCompleter, over: Record<string, unknown> = {}) =>
  investigate({
    question: 'ignored in PR mode',
    lain: createLainMock(),
    model,
    pr: { changes, coverage },
    ...over,
  });

describe('findings block', () => {
  it('extracts ids, verbatim classes, affected consumers and evidence ids', () => {
    const [f1, f2] = buildFindings(changes);
    expect(f1).toMatchObject({
      id: 'F1',
      kind: 'EndpointRemoved',
      key: 'http:GET /orders/{}',
      engineClass: 'Verified',
      evidenceIds: [START, 'billing:File:client.py:client.py:0'],
    });
    expect(f1?.affected).toEqual([
      { service: 'billing', class: 'Verified', reasons: 'static_binding' },
    ]);
    expect(f2).toMatchObject({ id: 'F2', engineClass: 'NeedsInvestigation', affected: [] });
  });

  it('renders every finding and states incomplete coverage as unknown, not as no impact', () => {
    const block = renderFindingsBlock(buildFindings(changes), coverage);
    expect(block).toContain('F1  EndpointRemoved  orders http:GET /orders/{}');
    expect(block).toContain('engine class: Verified (static_binding)');
    expect(block).toContain('affected consumers: billing (Verified: static_binding)');
    expect(block).toContain('F2  EndpointAdded');
    expect(block).toContain('Coverage: INCOMPLETE — engine unreviewed: reports');
    expect(block).toContain('not evidence of no impact');
  });

  it('tolerates the simplified change shape (service and field only) without inventing a class', () => {
    const [f] = buildFindings([{ kind: 'FieldRemoved', service: 'orders', field: 'customer_id' }]);
    expect(f).toMatchObject({
      id: 'F1',
      service: 'orders',
      key: 'field customer_id',
      engineClass: null,
      affected: [],
    });
    expect(renderFindingsBlock([f as NonNullable<typeof f>], {})).toContain(
      'engine class: unclassified',
    );
  });

  it('says complete coverage only when nothing is missing', () => {
    expect(coverageLine({ complete: true, missing: [] })).toBe('Coverage: complete.');
    expect(coverageLine({})).toBe('Coverage: complete.');
    expect(coverageLine({ complete: false })).toContain('INCOMPLETE');
    // Sin huecos concretos, la razón es el resumen que presentó el análisis.
    expect(
      coverageLine({ complete: false, missing: [], summary: 'engine could not bind 2 calls' }),
    ).toContain('INCOMPLETE — engine could not bind 2 calls');
    // Los huecos concretos mandan sobre el resumen.
    expect(coverageLine({ complete: false, missing: ['a'], summary: 'generic' })).toContain(
      'INCOMPLETE — a.',
    );
    expect(coverageLine({ complete: true, missing: ['x'] })).toContain('INCOMPLETE');
  });
});

describe('PR explanation', () => {
  it('puts the findings in the model context and uses the PR prompt', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'e1' },
          { id: 'F2', explanation: 'e2' },
        ],
      }),
    ]);
    await run(model);
    const [system, user] = model.calls[0]?.messages ?? [];
    expect(String(system?.content)).toContain('pull-request explainer');
    expect(String(user?.content)).toContain('F1  EndpointRemoved');
    expect(String(user?.content)).toContain('F2  EndpointAdded');
    expect(String(user?.content)).toContain('Coverage: INCOMPLETE');
    expect(String(user?.content)).not.toContain('ignored in PR mode');
  });

  it('composes the facts deterministically around the model explanations', async () => {
    const model = new Scripted([
      submit({
        summary: 'Two contract changes.',
        findings: [
          { id: 'F1', explanation: 'The consumer billing breaks.', evidence: [`[ev:${START}]`] },
          { id: 'F2', explanation: 'A new endpoint; nothing consumes it yet.' },
        ],
      }),
    ]);
    const r = await run(model);
    expect(r.explanationStatus).toBe('available');
    expect(r.pr?.unaddressed).toEqual([]);
    expect(r.pr?.findings.map((f) => f.engine_class)).toEqual(['Verified', 'NeedsInvestigation']);
    const text = r.answer ?? '';
    // El backend, no el modelo, escribe la clase, el servicio afectado y la cobertura.
    expect(text).toContain(
      'F1 EndpointRemoved orders http:GET /orders/{} [engine: Verified] affects: billing',
    );
    expect(text).toContain(
      'F2 EndpointAdded orders http:POST /orders/bulk [engine: NeedsInvestigation] affects: none recorded',
    );
    expect(text).toContain('Coverage: INCOMPLETE — engine unreviewed: reports');
    expect(text).toContain('The consumer billing breaks.');
    // La evidencia que el motor entregó con el hallazgo es citable.
    expect(r.pr?.findings[0]?.evidence.accepted).toEqual([START]);
  });

  it('fails visibly, keeping the answer, when the model skips a finding', async () => {
    const model = new Scripted([
      submit({ summary: 's', findings: [{ id: 'F1', explanation: 'only the first' }] }),
    ]);
    const r = await run(model);
    expect(r.explanationStatus).toBe('failed:findings_unaddressed');
    expect(r.pr?.unaddressed).toEqual(['F2']);
    expect(r.answer).toContain('NOT EXPLAINED by the model.');
    expect(r.answer).toContain('only the first');
  });

  it('records ids the model explained that the engine never reported', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a' },
          { id: 'F2', explanation: 'b' },
          { id: 'F9', explanation: 'invented finding' },
        ],
      }),
    ]);
    const r = await run(model);
    expect(r.pr?.unknownIds).toEqual(['F9']);
    expect(r.answer).not.toContain('invented finding');
    expect(r.explanationStatus).toBe('available');
  });

  it('rejects invented evidence ids but keeps the explanation', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a', evidence: ['orders:Function:src/fake.py:nope:1'] },
          { id: 'F2', explanation: 'b' },
        ],
      }),
    ]);
    const r = await run(model);
    expect(r.pr?.findings[0]?.evidence.rejected).toEqual([
      { ref: 'orders:Function:src/fake.py:nope:1', reason: 'not_delivered_by_backend' },
    ]);
    expect(r.citations.rejected).toHaveLength(1);
    expect(r.explanationStatus).toBe('available');
  });

  it('detects the model promoting an engine class, and never changes the engine one', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a' },
          { id: 'F2', explanation: 'The endpoint http:POST /orders/bulk is Verified as safe.' },
        ],
      }),
    ]);
    const r = await run(model, { engineFindings: changes });
    expect(r.conflictingClaims).toHaveLength(1);
    expect(r.conflictingClaims[0]).toMatchObject({
      engineClass: 'NeedsInvestigation',
      claimedClass: 'Verified',
    });
    expect(r.pr?.findings[1]?.engine_class).toBe('NeedsInvestigation');
  });

  it('accepts a submission without reading anything first (the findings are the input)', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a' },
          { id: 'F2', explanation: 'b' },
        ],
      }),
    ]);
    const r = await run(model);
    expect(model.calls).toHaveLength(1);
    expect(r.budget.toolCallsUsed).toBe(0);
  });

  it('caps the research budget for a PR', async () => {
    const model = new Scripted([submit({ summary: 's', findings: [] })]);
    const r = await run(model, { budget: { maxToolCalls: 50 } });
    expect(r.budget.maxToolCalls).toBe(PR_TOOL_BUDGET);
  });

  it('returns a schema error to the model when findings are malformed', async () => {
    const model = new Scripted([
      submit({ summary: 's', findings: [{ id: 'F1' }] }),
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a' },
          { id: 'F2', explanation: 'b' },
        ],
      }),
    ]);
    const r = await run(model);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain(
      'invalid arguments for submit_answer',
    );
    expect(r.explanationStatus).toBe('available');
  });

  it('falls back to a prose answer judged by citations, with no per-finding verification', async () => {
    const model = new Scripted([resp({ content: `Prose answer [ev:${START}]` })]);
    const r = await run(model);
    expect(r.pr).toBeNull();
    expect(r.answer).toContain('Prose answer');
    expect(r.explanationStatus).toBe('available');
  });

  it('exposes the per-finding result in the serialized explanation', async () => {
    const model = new Scripted([
      submit({
        summary: 's',
        findings: [
          { id: 'F1', explanation: 'a' },
          { id: 'F2', explanation: 'b' },
        ],
      }),
    ]);
    const r = await run(model);
    const payload = serializeExplanation(r, { question: 'q', engineFindings: changes });
    expect(payload.pr?.findings).toHaveLength(2);
    expect(payload.pr?.findings[0]?.engine_class).toBe('Verified');
    expect(payload.narrative).toContain('Findings (engine classifications are authoritative):');
  });
});
