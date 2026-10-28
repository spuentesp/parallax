import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { buildBriefing } from '../onboarding/briefing.js';
import { describeNode, searchOrgGraph } from '../org-graph.js';
import { viewOrgGraph } from '../org-graph-view.js';

// Mapa de la organización (command center). El grafo completo se construye una
// vez por workspace y se cachea (stale-while-revalidate); cada petición sólo
// filtra, expande y proyecta en memoria. El cliente pide lo que ve: raíces al
// abrir, y los hijos de cada nodo que el usuario expande.

const Filters = z.object({
  contract: z.string().min(1).optional(),
  provenance: z.enum(['deterministic', 'inferred']).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  service: z.string().min(1).optional(),
});

const ViewBody = z.object({
  expand: z.array(z.string()).max(2000).optional(),
  filters: Filters.optional(),
  focus: z.string().min(1).optional(),
  hops: z.number().int().min(0).max(4).optional(),
  limits: z.record(z.string(), z.number().int().min(1).max(5000)).optional(),
  pin: z.array(z.string()).max(200).optional(),
});

export const mapRoutes: FastifyPluginAsync = async (app) => {
  const load = (id: string, refresh: boolean) => app.orgGraphs.load(id, refresh);

  const EMPTY = {
    nodes: [],
    edges: [],
    hiddenChildren: {},
    focus: null,
    unknownExpand: [] as string[],
  };

  app.post(
    '/api/workspaces/:id/map/view',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }), body: ViewBody },
    },
    async (req) => {
      const loaded = await load((req.params as { id: string }).id, false);
      if (!loaded.ok) {
        return { ...EMPTY, meta: { source: loaded.source, error: loaded.error ?? null } };
      }
      const body = req.body as z.infer<typeof ViewBody>;
      const view = viewOrgGraph(loaded.graph, {
        ...(body.expand ? { expand: body.expand } : {}),
        ...(body.filters ? { filters: body.filters } : {}),
        ...(body.focus ? { focus: body.focus } : {}),
        ...(body.hops !== undefined ? { hops: body.hops } : {}),
        ...(body.limits ? { limits: body.limits } : {}),
        ...(body.pin ? { pin: body.pin } : {}),
      });
      return { ...view, meta: loaded.meta };
    },
  );

  // Detalle de un nodo: quién lo consume y de quién depende, con procedencia.
  app.get(
    '/api/workspaces/:id/map/node',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ id: z.string().min(1) }).loose(),
      },
    },
    async (req, reply) => {
      const loaded = await load((req.params as { id: string }).id, false);
      if (!loaded.ok)
        return { detail: null, meta: { source: loaded.source, error: loaded.error ?? null } };
      const detail = describeNode(loaded.graph, (req.query as { id: string }).id);
      if (!detail) return reply.code(404).send({ code: 'NodeNotFound' });
      return { detail, meta: loaded.meta };
    },
  );

  // Orientación para quien llega: qué hay, cuáles son las puertas y quién usa qué.
  // Determinista (sin modelo), sobre el mismo grafo cacheado que dibuja el mapa.
  app.get(
    '/api/workspaces/:id/map/briefing',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const loaded = await load((req.params as { id: string }).id, false);
      if (!loaded.ok) {
        return { briefing: null, meta: { source: loaded.source, error: loaded.error ?? null } };
      }
      return { briefing: buildBriefing(loaded.graph), meta: loaded.meta };
    },
  );

  app.get(
    '/api/workspaces/:id/map/search',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ q: z.string().min(1) }).loose(),
      },
    },
    async (req) => {
      const loaded = await load((req.params as { id: string }).id, false);
      if (!loaded.ok)
        return { results: [], meta: { source: loaded.source, error: loaded.error ?? null } };
      return {
        results: searchOrgGraph(loaded.graph, (req.query as { q: string }).q),
        meta: loaded.meta,
      };
    },
  );

  // Reconstrucción explícita (botón "refresh" del mapa). Espera al motor.
  app.post(
    '/api/workspaces/:id/map/refresh',
    {
      config: { scopes: ['write'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const loaded = await load((req.params as { id: string }).id, true);
      if (!loaded.ok) return { meta: { source: loaded.source, error: loaded.error ?? null } };
      return {
        meta: loaded.meta,
        totals: { nodes: loaded.graph.nodes.length, edges: loaded.graph.edges.length },
      };
    },
  );
};
