import fp from 'fastify-plugin';
import { investigate, serializeExplanation } from '../agent/investigator.js';
import { NemotronProvider } from '../agent/nemotron.js';
import { investigatorSettings } from '../config.js';
import { createWorkspaceLainResolver } from '../lain-adapter/workspace.js';
import { AssessmentWorker, type ExplainOutcome } from '../worker/assessment-worker.js';

declare module 'fastify' {
  interface FastifyInstance {
    assessmentWorker: AssessmentWorker;
  }
}

type ExplainFn = (args: {
  orgId: string;
  viewId: string;
  question: string;
  engineFindings: unknown[];
}) => Promise<ExplainOutcome>;

// Un solo worker por proceso. Cada organización es un workspace con su propio
// servidor LAIN, así que el worker resuelve el adaptador por org en vez de
// usar uno global: analizar contra el adapter global (hoy, mock) producía
// informes con datos inventados. La explicación (G3) usa el MISMO LAIN del
// workspace y el modelo efectivo configurado — nunca ejecuta MCP el modelo.
export default fp(
  async (fastify) => {
    const getLain = createWorkspaceLainResolver({
      db: fastify.db,
      defaultAdapter: fastify.lain,
    });

    // Sin token Nemotron no se inyecta explain: el paso registra
    // failed:no_model_configured y el informe estructural sale igual (P08).
    const nemotronToken = fastify.config.nemotronToken;
    const settings = investigatorSettings(fastify.config);
    // El tipo va en la declaración, no en los parámetros: el parser de Stryker
    // (babel) no acepta `async (args: T): R => …` dentro de un ternario.
    const explain: ExplainFn | undefined = nemotronToken
      ? async (args) => {
          const lain = await getLain(args.orgId);
          if (!lain) {
            return {
              status: 'failed:no_workspace_lain',
              model: 'none',
              payload: null,
            };
          }
          const nemotron = new NemotronProvider({
            baseUrl: settings.baseUrl,
            apiKey: nemotronToken,
            plannerModel: settings.plannerModel,
            workerModel: settings.workerModel,
            timeoutMs: Math.min(60_000, settings.maxModelMs),
          });
          const result = await investigate({
            question: args.question,
            lain,
            model: nemotron,
            view: args.viewId,
            budget: {
              maxToolCalls: settings.maxToolCalls,
              maxModelMs: settings.maxModelMs,
            },
            engineFindings: args.engineFindings,
            endpointLabel: settings.baseUrl,
          });
          const payload = serializeExplanation(result, {
            question: args.question,
            endpointLabel: settings.baseUrl,
            engineFindings: args.engineFindings,
          });
          return {
            status: result.explanationStatus,
            model: result.effectiveModel ?? 'unknown',
            payload,
          };
        }
      : undefined;

    const worker = new AssessmentWorker(fastify.db, {
      getLain,
      ...(explain ? { explain } : {}),
    });
    fastify.decorate('assessmentWorker', worker);

    // Los runs se lanzan fuera del request (§5 devuelve el id de inmediato).
    // Antes de cerrar la conexión hay que drenarlos o se escribiría sobre una
    // base ya cerrada y el trabajo quedaría sin su artefacto.
    fastify.addHook('onClose', async () => {
      await worker.drain();
    });
  },
  { name: 'assessment-worker', dependencies: ['db', 'lain-adapter'] },
);
