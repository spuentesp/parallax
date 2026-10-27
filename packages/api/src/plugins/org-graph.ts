import fp from 'fastify-plugin';
import { createOrgGraphService, type OrgGraphService } from '../org-graph-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    orgGraphs: OrgGraphService;
  }
}

export default fp(
  async (fastify) => {
    fastify.decorate('orgGraphs', createOrgGraphService({ db: fastify.db }));
  },
  { name: 'org-graph', dependencies: ['db'] },
);
