// Evaluación del investigador sobre el workspace Saleor real. La verdad sale del
// motor (get_service / list_contracts), no de memoria: cada caso se calcula en
// cada corrida y la respuesta del modelo se mide contra ella.
//
//   LAIN_URL=http://localhost:9999/mcp \
//     pnpm --filter @parallax/api exec tsx --env-file-if-exists=../../.env \
//     scripts/eval-saleor.ts [--runs N] <worker-model> [<worker-model> ...]
//
// Mide, por corrida: estado, recorte por presupuesto, llamadas, tiempo, claves
// de operación inventadas (no existen en el catálogo del proveedor) y los
// criterios del caso. No usa un modelo como juez: todo son comprobaciones sobre
// el motor y sobre el texto.

import { investigate } from '../src/agent/investigator.js';
import { investigatorModel } from '../src/agent/model.js';
import { fetchAllContracts } from '../src/advisor/correlate.js';
import { loadConfig } from '../src/config.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const PROVIDER = 'saleor-api';
const OP_KEY = /graphql:(?:query|mutation|subscription):[A-Za-z0-9_]+/g;

interface EvalCase {
  id: string;
  question: string;
  /** Todas deben cumplirse. */
  require: Array<{ label: string; test: (answer: string) => boolean }>;
  /** Ninguna debe cumplirse. */
  forbid: Array<{ label: string; test: (answer: string) => boolean }>;
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
      question: `Which services consume ${PROVIDER}?`,
      require: consumers.map((s) => ({ label: `names ${s}`, test: has(s) })),
      forbid: [],
    },
    {
      id: 'storefront-product',
      question: `Does the storefront consume the product query from ${PROVIDER}? Answer yes or no and cite the evidence.`,
      require: [
        { label: 'engine: storefront uses graphql:query:product', test: () => storefrontOps.has('graphql:query:product') },
        { label: 'verdict is yes', test: (a) => verdict(a) === 'yes' },
      ],
      forbid: [],
    },
    {
      id: 'dashboard-attributes',
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
      question: `Does ${PROVIDER} consume saleor-dashboard or saleor-storefront?`,
      require: [{ label: 'verdict is no', test: (a) => verdict(a) === 'no' }],
      forbid: [],
    },
  ];
  return { cases, providerOps };
}

interface RunResult {
  caseId: string;
  model: string;
  status: string;
  cutShort: boolean;
  calls: number;
  ms: number;
  invented: string[];
  failedRequire: string[];
  hitForbid: string[];
  pass: boolean;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let runs = 1;
  const models: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--runs') runs = Number(args[++i]);
    else models.push(a);
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
    const model = investigatorModel(loadConfig({ ...process.env, NEMOTRON_WORKER_MODEL: workerModel }));
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
        });
        // El modelo escribe guiones no separables (U+2011) y similares: se normalizan
        // para medir el contenido, no la tipografía.
        const answer = (res.answer ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');
        const invented = [...new Set(answer.match(OP_KEY) ?? [])].filter((k) => !providerOps.has(k));
        const failedRequire = c.require.filter((q) => !q.test(answer)).map((q) => q.label);
        const hitForbid = c.forbid.filter((f) => f.test(answer)).map((f) => f.label);
        const pass =
          res.explanationStatus === 'available' &&
          invented.length === 0 &&
          failedRequire.length === 0 &&
          hitForbid.length === 0;
        results.push({
          caseId: c.id,
          model: workerModel,
          status: res.explanationStatus,
          cutShort: res.budget.cutShort,
          calls: res.budget.toolCallsUsed,
          ms: Date.now() - t0,
          invented,
          failedRequire,
          hitForbid,
          pass,
        });
        const last = results[results.length - 1] as RunResult;
        console.log(
          `${last.pass ? 'PASS' : 'FAIL'} ${workerModel.split('/').pop()} ${c.id} [${last.status}] calls=${last.calls}${last.cutShort ? ' CUT' : ''} ${(last.ms / 1000).toFixed(0)}s` +
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
    const passed = rs.filter((r) => r.pass).length;
    const cut = rs.filter((r) => r.cutShort).length;
    const invented = rs.filter((r) => r.invented.length > 0).length;
    const avgCalls = rs.reduce((n, r) => n + r.calls, 0) / rs.length;
    console.log(`${m}: ${passed}/${rs.length} pass, ${cut} cut short, ${invented} with invented operations, avg ${avgCalls.toFixed(1)} calls`);
  }
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error('eval error:', e);
  process.exitCode = 1;
});
