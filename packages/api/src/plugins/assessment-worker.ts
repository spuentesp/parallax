import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { getLainClient } from '../lain-adapter/client.js';
import type { LainAdapter } from '../lain-adapter/types.js';
import { AssessmentWorker } from '../worker/assessment-worker.js';

declare module 'fastify' {
  interface FastifyInstance {
    assessmentWorker: AssessmentWorker;
  }
}

// Un solo worker por proceso. Cada organización es un workspace con su propio
// servidor LAIN, así que el worker resuelve el adaptador por org en vez de
// usar uno global: analizar contra el adapter global (hoy, mock) producía
// informes con datos inventados.
export default fp(
  async (fastify) => {
    const worker = new AssessmentWorker(fastify.db, {
      getLain: async (orgId: string): Promise<LainAdapter | undefined> => {
        const rows = await fastify.db
          .select()
          .from(schema.workspace)
          .where(eq(schema.workspace.id, orgId))
          .limit(1);
        const lainUrl = rows[0]?.lainUrl;
        if (!lainUrl) {
          // Un workspace sin LAIN propio usa el adapter configurado por defecto
          // (mock en desarrollo, real si LAIN_ADAPTER=real). Es lo que permite
          // probar el flujo completo sin levantar un motor por org.
          return fastify.lain;
        }
        return getLainClient({ lainUrl, apiVersion: '1', timeoutMs: 30_000 });
      },
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
