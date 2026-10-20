import type { LainView } from '@parallax/shared/lain';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { runAdvisor } from '../advisor/index.js';
import {
  buildGraphChildren,
  buildGraphRoot,
  deriveLainRepoId,
  resolveSymbolSnippet,
} from '../code-graph.js';
import * as schema from '../db/schema.js';
import { GitHubReader, type OpenPrItem, PrUrlError, parseGithubRepoUri } from '../github/reader.js';
import { getLainClient } from '../lain-adapter/client.js';
import { isLainCallError } from '../lain-adapter/errors.js';
import { buildEndpointTopology } from '../topology.js';

const WorkspaceInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  lainUrl: z.string().url().optional(),
});

const RepoInput = z.object({
  uri: z.string().min(1),
  sha: z.string().optional(),
  local: z.string().optional(),
});

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // PRs abiertos de los repos de GitHub del workspace (selector). Sólo lectura.
  // Un repo que no es de GitHub o que falla se reporta aparte: nunca desaparece
  // en silencio, y un listado truncado se declara.
  app.get('/api/workspaces/:id/prs', { config: { scopes: ['read'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [ws] = await app.db.select().from(schema.workspace).where(eq(schema.workspace.id, id));
    if (!ws) return reply.code(404).send({ error: 'workspace not found' });

    const repos = await app.db.select().from(schema.repo).where(eq(schema.repo.workspaceId, id));
    const reader = new GitHubReader({
      ...(app.config.githubApiBase ? { apiBase: app.config.githubApiBase } : {}),
      ...(app.config.githubReadToken ? { token: app.config.githubReadToken } : {}),
    });
    const prs: Array<OpenPrItem & { repo: string }> = [];
    const skipped: Array<{ repo: string; reason: string }> = [];
    const errors: Array<{ repo: string; code: string; message: string }> = [];
    const truncated: string[] = [];

    for (const r of repos) {
      const gh = parseGithubRepoUri(r.uri);
      if (!gh) {
        skipped.push({ repo: r.uri, reason: 'not_github' });
        continue;
      }
      try {
        const listing = await reader.listOpenPrs(gh.owner, gh.repo);
        prs.push(...listing.items.map((pr) => ({ ...pr, repo: r.uri })));
        if (listing.truncated) truncated.push(r.uri);
      } catch (err) {
        if (!(err instanceof PrUrlError)) throw err;
        errors.push({ repo: r.uri, code: err.code, message: err.message });
      }
    }

    prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { prs, skipped, errors, truncated };
  });

  // List workspaces
  app.get('/api/workspaces', { config: { scopes: ['read'] } }, async () => {
    const workspaces = await app.db.select().from(schema.workspace);
    const result = [];
    for (const w of workspaces) {
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, w.id));
      result.push({ ...w, repos, repoCount: repos.length });
    }
    return { workspaces: result };
  });

  // Create workspace
  app.post(
    '/api/workspaces',
    {
      config: { scopes: ['write'] },
      schema: { body: WorkspaceInput },
    },
    async (req) => {
      const { name, description, lainUrl } = req.body as {
        name: string;
        description?: string;
        lainUrl?: string;
      };
      const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await app.db.insert(schema.workspace).values({
        id,
        name,
        description: description ?? null,
        lainUrl: lainUrl ?? null,
        createdAt: Date.now(),
      });
      return {
        workspace: { id, name, description, lainUrl: lainUrl ?? null, repos: [], repoCount: 0 },
      };
    },
  );

  // Get workspace detail
  app.get(
    '/api/workspaces/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return { workspace: null };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));
      return { workspace: { ...ws[0], repos, repoCount: repos.length } };
    },
  );

  // Add repo to workspace
  app.post(
    '/api/workspaces/:id/repos',
    {
      config: { scopes: ['write'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: RepoInput,
      },
    },
    async (req) => {
      const { uri, sha, local } = req.body as { uri: string; sha?: string; local?: string };
      const id = `repo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await app.db.insert(schema.repo).values({
        id,
        workspaceId: (req.params as { id: string }).id,
        uri,
        sha: sha ?? null,
        local: local ?? null,
        createdAt: Date.now(),
      });
      return { repo: { id, workspaceId: (req.params as { id: string }).id, uri, sha, local } };
    },
  );

  // Remove repo
  app.delete(
    '/api/workspaces/:id/repos/:repoId',
    {
      config: { scopes: ['write'] },
      schema: {
        params: z.object({ id: z.string().min(1), repoId: z.string().min(1) }),
      },
    },
    async (req) => {
      await app.db
        .delete(schema.repo)
        .where(eq(schema.repo.id, (req.params as { repoId: string }).repoId));
      return { deleted: true };
    },
  );

  // Generate LAIN config for a workspace
  app.get(
    '/api/workspaces/:id/lain-config',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return { config: null };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));

      // Generate repos.yaml content for LAIN
      const lines = [
        `data_dir: /var/parallax/lain-data/${(req.params as { id: string }).id}`,
        '',
        'repos:',
      ];
      for (const repo of repos) {
        lines.push(`  - id: ${repo.id}`);
        lines.push(`    source:`);
        lines.push(`      type: workspace_dir`);
        lines.push(`      path: ${repo.local ?? repo.uri}`);
      }
      lines.push('');
      lines.push('services:');
      // Service definitions would be inferred from LAIN analysis
      // For now, list repos as services
      for (const repo of repos) {
        lines.push(`  - name: ${repo.id}`);
        lines.push(`    repo: ${repo.id}`);
      }

      return {
        config: lines.join('\n'),
        workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
      };
    },
  );

  // Evidence panel: resolve citation refs, then open the code they point at
  // in the same view. A ref that does not resolve stays visible as
  // exists:false — never silently dropped (INV 3).
  app.post(
    '/api/workspaces/:id/evidence',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: z.object({
          refs: z.array(z.string().min(1)).min(1).max(50),
          contextLines: z.number().int().min(0).max(20).optional(),
          snapshot: z.string().min(1).optional(),
        }),
      },
    },
    async (req) => {
      const { refs, contextLines, snapshot } = req.body as {
        refs: string[];
        contextLines?: number;
        snapshot?: string;
      };
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]?.lainUrl) {
        return { items: [], source: 'unconfigured' as const, view: null };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const view = snapshot ?? 'live';
        const window_ = contextLines ?? 8;

        const resolved = await client.resolveEvidence({
          snapshot: view,
          refs,
          ...(contextLines !== undefined ? { context_lines: contextLines } : {}),
        });

        const items = [];
        for (const item of resolved.items) {
          const anchor = item.node?.ref;
          let source: unknown = null;
          if (item.exists && anchor?.repo && anchor.path && anchor.line != null) {
            try {
              source = await client.readSource({
                snapshot: view,
                repo: anchor.repo,
                path: anchor.path,
                start: Math.max(0, anchor.line - window_ - 1),
                end: anchor.line + window_,
              });
            } catch (e) {
              source = {
                error: isLainCallError(e) ? e.message : 'read_source failed',
              };
            }
          }
          items.push({ ...item, source });
        }
        return { items, source: 'lain' as const, view, lainUrl: ws[0].lainUrl };
      } catch (e) {
        return {
          items: [],
          source: 'error' as const,
          error: isLainCallError(e) ? e.message : 'lain unreachable',
        };
      }
    },
  );

  // Topología a nivel de endpoint para un workspace, desde su servidor LAIN.
  // Acepta filtros: kind (http/topic/graphql/…), service, binding y
  // minConfidence.
  app.get(
    '/api/workspaces/:id/topology',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z
          .object({
            kind: z.string().min(1).optional(),
            service: z.string().min(1).optional(),
            binding: z.enum(['static', 'heuristic']).optional(),
            minConfidence: z.coerce.number().min(0).max(1).optional(),
          })
          .loose(),
      },
    },
    async (req) => {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      const q = req.query as {
        kind?: string;
        service?: string;
        binding?: 'static' | 'heuristic';
        minConfidence?: number;
      };
      const emptyStats = {
        services: 0,
        endpoints: 0,
        dependencies: 0,
        repos: [] as string[],
        byKind: {} as Record<string, number>,
      };
      if (!ws[0]) return { topology: null, source: 'none' as const, stats: null };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));

      if (!ws[0].lainUrl) {
        return {
          topology: { nodes: [], edges: [] },
          source: 'unconfigured' as const,
          stats: emptyStats,
          workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
        };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const topology = await buildEndpointTopology(client, {
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.service ? { service: q.service } : {}),
          ...(q.binding ? { binding: q.binding } : {}),
          ...(q.minConfidence !== undefined ? { minConfidence: q.minConfidence } : {}),
        });
        return {
          topology: { nodes: topology.nodes, edges: topology.edges },
          stats: topology.stats,
          source: 'lain' as const,
          lainUrl: ws[0].lainUrl,
          filters: q,
          workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
        };
      } catch (e) {
        const detail = isLainCallError(e)
          ? e.code === 'LainUnavailable'
            ? e.message
            : `${e.code}: ${'message' in e ? e.message : ''}`
          : `lain unreachable at ${ws[0].lainUrl}`;
        return {
          topology: { nodes: [], edges: [] },
          stats: emptyStats,
          source: 'error' as const,
          error: detail,
          workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
        };
      }
    },
  );

  // Grafo de código expandible (paquete raw de lain vía query_graph). La raíz
  // trae la estructura de alto nivel de cada repo; la expansión de un nodo se
  // pide a /graph/children y devuelve lo que CONTIENE (Contains saliente) más
  // sus vecinos de comunicación agrupados por arista — el motor nunca devuelve
  // aristas, así que no se sintetizan pares (INV 3).
  app.get(
    '/api/workspaces/:id/graph',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return { graph: null, source: 'none' as const };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));
      const workspace = { id: ws[0].id, name: ws[0].name, repoCount: repos.length };

      if (!ws[0].lainUrl) {
        return { graph: { repos: [] }, source: 'unconfigured' as const, workspace };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        // repo_id de LAIN se deriva del checkout local (orders, saleor, …),
        // no del id interno del workspace.
        const repoIds = repos.map((r) => deriveLainRepoId(r));
        const graph = await buildGraphRoot(client, repoIds);
        return { graph, source: 'lain' as const, lainUrl: ws[0].lainUrl, workspace };
      } catch (e) {
        return {
          graph: { repos: [] },
          source: 'error' as const,
          error: isLainCallError(e) ? e.message : 'lain unreachable',
          workspace,
        };
      }
    },
  );

  // Expansión de un nodo: hijos (Contains saliente) + vecinos de comunicación
  // (Calls/Uses/Imports/Produces/Consumes/CallsHttp, ambos sentidos). El nodo
  // se dirige por type+name: el filtro `id` de find es inerte en el motor.
  app.get(
    '/api/workspaces/:id/graph/children',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z
          .object({
            repo: z.string().min(1),
            type: z.string().min(1),
            name: z.string().min(1),
          })
          .loose(),
      },
    },
    async (req, reply) => {
      const { repo, type, name } = req.query as { repo: string; type: string; name: string };
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return reply.code(404).send({ code: 'NotFound', detail: 'workspace not found' });
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));

      // Scoping: sólo repos del propio workspace.
      const allowed = new Set(repos.map((r) => deriveLainRepoId(r)));
      if (!allowed.has(repo)) {
        return reply
          .code(400)
          .send({ code: 'BadRequest', detail: `repo '${repo}' is not part of this workspace` });
      }
      if (!ws[0].lainUrl) {
        return { children: null, source: 'unconfigured' as const };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const result = await buildGraphChildren(client, { repo, type, name });
        return { ...result, source: 'lain' as const };
      } catch (e) {
        return {
          children: null,
          source: 'error' as const,
          error: isLainCallError(e) ? e.message : 'lain unreachable',
        };
      }
    },
  );

  // Fuente de un símbolo vía explain_symbol (aporta el path) + get_code_snippet.
  app.get(
    '/api/workspaces/:id/graph/snippet',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z
          .object({
            repo: z.string().min(1),
            symbol: z.string().min(1),
          })
          .loose(),
      },
    },
    async (req, reply) => {
      const { repo, symbol } = req.query as { repo: string; symbol: string };
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return reply.code(404).send({ code: 'NotFound', detail: 'workspace not found' });
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));
      const allowed = new Set(repos.map((r) => deriveLainRepoId(r)));
      if (!allowed.has(repo)) {
        return reply
          .code(400)
          .send({ code: 'BadRequest', detail: `repo '${repo}' is not part of this workspace` });
      }
      if (!ws[0].lainUrl) {
        return { snippet: null, source: 'unconfigured' as const };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const snippet = await resolveSymbolSnippet(client, repo, symbol);
        return { snippet, source: 'lain' as const };
      } catch (e) {
        return {
          snippet: null,
          source: 'error' as const,
          error: isLainCallError(e) ? e.message : 'lain unreachable',
        };
      }
    },
  );

  // Config advisor (§10): cierra huecos de configuración de LAIN con
  // propuestas validadas + evidencia. Escanea los checkouts locales del
  // workspace, correlaciona con list_unresolved/list_contracts (paginados al
  // agotamiento) y emite el YAML del §6. No aplica nada: el operador aplica.
  app.get(
    '/api/workspaces/:id/advisor',
    {
      config: { scopes: ['read'] },
      schema: {
        params: z.object({ id: z.string().min(1) }),
        querystring: z
          .object({
            emit: z.enum(['yaml']).optional(),
            snapshot: z.string().min(1).optional(),
          })
          .loose(),
      },
    },
    async (req) => {
      const ws = await app.db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, (req.params as { id: string }).id))
        .limit(1);
      if (!ws[0]) return { advisor: null };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));
      const q = req.query as { emit?: 'yaml'; snapshot?: string };
      const workspace = { id: ws[0].id, name: ws[0].name, repoCount: repos.length };

      if (!ws[0].lainUrl) {
        return { advisor: null, source: 'unconfigured' as const, workspace };
      }

      // El escaneo necesita el checkout en disco: sólo los repos con `local`.
      const scanRepos = repos
        .map((r) => ({ id: r.id, root: r.local }))
        .filter(
          (r): r is { id: string; root: string } => typeof r.root === 'string' && r.root !== '',
        );
      const scanIds = new Set(scanRepos.map((r) => r.id));
      const skipped = repos
        .filter((r) => !scanIds.has(r.id))
        .map((r) => `${r.id}: sin checkout local (repo.local); el escaneo lo omite`);

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 60_000,
        });
        const report = await runAdvisor(
          client,
          scanRepos,
          (q.snapshot as LainView | undefined) ?? 'live',
        );
        const advisor =
          skipped.length > 0 ? { ...report, notes: [...report.notes, ...skipped] } : report;
        if (q.emit === 'yaml') {
          return { yaml: advisor.yaml, workspace, source: 'lain' as const };
        }
        return { advisor, source: 'lain' as const, lainUrl: ws[0].lainUrl, workspace };
      } catch (e) {
        const detail = isLainCallError(e)
          ? e.message
          : `advisor failed: ${e instanceof Error ? e.message : String(e)}`;
        return { advisor: null, source: 'error' as const, error: detail, workspace };
      }
    },
  );
};
