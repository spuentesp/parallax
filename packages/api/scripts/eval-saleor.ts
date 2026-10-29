// Evaluación del investigador sobre el workspace Saleor real. La verdad sale del
// motor (get_service / list_contracts), no de memoria: cada caso se calcula en
// cada corrida y la respuesta del modelo se mide contra ella.
//
//   LAIN_URL=http://localhost:9999/mcp \
//     pnpm --filter @parallax/api exec tsx --env-file-if-exists=../../.env \
//     scripts/eval-saleor.ts [--runs N] [--mode worker|super|relay] [--no-playbooks] <worker-model> [<worker-model> ...]
//
// --no-playbooks apaga los ejemplos de trabajo por tipo de pregunta (la línea base del A/B).
//
// --mode reparte el trabajo entre los dos modelos:
//   worker — el trabajador lo hace todo (lo de hoy)
//   super  — el planificador lo hace todo (la línea base que ya se sabía que pasa)
//   relay  — el relevo: el planificador planifica y redacta, el trabajador lee
//
// Mide, por corrida: estado, recorte por presupuesto, llamadas (de herramienta y
// de modelo), tokens de entrada, tiempo, claves de operación inventadas (no
// existen en el catálogo del proveedor) y los criterios del caso. No usa un
// modelo como juez: todo son comprobaciones sobre el motor y sobre el texto.

import type { ClaimResult } from '../src/agent/claims.js';
import { investigate } from '../src/agent/investigator.js';
import type { QuestionType } from '../src/agent/playbooks.js';
import { investigatorModel } from '../src/agent/model.js';
import { fetchAllContracts } from '../src/advisor/correlate.js';
import { loadConfig } from '../src/config.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const PROVIDER = 'saleor-api';
const OP_KEY = /graphql:(?:query|mutation|subscription):[A-Za-z0-9_]+/g;

interface EvalCase {
  id: string;
  /** Tipo de pregunta: el resumen se reparte por tipo para ver qué ayuda a qué. */
  type: QuestionType;
  question: string;
  /** Todas deben cumplirse. */
  require: Array<{ label: string; test: (answer: string, claims: ClaimResult[]) => boolean }>;
  /** Ninguna debe cumplirse. */
  forbid: Array<{ label: string; test: (answer: string, claims: ClaimResult[]) => boolean }>;
}

// Polaridad de una respuesta sí/no: se mira sólo la primera oración (sin
// markdown), donde el modelo da el veredicto; el resto es justificación.
function verdict(answer: string): 'yes' | 'no' | 'unclear' {
  const first = answer
    .replace(/[*_`]/g, '')
    .trim()
    .split(/(?<=[.!?])\s|\n/)[0]
    ?.toLowerCase() ?? '';
  if (/\b(no|not|neither|nor|none|doesn't|does not|do not|never|unknown)\b/.test(first)) return 'no';
  if (/\b(yes|does|consumes?|calls?|uses?|depends?)\b/.test(first)) return 'yes';
  return 'unclear';
}

// Veredicto estructurado: la relación consumer→provider que el modelo afirmó y
// que el MOTOR verificó. Si no hay afirmación, se cae al texto (modelo en prosa).
function relationVerdict(
  claims: ClaimResult[],
  consumer: string,
  provider: string,
): 'yes' | 'no' | 'wrong' | undefined {
  const c = claims.find(
    (x) =>
      x.claim.kind === 'relation' &&
      x.claim.consumer.replace(/^saleor-/, '') === consumer.replace(/^saleor-/, '') &&
      x.claim.provider.replace(/^saleor-/, '') === provider.replace(/^saleor-/, ''),
  );
  if (!c || c.claim.kind !== 'relation') return undefined;
  if (c.verdict !== 'verified') return 'wrong';
  return c.claim.polarity === 'present' ? 'yes' : 'no';
}

const has = (needle: string) => (a: string) => a.toLowerCase().includes(needle.toLowerCase());

async function buildCases(lain: LainAdapter): Promise<{ cases: EvalCase[]; providerOps: Set<string> }> {
  const provider = await lain.getService({ snapshot: 'live', service: PROVIDER });
  // El motor registra también al propio saleor-api (lecturas de tablas): no es
  // un consumidor externo y la pregunta es por los demás servicios.
  const consumers = provider.consumers.map((c) => c.service).filter((s) => s !== PROVIDER);
  const usesOf = (service: string): string[] =>
    (provider.consumers.find((c) => c.service === service)?.uses ?? [])
      .map((u) => u.endpoint?.key ?? '')
      .filter((k) => k.startsWith('graphql:'));
  const dashboardOps = [...new Set(usesOf('saleor-dashboard'))];
  const attributeOps = dashboardOps.filter((k) => /:attribute/i.test(k));
  const storefrontOps = new Set(usesOf('saleor-storefront'));

  const contracts = await fetchAllContracts(lain, { snapshot: 'live' });
  const providerOps = new Set(
    contracts.filter((c) => c.endpoint.service === PROVIDER).map((c) => c.endpoint.key),
  );
  if (consumers.length === 0) throw new Error(`engine reports no consumers of ${PROVIDER}`);

  const cases: EvalCase[] = [
    {
      id: 'consumers',
      type: 'relation',
      question: `Which services consume ${PROVIDER}?`,
      require: consumers.map((s) => ({ label: `names ${s}`, test: has(s) })),
      forbid: [],
    },
    {
      id: 'storefront-product',
      type: 'relation',
      question: `Does the storefront consume the product query from ${PROVIDER}? Answer yes or no and cite the evidence.`,
      require: [
        { label: 'engine: storefront uses graphql:query:product', test: () => storefrontOps.has('graphql:query:product') },
        {
          label: 'verdict is yes (engine-verified claim, else text)',
          test: (a, claims) =>
            (relationVerdict(claims, 'saleor-storefront', PROVIDER) ?? verdict(a)) === 'yes',
        },
      ],
      forbid: [],
    },
    {
      id: 'dashboard-attributes',
      type: 'locate',
      question: 'Which GraphQL operations related to attributes does the dashboard use against the Saleor API?',
      require: [
        {
          label: `names >=3 of the ${attributeOps.length} attribute operations the engine records`,
          test: (a) => attributeOps.filter((k) => a.includes(k) || a.includes(k.split(':').pop() ?? '#')).length >= 3,
        },
      ],
      forbid: [],
    },
    {
      id: 'no-reverse-dependency',
      type: 'relation',
      question: `Does ${PROVIDER} consume saleor-dashboard or saleor-storefront?`,
      require: ['saleor-dashboard', 'saleor-storefront'].map((consumer) => ({
        label: `verdict for ${consumer} is no (engine-verified claim, else text)`,
        test: (a: string, claims: ClaimResult[]) =>
          (relationVerdict(claims, PROVIDER, consumer) ?? verdict(a)) === 'no',
      })),
      forbid: [],
    },
  ];
  return { cases, providerOps };
}

interface RunResult {
  caseId: string;
  type: QuestionType;
  model: string;
  /** Cómo se repartió el trabajo: todo el trabajador, todo el planificador, o el relevo. */
  mode: EvalMode;
  status: string;
  cutShort: boolean;
  calls: number;
  /** Llamadas al modelo (el relevo hace dos más: el plan y la escritura). */
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  invented: string[];
  claims: { verified: number; contradicted: number; unverifiable: number; total: number };
  failedRequire: string[];
  hitForbid: string[];
  pass: boolean;
}

/**
 * Cómo se reparte el trabajo entre los dos modelos:
 *   worker  — el trabajador lo hace todo (lo de hoy)
 *   super   — el planificador lo hace todo (la línea base que ya se sabía que pasa)
 *   relay   — el relevo: el planificador planifica y redacta, el trabajador lee
 */
type EvalMode = 'worker' | 'super' | 'relay';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let runs = 1;
  let mode: EvalMode = 'worker';
  let playbooks = true;
  const models: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--runs') runs = Number(args[++i]);
    else if (a === '--no-playbooks') playbooks = false;
    else if (a === '--mode') {
      const m = args[++i];
      if (m !== 'worker' && m !== 'super' && m !== 'relay') {
        throw new Error(`--mode must be worker, super or relay (got ${m})`);
      }
      mode = m;
    } else models.push(a);
  }
  if (models.length === 0) throw new Error('pass at least one worker model id');

  const lain = await createLainClient({
    lainUrl: process.env.LAIN_URL ?? 'http://localhost:9999/mcp',
    apiVersion: '1',
    timeoutMs: 120_000,
  });
  const { cases, providerOps } = await buildCases(lain);
  console.log(`eval over ${PROVIDER}: ${providerOps.size} provider operations, ${cases.length} cases, ${runs} run(s)/model`);

  const results: RunResult[] = [];
  for (const workerModel of models) {
    // En modo "super" el modelo fuerte hace el bucle entero; en "relay" hace el
    // plan y la escritura, y el trabajador lee.
    const effectiveWorker =
      mode === 'super'
        ? (process.env.NEMOTRON_PLANNER_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b')
        : workerModel;
    const model = investigatorModel(
      loadConfig({ ...process.env, NEMOTRON_WORKER_MODEL: effectiveWorker }),
    );
    if (!model) throw new Error('NEBIUS_TOKEN is not set');
    for (const c of cases) {
      for (let r = 0; r < runs; r++) {
        const t0 = Date.now();
        const res = await investigate({
          question: c.question,
          lain,
          model: model.provider,
          view: 'live',
          budget: model.budget,
          ...(mode === 'relay' ? { handoff: true } : {}),
          ...(playbooks ? {} : { playbooks: false }),
        });
        // El modelo escribe guiones no separables (U+2011) y similares: se normalizan
        // para medir el contenido, no la tipografía.
        const answer = (res.answer ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');
        const invented = [...new Set(answer.match(OP_KEY) ?? [])].filter((k) => !providerOps.has(k));
        const failedRequire = c.require.filter((q) => !q.test(answer, res.claims)).map((q) => q.label);
        const hitForbid = c.forbid.filter((f) => f.test(answer, res.claims)).map((f) => f.label);
        const pass =
          res.explanationStatus === 'available' &&
          invented.length === 0 &&
          failedRequire.length === 0 &&
          hitForbid.length === 0;
        results.push({
          caseId: c.id,
          type: c.type,
          model: workerModel,
          mode,
          status: res.explanationStatus,
          cutShort: res.budget.cutShort,
          calls: res.budget.toolCallsUsed,
          modelCalls: res.modelLog.length,
          promptTokens: res.budget.promptTokens,
          completionTokens: res.budget.completionTokens,
          ms: Date.now() - t0,
          invented,
          claims: {
            verified: res.claimsSummary.verified,
            contradicted: res.claimsSummary.contradicted,
            unverifiable: res.claimsSummary.unverifiable,
            total: res.claimsSummary.total,
          },
          failedRequire,
          hitForbid,
          pass,
        });
        const last = results[results.length - 1] as RunResult;
        console.log(
          `${last.pass ? 'PASS' : 'FAIL'} ${mode}:${effectiveWorker.split('/').pop()} ${c.id} [${last.status}] calls=${last.calls} model=${last.modelCalls} in=${last.promptTokens}${last.cutShort ? ' CUT' : ''} ${(last.ms / 1000).toFixed(0)}s` +
            (last.claims.total ? ` claims=${last.claims.verified}ok/${last.claims.contradicted}contradicted/${last.claims.unverifiable}unverifiable` : ' claims=none(prose)') +
            (last.invented.length ? ` invented=${last.invented.slice(0, 3).join(',')}` : '') +
            (last.failedRequire.length ? ` missing=[${last.failedRequire.join('; ')}]` : '') +
            (last.hitForbid.length ? ` forbidden=[${last.hitForbid.join('; ')}]` : ''),
        );
      }
    }
  }

  console.log('\n=== summary ===');
  for (const m of models) {
    const rs = results.filter((r) => r.model === m);
    const effectiveName =
      mode === 'super'
        ? (process.env.NEMOTRON_PLANNER_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b')
        : m;
    const passed = rs.filter((r) => r.pass).length;
    const cut = rs.filter((r) => r.cutShort).length;
    const invented = rs.filter((r) => r.invented.length > 0).length;
    const avgCalls = rs.reduce((n, r) => n + r.calls, 0) / rs.length;
    const structured = rs.filter((r) => r.claims.total > 0).length;
    const contradicted = rs.reduce((n, r) => n + r.claims.contradicted, 0);
    const verified = rs.reduce((n, r) => n + r.claims.verified, 0);
    const avgModelCalls = rs.reduce((n, r) => n + r.modelCalls, 0) / rs.length;
    const avgIn = rs.reduce((n, r) => n + r.promptTokens, 0) / rs.length;
    const avgMs = rs.reduce((n, r) => n + r.ms, 0) / rs.length;
    console.log(
      `${mode}:${effectiveName.split('/').pop()}: ${passed}/${rs.length} pass, ${cut} cut short, ${invented} with invented operations, ` +
        `avg ${avgCalls.toFixed(1)} tool calls, ${avgModelCalls.toFixed(1)} model calls, ${(avgIn / 1000).toFixed(0)}k in, ` +
        `${(avgMs / 1000).toFixed(0)}s, ${structured} structured answers, ${verified} verified / ${contradicted} contradicted claims`,
    );
  }
  console.log(`\nby question type (playbooks ${playbooks ? 'on' : 'off'}):`);
  for (const type of [...new Set(results.map((r) => r.type))]) {
    const rs = results.filter((r) => r.type === type);
    const avgIn = rs.reduce((n, r) => n + r.promptTokens, 0) / rs.length;
    console.log(
      `  ${type}: ${rs.filter((r) => r.pass).length}/${rs.length} pass, avg ${(avgIn / 1000).toFixed(0)}k in`,
    );
  }
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error('eval error:', e);
  process.exitCode = 1;
});
