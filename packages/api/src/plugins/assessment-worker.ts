import fp from 'fastify-plugin';
import { AssessmentWorker } from '../worker/assessment-worker.js';

declare module 'fastify' {
  interface FastifyInstance {
    assessmentWorker: AssessmentWorker;
  }
}

// Un solo worker por proceso, atado al adapter LAIN y a la conexión DB de la
// app. Las rutas HTTP y el servidor MCP lo comparten: misma máquina de
// estados, mismos informes (P09).
export default fp(
  async (fastify) => {
    const worker = new AssessmentWorker(fastify.db, { lain: fastify.lain });
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
