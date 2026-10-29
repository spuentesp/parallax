import fp from 'fastify-plugin';
import { createOrgGraphService, type OrgGraphService } from '../org-graph-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    orgGraphs: OrgGraphService;
  }
}

export default fp(
  async (fastify) => {
    fastify.decorate(
      'orgGraphs',
      createOrgGraphService({ db: fastify.db, getClient: (c) => fastify.lainClientFor(c) }),
    );
  },
  { name: 'org-graph', dependencies: ['db', 'lain-adapter'] },
);
