import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as schema from '../db/schema.js';

const WorkspaceInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
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
      const { name, description } = req.body as { name: string; description?: string };
      const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await app.db.insert(schema.workspace).values({
        id,
        name,
        description: description ?? null,
        createdAt: Date.now(),
      });
      return { workspace: { id, name, description, repos: [], repoCount: 0 } };
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
};
