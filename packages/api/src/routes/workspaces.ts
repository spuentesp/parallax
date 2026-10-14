import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { getLainClient } from '../lain-adapter/client.js';
import { isLainCallError } from '../lain-adapter/errors.js';
import { buildServiceTopology } from '../topology.js';

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

  // Service topology for a workspace, built from its LAIN server.
  app.get(
    '/api/workspaces/:id/topology',
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
      if (!ws[0]) return { topology: null, source: 'none' as const, stats: null };
      const repos = await app.db
        .select()
        .from(schema.repo)
        .where(eq(schema.repo.workspaceId, (req.params as { id: string }).id));

      if (!ws[0].lainUrl) {
        return {
          topology: { nodes: [], edges: [] },
          source: 'unconfigured' as const,
          stats: { services: 0, dependencies: 0, repos: [], unresolvedInbound: 0 },
          workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
        };
      }

      try {
        const client = await getLainClient({
          lainUrl: ws[0].lainUrl,
          apiVersion: '1',
          timeoutMs: 20_000,
        });
        const topology = await buildServiceTopology(client);
        return {
          topology: { nodes: topology.nodes, edges: topology.edges },
          stats: topology.stats,
          source: 'lain' as const,
          lainUrl: ws[0].lainUrl,
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
          stats: { services: 0, dependencies: 0, repos: [], unresolvedInbound: 0 },
          source: 'error' as const,
          error: detail,
          workspace: { id: ws[0].id, name: ws[0].name, repoCount: repos.length },
        };
      }
    },
  );
};
