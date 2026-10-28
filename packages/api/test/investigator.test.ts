// Tests del investigador Nemotron (G3): bucle real de tool calling con modelo
// guionizado, presupuesto (8 llamadas / 120 s), validación de citas (INV 1),
// separación motor/modelo (INV 2) y estados honestos de explicación (P08).

import { describe, expect, it } from 'vitest';
import {
  type ChatCompleter,
  cleanRef,
  detectClassificationConflicts,
  extractCitationRefs,
  investigate,
  serializeExplanation,
} from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import { getLainMockCalls, resetLainMock } from '../src/lain-adapter/record.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const EVID = 'billing:Function:src/main.py:fetch_me:35';

function resp(partial: Partial<NemotronResponse>): NemotronResponse {
  return {
    content: null,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5 },
    model: 'fake/nemotron',
    latencyMs: 1,
    ...partial,
  };
}

function toolCall(id: string, name: string, args: unknown): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

// Modelo guionizado: cada entrada es una respuesta o un error a lanzar.
// Duerme `latencyMs` para que el presupuesto de tiempo sea determinista.
class ScriptedModel implements ChatCompleter {
  readonly calls: Array<{ messages: ChatMessage[]; tools: unknown }> = [];
  constructor(private readonly script: Array<NemotronResponse | Error>) {}

  async complete(messages: ChatMessage[], opts?: { tools?: unknown }): Promise<NemotronResponse> {
    this.calls.push({ messages, tools: opts?.tools });
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    if (next instanceof Error) throw next;
    if (next.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, next.latencyMs));
    }
    return next;
  }
}

// Adapter de evidencia realista: resolve_evidence sólo confirma refs que el
// motor conoce (a diferencia del mock global, que confirma cualquier cosa).
function lainWithAnchors(): LainAdapter {
  const base = createLainMock();
  return {
    ...base,
    async getService(req) {
      const r = await base.getService(req);
      return {
        ...r,
        consumers: r.consumers.map((c, i) =>
          i === 0
            ? {
                ...c,
                uses: [
                  {
                    binding: { confidence: 1, kind: 'static' },
                    fields: ['customer_id'],
                    site: {
                      id: EVID,
                      node_type: 'Function',
                      repo: 'billing',
                      path: 'src/main.py',
                      line: 35,
                      commit: '972651746b73f234031e3eae3c7b71b5d255d0ef',
                    },
                  },
                  ...c.uses,
                ],
              }
            : c,
        ),
      };
    },
    async resolveEvidence(req) {
      return {
        items: req.refs.map((ref) => ({
          exists: ref === EVID || ref.startsWith('billing:'),
          ref,
          ...(ref === EVID
            ? {
                node: {
                  id: EVID,
                  node_type: 'Function',
                  ref: {
                    repo: 'billing',
                    path: 'src/main.py',
                    line: 35,
                    commit: '972651746b73f234031e3eae3c7b71b5d255d0ef',
                  },
                },
              }
            : {}),
        })),
      };
    },
  };
}

describe('investigate loop', () => {
  it('runs a real tool-calling round: tool_calls → role=tool → final answer', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      resp({
        toolCalls: [toolCall('call_1', 'get_service', { service: 'orders' })],
        finishReason: 'tool_calls',
      }),
      resp({ content: `billing consume orders [ev:${EVID}].` }),
    ]);
    const result = await investigate({
      question: '¿Quién consume orders?',
      lain: lainWithAnchors(),
      model,
    });
    expect(result.toolCallLog).toHaveLength(1);
    expect(result.toolCallLog[0]?.ok).toBe(true);
    expect(result.toolCallLog[0]?.tool).toBe('get_service');
    // El resultado se devuelve como role=tool con el mismo tool_call_id.
    const toolMessages = model.calls[1]?.messages.filter((m) => m.role === 'tool') ?? [];
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]?.tool_call_id).toBe('call_1');
    expect(toolMessages[0]?.content).toContain('"ok":true');
    expect(result.explanationStatus).toBe('available');
    expect(result.citations.accepted).toEqual([EVID]);
    expect(result.effectiveModel).toBe('fake/nemotron');
    expect(result.promptVersion).toBe('parallax-investigator-v4');
    // LAIN fue llamado con la vista fijada (live por defecto).
    expect(getLainMockCalls().some((c) => c.tool === 'get_service' && c.snapshot === 'live')).toBe(
      true,
    );
  });

  it('feeds a typed rejection for an unknown tool without widening permissions', async () => {
    const model = new ScriptedModel([
      resp({
        toolCalls: [toolCall('call_1', 'publish_comment', { body: 'hi' })],
        finishReason: 'tool_calls',
      }),
      resp({
        toolCalls: [toolCall('call_2', 'get_service', { service: 'orders' })],
        finishReason: 'tool_calls',
      }),
      resp({ content: `No hay herramientas de publicación. Hallazgo [ev:${EVID}].` }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.toolCallLog[0]?.ok).toBe(false);
    expect(result.toolCallLog[0]?.code).toBe('unknown_tool');
    const toolMsg = model.calls[1]?.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('unknown_tool');
    expect(toolMsg?.content).toContain('Permissions are not widened');
    // En TODA ronda las herramientas ofrecidas siguen siendo sólo lectura.
    for (const call of model.calls) {
      const names = (call.tools as Array<{ function: { name: string } }>).map(
        (t) => t.function.name,
      );
      expect(names).not.toContain('publish_comment');
    }
    // El bucle sigue tras el rechazo y termina con evidencia entregada.
    expect(result.explanationStatus).toBe('available');
  });

  it('rejects an invented citation and keeps the valid one (INV 1 / P07)', async () => {
    const invented = 'orders:Function:src/invented.rs:fake:999';
    const model = new ScriptedModel([
      resp({
        toolCalls: [toolCall('call_1', 'get_service', { service: 'orders' })],
        finishReason: 'tool_calls',
      }),
      resp({ content: `Real [ev:${EVID}] e inventada [ev:${invented}].` }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.citations.accepted).toEqual([EVID]);
    expect(result.citations.rejected).toEqual([
      { ref: invented, reason: 'not_delivered_by_backend' },
    ]);
    // La explicación se guarda con la evidencia válida, no se descarta entera.
    expect(result.explanationStatus).toBe('available');
  });

  it('fails the explanation when every citation is invented', async () => {
    const model = new ScriptedModel([
      resp({ toolCalls: [toolCall('c0', 'list_services', {})], finishReason: 'tool_calls' }),
      resp({ content: 'Todo Verified [ev:fake:made-up:1].' }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('failed:citations_unresolved');
    expect(result.citations.accepted).toHaveLength(0);
    expect(result.citations.rejected[0]?.reason).toBe('not_delivered_by_backend');
  });

  it('fails the explanation when the answer carries no citations', async () => {
    const model = new ScriptedModel([
      resp({ toolCalls: [toolCall('c0', 'list_services', {})], finishReason: 'tool_calls' }),
      resp({ content: 'Sin citas.' }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('failed:citations_missing');
  });

  it('enforces the tool-call budget and reports it (§6: 8 calls)', async () => {
    resetLainMock();
    // Modelo que sólo pide herramientas: se corta en el presupuesto.
    const model = new ScriptedModel(
      Array.from({ length: 10 }, (_, i) =>
        resp({
          toolCalls: [toolCall(`call_${i}`, 'list_services', {})],
          finishReason: 'tool_calls',
        }),
      ),
    );
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      budget: { maxToolCalls: 3 },
    });
    expect(result.budget.toolCallsUsed).toBe(3);
    expect(result.budget.maxToolCalls).toBe(3);
    expect(result.budget.exhausted).toBe(true);
    // Sólo se ejecutaron 3 lecturas del modelo en LAIN (el catálogo de arranque
    // no cuenta: es la vista fijada, no una llamada de investigación).
    expect(getLainMockCalls().filter((c) => c.tool === 'list_services').length).toBeLessThanOrEqual(
      4,
    );
    expect(result.explanationStatus.startsWith('failed:')).toBe(true);
    expect(result.errors.some((e) => e.includes('budget'))).toBe(true);
  });

  it('terminates within the model time budget (§6: 120 s configurable)', async () => {
    const model = new ScriptedModel(
      Array.from({ length: 5 }, (_, i) =>
        resp({
          toolCalls: [toolCall(`call_${i}`, 'list_services', {})],
          finishReason: 'tool_calls',
          latencyMs: 50,
        }),
      ),
    );
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      budget: { maxToolCalls: 8, maxModelMs: 1 },
    });
    expect(result.explanationStatus).toBe('failed:model_time_budget');
    // Termina tras la primera ronda: no se gastan las 8 llamadas de herramienta.
    expect(result.budget.toolCallsUsed).toBeLessThanOrEqual(1);
    expect(result.budget.modelMsUsed).toBeGreaterThanOrEqual(50);
  });

  it('retries a 429 once within budget and records it', async () => {
    const model = new ScriptedModel([
      new Error('Nemotron HTTP 429: rate limited'),
      resp({
        toolCalls: [toolCall('call_1', 'get_service', { service: 'orders' })],
        finishReason: 'tool_calls',
      }),
      resp({ content: `Ok [ev:${EVID}].` }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      retryDelayMs: 0,
    });
    expect(result.explanationStatus).toBe('available');
    expect(result.modelLog.some((m) => m.retry && m.finishReason === 'rate_limited')).toBe(true);
    expect(result.errors.some((e) => e.includes('429'))).toBe(true);
  });

  it('also retries a provider overload (HTTP 529) once instead of failing the run', async () => {
    const model = new ScriptedModel([
      new Error('Nemotron HTTP 529: {"detail":"System is overloaded"}'),
      resp({
        toolCalls: [toolCall('call_1', 'get_service', { service: 'orders' })],
        finishReason: 'tool_calls',
      }),
      resp({ content: `Ok [ev:${EVID}].` }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      retryDelayMs: 0,
    });
    expect(result.explanationStatus).toBe('available');
    expect(result.modelLog.some((m) => m.retry)).toBe(true);
  });

  it('gives up after repeated model errors with a visible failed status', async () => {
    const model = new ScriptedModel([
      new Error('Nemotron HTTP 429: rate limited'),
      new Error('Nemotron HTTP 429: rate limited'),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('failed:model_error');
  });

  it('declares the cut in the tool message when a result is truncated', async () => {
    const base = lainWithAnchors();
    const big: LainAdapter = {
      ...base,
      async listServices() {
        return {
          items: Array.from({ length: 300 }, (_, i) => ({
            service: `svc-${i}`,
            repo: 'orders',
            endpoints: 1,
            consumer_services: 0,
            unresolved_inbound: 0,
            paths: [`p${'q'.repeat(100)}`],
          })),
          scope: { configured_only: true, reviewed: [], unreviewed: [] },
        };
      },
    };
    const model = new ScriptedModel([
      resp({ toolCalls: [toolCall('call_1', 'list_services', {})], finishReason: 'tool_calls' }),
      resp({ content: `Recortado y declarado [ev:${EVID}].` }),
    ]);
    const result = await investigate({ question: 'q', lain: big, model, maxResultChars: 1500 });
    const toolMsg = model.calls[1]?.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('cut_declared');
    expect(result.toolCallLog[0]?.truncated).toBe(true);
  });
});

describe('INV 2 — engine fields stay engine fields', () => {
  const engineFindings = [
    {
      kind: 'FieldRemoved',
      field: 'customer_id',
      endpoint: { service: 'orders', key: 'http:GET /api/orders/{}' },
      impact: { class: 'NeedsInvestigation' },
    },
  ];

  it('detects a prose promotion but never applies it', () => {
    const answer = 'El endpoint http:GET /api/orders/{} queda Verified tras mi análisis [ev:x].';
    const conflicts = detectClassificationConflicts(answer, engineFindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.claimedClass).toBe('Verified');
    expect(conflicts[0]?.engineClass).toBe('NeedsInvestigation');
  });

  it('serializeExplanation keeps engine classes verbatim and model fields separate', async () => {
    const model = new ScriptedModel([
      resp({ toolCalls: [toolCall('c0', 'list_services', {})], finishReason: 'tool_calls' }),
      resp({
        content: `El endpoint http:GET /api/orders/{} queda Verified [ev:${EVID}].`,
      }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      engineFindings,
    });
    const payload = serializeExplanation(result, { question: 'q', engineFindings });
    // La clase del motor sigue siendo NeedsInvestigation, copiada verbatim.
    expect(payload.engine_finding_classes).toEqual([
      { endpoint: 'http:GET /api/orders/{}', service: 'orders', class: 'NeedsInvestigation' },
    ]);
    // La afirmación del modelo queda como conflicto registrado, separada.
    expect(payload.conflicting_claims).toHaveLength(1);
    expect(payload.conflicting_claims[0]?.claimedClass).toBe('Verified');
    // Narrativa y clasificación del motor viven en campos distintos.
    expect(payload.narrative).toContain('Verified');
    expect(payload.engine_finding_classes.every((f) => f.class === 'NeedsInvestigation')).toBe(
      true,
    );
    expect(payload.prompt_version).toBe('parallax-investigator-v4');
    expect(payload.tool_calls).toHaveLength(1);
  });
});

describe('citations helpers', () => {
  it('extracts [ev:...] refs, unique and trimmed', () => {
    const refs = extractCitationRefs('A [ev:one] B [ev:two] C [ev:one] [ev: two ]');
    expect(refs).toEqual(['one', 'two']);
  });

  it('recognises a citation the model reformatted (INV 1 sin falso negativo)', () => {
    // El modelo tiende a reescribir [ev:x] como `(ev: x)` con backticks.
    // Rechazar una cita real por puntuación deja el informe sin fuentes.
    const answer =
      'billing publica `http:GET /invoices/{}` (ev: `billing:HttpRoute:src/main.py:GET /invoices/{invoice_id}:51`)';
    const refs = extractCitationRefs(answer, [
      'billing:HttpRoute:src/main.py:GET /invoices/{invoice_id}:51',
    ]);
    expect(refs).toContain('billing:HttpRoute:src/main.py:GET /invoices/{invoice_id}:51');
  });

  it('unwraps angle brackets and full-width brackets around a cited id', () => {
    const id = 'saleor-dashboard:Function:src/a.ts:graphql-call%3Aquery%3Ashop:3';
    expect(extractCitationRefs(`x [ev:<${id}>】 y`)).toEqual([id]);
    expect(extractCitationRefs(`x (ev: <${id}>)`)).toEqual([id]);
  });

  it('cleanRef reduces an id as the model wrote it to the id itself', () => {
    expect(cleanRef('[ev:a:b:1]')).toBe('a:b:1');
    expect(cleanRef('<a:b:1>】')).toBe('a:b:1');
    expect(cleanRef('  `ev: a:b:1`.')).toBe('a:b:1');
    expect(cleanRef('q:3')).toBe('q:3');
  });

  it('keeps a literal placeholder as a visible rejection, not a citation', () => {
    expect(extractCitationRefs('x [ev:<id>]')).toEqual(['id']);
  });

  it('acepta un id entregado citado sin marcador alguno', () => {
    const id = 'orders:Function:src/orders/create.rs:create_order:12';
    const refs = extractCitationRefs(`Ver ${id} para el detalle`, [id]);
    expect(refs).toContain(id);
  });

  it('sigue sin aceptar ids que el backend no entregó', () => {
    const refs = extractCitationRefs('Cito (ev: orders:invented:1)', [
      'billing:HttpRoute:src/main.py:x:1',
    ]);
    expect(refs).toContain('orders:invented:1');
    expect(refs).not.toContain('billing:HttpRoute:src/main.py:x:1');
  });

  it('detects conflicts only on sentences naming the endpoint', () => {
    const conflicts = detectClassificationConflicts(
      'Orders es Verified en general. /api/orders/{} sigue NeedsInvestigation.',
      [
        {
          endpoint: { service: 'orders', key: 'http:GET /api/orders/{}' },
          impact: { class: 'NeedsInvestigation' },
        },
      ],
    );
    // La frase que nombra la clave usa NeedsInvestigation (la del motor): sin conflicto.
    expect(conflicts).toHaveLength(0);
  });
});

describe('answering without evidence', () => {
  it('sends a model that answers before reading anything back to the tools, once', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      resp({ content: 'From the map I can tell: it is fine.' }),
      resp({ toolCalls: [toolCall('c1', 'list_services', {})], finishReason: 'tool_calls' }),
      resp({ content: `Verified [ev:${EVID}]` }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(model.calls).toHaveLength(3);
    // El modelo vio el aviso antes de su tercera respuesta.
    const seen = model.calls[2]?.messages ?? [];
    expect(
      seen.some(
        (m) => typeof m.content === 'string' && m.content.includes('without using any tool'),
      ),
    ).toBe(true);
    expect(result.budget.toolCallsUsed).toBe(1);
  });

  it('does not loop: a second tool-less answer is kept and judged by the citation check', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      resp({ content: 'no tools 1' }),
      resp({ content: 'no tools 2' }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(model.calls).toHaveLength(2);
    expect(result.answer).toBe('no tools 2');
    expect(result.explanationStatus).toBe('failed:citations_missing');
  });
});

function submit(id: string, args: unknown): NemotronResponse {
  return resp({ toolCalls: [toolCall(id, 'submit_answer', args)], finishReason: 'tool_calls' });
}
const readOrders = () =>
  resp({
    toolCalls: [toolCall('c_read', 'get_service', { service: 'orders' })],
    finishReason: 'tool_calls',
  });

describe('submit_answer and engine-verified claims', () => {
  it('supports a correct absence with no code anchor, and keeps the prose verbatim', async () => {
    resetLainMock();
    const prose = 'reports does not consume billing.';
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: prose,
        claims: [
          { kind: 'relation', consumer: 'reports', provider: 'billing', polarity: 'absent' },
        ],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('available');
    expect(result.answer).toBe(prose);
    expect(result.citations.accepted).toEqual([]);
    expect(result.claims[0]?.verdict).toBe('verified');
    expect(result.claimsSummary).toMatchObject({ total: 1, verified: 1, contradicted: 0 });
    expect(result.toolCallLog.some((t) => t.tool === 'submit_answer' && t.ok)).toBe(true);
  });

  it('points at a contradicted claim without failing or editing the answer', async () => {
    resetLainMock();
    const prose = `orders consumes billing [ev:${EVID}]`;
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: prose,
        claims: [
          { kind: 'relation', consumer: 'orders', provider: 'billing', polarity: 'present' },
        ],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    // La cita de la prosa es válida: el estado no cambia por la afirmación contradicha.
    expect(result.explanationStatus).toBe('available');
    expect(result.answer).toBe(prose);
    expect(result.claimsSummary.contradicted).toBe(1);
    expect(result.claims[0]?.verdict).toBe('contradicted');
    expect(result.claims[0]?.engine?.uses).toBe(0);
  });

  it('counts a supported note claim as support even when the prose has no citation', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: 'prose without markers',
        claims: [{ kind: 'note', text: 'orders has a consumer', evidence: [EVID] }],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.claims[0]?.verdict).toBe('supported');
    expect(result.explanationStatus).toBe('available');
  });

  it('fails when the only note claim cites evidence the backend never delivered', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: 'prose',
        claims: [{ kind: 'note', text: 'x', evidence: ['orders:Function:src/fake.rs:nope:1'] }],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.claims[0]?.verdict).toBe('unsupported');
    expect(result.explanationStatus).toBe('failed:citations_unresolved');
  });

  it('does not let a contradicted claim stand in for support', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: 'orders consumes billing',
        claims: [
          { kind: 'relation', consumer: 'orders', provider: 'billing', polarity: 'present' },
        ],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('failed:citations_unresolved');
    expect(result.claimsSummary.contradicted).toBe(1);
  });

  it('returns a schema error to the model and lets it resubmit', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', { claims: [] }),
      submit('s2', {
        answer: 'ok',
        claims: [
          { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
        ],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('available');
    const seen = JSON.stringify(model.calls[2]?.messages);
    expect(seen).toContain('invalid arguments for submit_answer');
    expect(result.toolCallLog.filter((t) => t.tool === 'submit_answer').map((t) => t.ok)).toEqual([
      false,
      true,
    ]);
  });

  it('sends back a submission made before any read, once', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      submit('s1', { answer: 'from the map' }),
      readOrders(),
      submit('s2', { answer: `done [ev:${EVID}]` }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(model.calls).toHaveLength(3);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain('without using any tool');
    expect(result.explanationStatus).toBe('available');
  });

  it('ignores other calls made in the same turn as the submission', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      resp({
        toolCalls: [
          toolCall('x1', 'list_services', {}),
          toolCall('s1', 'submit_answer', { answer: 'early' }),
        ],
        finishReason: 'tool_calls',
      }),
      submit('s2', { answer: `final [ev:${EVID}]` }),
    ]);
    // La primera entrega no tiene evidencia nueva que la sostenga (sin citas ni
    // afirmaciones) pero sí hubo lectura: se acepta tal cual y termina.
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.answer).toBe('early');
    expect(result.explanationStatus).toBe('failed:citations_missing');
    expect(model.calls).toHaveLength(2);
  });

  it('mints a receipt per answered read and accepts it as a citation only if it exists', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: `empty by q:1 [ev:q:1] and invented [ev:q:99] and anchor [ev:${EVID}]`,
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.receipts.map((r) => r.id)).toEqual(['q:1']);
    expect(result.citedReceipts).toEqual(['q:1']);
    expect(result.citations.accepted).toEqual([EVID]);
    expect(result.citations.rejected).toEqual([
      { ref: 'q:99', reason: 'not_delivered_by_backend' },
    ]);
    // El modelo ve el id del recibo en el resultado de la herramienta.
    const toolMsg = model.calls[1]?.messages.find((m) => m.role === 'tool');
    expect(JSON.parse(String(toolMsg?.content))).toMatchObject({ ok: true, receipt: 'q:1' });
  });

  it('exposes the claims and receipts in the serialized explanation', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      submit('s1', {
        answer: 'x',
        claims: [
          { kind: 'relation', consumer: 'reports', provider: 'billing', polarity: 'absent' },
        ],
      }),
    ]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    const payload = serializeExplanation(result, { question: 'q' });
    expect(payload.claims).toHaveLength(1);
    expect(payload.claims_summary.verified).toBe(1);
    expect(payload.receipts).toHaveLength(1);
  });
});

describe('empty or unreadable service catalog', () => {
  it('says why instead of a silent no_answer, and spends no model time', async () => {
    const base = createLainMock();
    const model = new ScriptedModel([resp({ content: 'should never be asked' })]);
    const result = await investigate({
      question: 'q',
      lain: {
        ...base,
        async listServices(req) {
          return { ...(await base.listServices(req)), items: [] };
        },
      },
      model,
    });
    expect(result.explanationStatus).toBe('failed:empty_service_catalog');
    expect(result.answer).toBeNull();
    expect(result.errors.some((e) => e.includes('services'))).toBe(true);
    expect(model.calls).toHaveLength(0);
  });

  it('reports an unreadable catalog as unavailable, with the cause', async () => {
    const base = createLainMock();
    const model = new ScriptedModel([resp({ content: 'x' })]);
    const result = await investigate({
      question: 'q',
      lain: {
        ...base,
        async listServices() {
          throw new Error('connection refused');
        },
      },
      model,
    });
    expect(result.explanationStatus).toBe('failed:catalog_unavailable');
    expect(result.errors.join(' ')).toContain('connection refused');
    expect(model.calls).toHaveLength(0);
  });
});

describe('P08 — explanation status honesty', () => {
  it('a failed model call leaves structural data and a visible failed status', async () => {
    const model = new ScriptedModel([new Error('Nemotron HTTP 500: boom')]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(result.explanationStatus).toBe('failed:model_error');
    expect(result.answer).toBeNull();
    expect(result.errors).toContain('Nemotron HTTP 500: boom');
  });
});

describe('closing in prose after reading from the engine', () => {
  it('asks once for a submit_answer, then verifies the claims the model delivers', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      resp({ content: 'billing consumes orders.' }),
      submit('s1', {
        answer: 'billing consumes orders.',
        claims: [
          { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
        ],
      }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      nudgeSubmit: true,
    });
    expect(model.calls).toHaveLength(3);
    // El historial es el mismo array que sigue creciendo: se busca el aviso, no "el último".
    const nudges = (model.calls[2]?.messages ?? []).filter(
      (m) =>
        m.role === 'user' && String(m.content).startsWith('Now finish by calling submit_answer'),
    );
    expect(nudges).toHaveLength(1);
    expect(result.claimsSummary).toMatchObject({ total: 1, verified: 1 });
    expect(result.answer).toBe('billing consumes orders.');
  });

  it('asks only once: a model that insists on prose is accepted, with no claims', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      resp({ content: 'first prose' }),
      resp({ content: 'second prose' }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      nudgeSubmit: true,
    });
    expect(model.calls).toHaveLength(3);
    expect(result.answer).toBe('second prose');
    expect(result.claimsSummary.total).toBe(0);
  });

  it('does not nudge a model that already submitted, or an empty reply', async () => {
    resetLainMock();
    const done = new ScriptedModel([readOrders(), submit('s1', { answer: 'x', claims: [] })]);
    await investigate({ question: 'q', lain: lainWithAnchors(), model: done, nudgeSubmit: true });
    expect(done.calls).toHaveLength(2);
    resetLainMock();
    const empty = new ScriptedModel([readOrders(), resp({ content: null })]);
    const r = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model: empty,
      nudgeSubmit: true,
    });
    expect(empty.calls).toHaveLength(2);
    expect(r.answer).toBe('');
  });

  it('without the option the prose is accepted as before', async () => {
    resetLainMock();
    const model = new ScriptedModel([readOrders(), resp({ content: 'just prose' })]);
    const result = await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(model.calls).toHaveLength(2);
    expect(result.answer).toBe('just prose');
  });

  it('a reply that was cut off mid-call gets a "shorter" request, not a generic one', async () => {
    resetLainMock();
    const model = new ScriptedModel([
      readOrders(),
      resp({
        content:
          '<tool_call>\n<function=submit_answer>\n<parameter=answer>\nThree services consume',
        finishReason: 'length',
      }),
      submit('s1', {
        answer: 'short answer',
        claims: [
          { kind: 'relation', consumer: 'billing', provider: 'orders', polarity: 'present' },
        ],
      }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      nudgeSubmit: true,
    });
    const asked = (model.calls[2]?.messages ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content));
    expect(asked.some((t) => /cut off.*SHORT/.test(t))).toBe(true);
    // El XML a medio escribir no se devuelve al modelo como si fuera su respuesta.
    const echoed = (model.calls[2]?.messages ?? [])
      .filter((m) => m.role === 'assistant')
      .map((m) => String(m.content));
    expect(echoed.some((t) => t.includes('<tool_call>'))).toBe(false);
    expect(result.answer).toBe('short answer');
    expect(result.claimsSummary.verified).toBe(1);
  });

  it('if the model keeps failing, the user never reads raw tool-call markup', async () => {
    resetLainMock();
    const cut =
      '<tool_call>\n<function=submit_answer>\n<parameter=answer>\n## Consumers\n\nThree services';
    const model = new ScriptedModel([
      readOrders(),
      resp({ content: cut, finishReason: 'length' }),
      resp({ content: cut, finishReason: 'length' }),
    ]);
    const result = await investigate({
      question: 'q',
      lain: lainWithAnchors(),
      model,
      nudgeSubmit: true,
    });
    expect(result.answer).toBe('## Consumers\n\nThree services');
  });
});

describe('answer length budget', () => {
  const capture = () => {
    const seen: Array<number | undefined> = [];
    const model: ChatCompleter = {
      async complete(_m, o) {
        seen.push((o as { maxTokens?: number } | undefined)?.maxTokens);
        return resp({ content: 'done' });
      },
    };
    return { model, seen };
  };

  it('asks the model for 4096 tokens per turn by default, double the old 2048', async () => {
    resetLainMock();
    const { model, seen } = capture();
    await investigate({ question: 'q', lain: lainWithAnchors(), model });
    expect(seen[0]).toBe(4096);
  });

  it('uses the configured limit when given', async () => {
    resetLainMock();
    const { model, seen } = capture();
    await investigate({ question: 'q', lain: lainWithAnchors(), model, maxTokens: 8192 });
    expect(seen[0]).toBe(8192);
  });
});
