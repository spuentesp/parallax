import type { LainView } from '@parallax/shared/lain';
import fp from 'fastify-plugin';
import { investigate, serializeExplanation } from '../agent/investigator.js';
import { investigatorModel } from '../agent/model.js';
import { githubReaderFor } from '../github/reader.js';
import { createWorkspaceLainResolver } from '../lain-adapter/workspace.js';
import { AssessmentWorker, type AssessmentWorkerDeps } from '../worker/assessment-worker.js';

declare module 'fastify' {
  interface FastifyInstance {
    assessmentWorker: AssessmentWorker;
  }
}

// El contrato de explain vive en el worker: una sola declaración.
type ExplainFn = NonNullable<AssessmentWorkerDeps['explain']>;

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
    const model = investigatorModel(fastify.config);
    // El tipo va en la declaración, no en los parámetros: el parser de Stryker
    // (babel) no acepta `async (args: T): R => …` dentro de un ternario.
    const explain: ExplainFn | undefined = model
      ? async (args) => {
          const lain = await getLain(args.orgId);
          if (!lain) {
            return {
              status: 'failed:no_workspace_lain',
              model: 'none',
              payload: null,
            };
          }
          const result = await investigate({
            question: args.question,
            lain,
            model: model.provider,
            view: args.viewId,
            budget: model.budget,
            maxTokens: model.settings.maxTokens,
            ...(model.settings.thinking !== undefined ? { thinking: model.settings.thinking } : {}),
            engineFindings: args.engineFindings,
            // Los hallazgos del motor entran en el contexto y se explican por id.
            pr: {
              changes: args.engineFindings,
              coverage: args.coverage ?? {},
              baseView: args.baseView as LainView | undefined,
            },
            endpointLabel: model.settings.baseUrl,
          });
          const payload = serializeExplanation(result, {
            question: args.question,
            endpointLabel: model.settings.baseUrl,
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
      // Sólo lectura: los archivos y diffs del PR para la revisión de código.
      github: githubReaderFor(fastify.config),
      ...(explain ? { explain } : {}),
    });
    fastify.decorate('assessmentWorker', worker);
    // INV 5: lo que un reinicio dejó a medias se reanuda. En segundo plano: una evaluación puede
    // tardar minutos y el servidor no debe esperar para atender peticiones.
    fastify.addHook('onReady', async () => {
      void worker.recover().then(
        (ids) => {
          if (ids.length > 0)
            fastify.log.info({ resumed: ids.length }, 'resumed interrupted assessments');
        },
        (err: unknown) => fastify.log.error({ err }, 'could not resume interrupted assessments'),
      );
    });

    // Los runs se lanzan fuera del request (§5 devuelve el id de inmediato).
    // Antes de cerrar la conexión hay que drenarlos o se escribiría sobre una
    // base ya cerrada y el trabajo quedaría sin su artefacto.
    fastify.addHook('onClose', async () => {
      await worker.drain();
    });
  },
  { name: 'assessment-worker', dependencies: ['db', 'lain-adapter'] },
);
