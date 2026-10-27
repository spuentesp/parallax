import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { getLainClient } from '../lain-adapter/client.js';
import { isLainCallError } from '../lain-adapter/errors.js';
import { describeNode, type OrgGraph, searchOrgGraph, toOrgGraph } from '../org-graph.js';
import { OrgGraphCache } from '../org-graph-cache.js';
import { viewOrgGraph } from '../org-graph-view.js';
import { buildEndpointTopology } from '../topology.js';

// Mapa de la organización (command center). El grafo completo se construye una
// vez por workspace y se cachea (stale-while-revalidate); cada petición sólo
// filtra, expande y proyecta en memoria. El cliente pide lo que ve: raíces al
// abrir, y los hijos de cada nodo que el usuario expande.

const CACHE_TTL_MS = 5 * 60_000;

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
});

export const mapRoutes: FastifyPluginAsync = async (app) => {
  const cache = new OrgGraphCache({ ttlMs: CACHE_TTL_MS });

  type Loaded =
    | { ok: true; graph: OrgGraph; meta: Record<string, unknown> }
    | { ok: false; source: 'none' | 'unconfigured' | 'error'; error?: string };

  async function load(workspaceId: string, refresh: boolean): Promise<Loaded> {
    const rows = await app.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
      .limit(1);
    const ws = rows[0];
    if (!ws) return { ok: false, source: 'none' };
    if (!ws.lainUrl) return { ok: false, source: 'unconfigured' };
    const lainUrl = ws.lainUrl;

    const build = async (): Promise<OrgGraph> => {
      const client = await getLainClient({ lainUrl, apiVersion: '1', timeoutMs: 20_000 });
      return toOrgGraph(await buildEndpointTopology(client));
    };
    const key = `${ws.id}|${lainUrl}|live`;
    try {
      const cached = refresh ? await cache.refresh(key, build) : await cache.get(key, build);
      return {
        ok: true,
        graph: cached.graph,
        meta: {
          source: 'lain',
          lainUrl,
          generatedAt: cached.generatedAt,
          stale: cached.stale,
          refreshing: cached.refreshing,
          ...(cached.lastError !== undefined ? { lastError: cached.lastError } : {}),
        },
      };
    } catch (e) {
      return {
        ok: false,
        source: 'error',
        error: isLainCallError(e) ? e.message : e instanceof Error ? e.message : 'lain unreachable',
      };
    }
  }

  const EMPTY = { nodes: [], edges: [], focus: null, unknownExpand: [] as string[] };

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
