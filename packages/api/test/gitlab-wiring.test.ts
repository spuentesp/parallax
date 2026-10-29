import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const mr = {
  iid: 4,
  web_url: 'https://gitlab.com/group/sub/shop/-/merge_requests/4',
  title: 'update',
  state: 'opened',
  source_branch: 'feature',
  target_branch: 'main',
  updated_at: '2026-10-29',
  diff_refs: { start_sha: base, head_sha: head },
  changes_count: '1',
};
const diff = { old_path: 'src/a.ts', new_path: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' };

describe('GitLab integration', () => {
  it('lists, evaluates and reports a private merge request through real API and webhook paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parallax-gitlab-'));
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    const requests: Array<{ method: string; url: string; token: string | undefined }> = [];
    let pendingRefs = 0;
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      const token = req.headers['private-token'] as string | undefined;
      requests.push({ method: req.method ?? '', url, token });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        if (token !== 'write-token') {
          res.statusCode = 401;
          res.end('{}');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          writes.push({ url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          res.end('{}');
        });
        return;
      }
      if (token !== 'read-token') {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      if (url.includes('/repository/compare'))
        res.end(JSON.stringify({ diffs: [diff], compare_timeout: false }));
      else if (url.includes('?state=opened')) res.end(JSON.stringify([mr]));
      else if (pendingRefs > 0) {
        pendingRefs--;
        res.end(JSON.stringify({ ...mr, diff_refs: null }));
      } else res.end(JSON.stringify(mr));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = {
      port: 0,
      databasePath: join(dir, 'db'),
      lainAdapter: 'mock' as const,
      mcpTransport: 'http-sse' as const,
      authTokens: [
        { token: 't', orgId: 'o', scopes: ['read', 'write'] as Array<'read' | 'write'> },
      ],
      webBundlePath: join(dir, 'web'),
      gitlabApiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v4`,
      gitlabReadToken: 'read-token',
      gitlabWriteToken: 'write-token',
      gitlabWebhookSecret: 'secret',
    };
    let app = await buildApp(config);
    try {
      const headers = { authorization: 'Bearer t' };
      const ws = await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        headers,
        payload: { name: 'shop' },
      });
      const orgId = ws.json().workspace.id as string;
      await app.db.insert(schema.repo).values({
        id: 'shop',
        workspaceId: orgId,
        uri: 'https://gitlab.com/group/sub/shop.git',
        createdAt: Date.now(),
      });
      const listing = await app.inject({
        method: 'GET',
        url: `/api/workspaces/${orgId}/prs`,
        headers,
      });
      expect(listing.json().prs[0].url).toBe(mr.web_url);
      const preview = await app.inject({
        method: 'POST',
        url: '/api/pr/resolve',
        headers,
        payload: { url: mr.web_url },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().pr).toMatchObject({ baseSha: base, headSha: head });
      await app.inject({
        method: 'PUT',
        url: `/api/workspaces/${orgId}/ci`,
        headers,
        payload: { mode: 'on-open-and-update', baseBranch: null, reportComments: true },
      });
      const event = {
        object_kind: 'merge_request',
        project: { path_with_namespace: 'group/sub/shop' },
        object_attributes: {
          action: 'open',
          iid: 4,
          source_project_id: 3,
          target_project_id: 3,
          last_commit: { id: head },
        },
      };
      const denied = await app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: { 'x-gitlab-token': 'bad' },
        payload: event,
      });
      expect(denied.statusCode).toBe(401);
      const malformed = await app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: { 'x-gitlab-token': 'secret' },
        payload: {
          ...event,
          object_attributes: {
            ...event.object_attributes,
            source_project_id: null,
            target_project_id: null,
          },
        },
      });
      expect(malformed.statusCode).toBe(400);
      for (const attributes of [
        { ...event.object_attributes, draft: true },
        { ...event.object_attributes, source_project_id: 9 },
      ]) {
        const ignored = await app.inject({
          method: 'POST',
          url: '/webhooks/gitlab',
          headers: { 'x-gitlab-token': 'secret' },
          payload: { ...event, object_attributes: attributes },
        });
        expect(ignored.json().handled).toBe(0);
      }
      const stale = await app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: { 'x-gitlab-token': 'secret' },
        payload: {
          ...event,
          object_attributes: { ...event.object_attributes, last_commit: { id: 'c'.repeat(40) } },
        },
      });
      expect(stale.json().queued).toBe(true);
      const staleDeadline = Date.now() + 5000;
      while (
        (await app.db.select().from(schema.gitlabWebhookInbox))[0]?.completedAt == null &&
        Date.now() < staleDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(
        (await app.db.select().from(schema.gitlabWebhookInbox))[0]?.completedAt,
      ).not.toBeNull();
      expect(await app.db.select().from(schema.assessment)).toHaveLength(0);
      pendingRefs = 1;
      const delivered = await app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: { 'x-gitlab-token': 'secret' },
        payload: event,
      });
      expect(delivered.json().queued).toBe(true);
      const duplicate = await app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: { 'x-gitlab-token': 'secret' },
        payload: event,
      });
      expect(duplicate.json().queued).toBe(false);
      const waiting = Date.now() + 5000;
      while (pendingRefs > 0 && Date.now() < waiting)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(pendingRefs).toBe(0);
      await app.close();
      app = await buildApp(config);
      await app.ready();
      const deadline = Date.now() + 10000;
      while (writes.length < 1 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      await app.assessmentWorker.drain();
      expect(writes).toHaveLength(1);
      expect(writes[0]?.body.body).toContain('Parallax advisory');
      expect(
        writes.every((w) => w.url.includes(`/projects/group%2Fsub%2Fshop/merge_requests/4/notes`)),
      ).toBe(true);
      expect(
        requests.filter((r) => r.method === 'GET').every((r) => r.token === 'read-token'),
      ).toBe(true);
      const rows = await app.db.select().from(schema.assessment);
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]?.manifestJson ?? '{}').pr.provider).toBe('gitlab');
      const manual = await app.inject({
        method: 'POST',
        url: '/api/assessments',
        headers,
        payload: { orgId, prUrl: mr.web_url },
      });
      expect(manual.statusCode).toBe(200);
      expect(manual.json().assessment.id).toBe(rows[0]?.id);
      const chat = await app.inject({
        method: 'POST',
        url: '/api/query',
        headers,
        payload: { orgId, question: `Please review ${mr.web_url}` },
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json().roadmap.assessmentId).toBe(rows[0]?.id);
      const mcpHeaders = {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const init = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: mcpHeaders,
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        },
      });
      const mcp = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...mcpHeaders, 'mcp-session-id': init.headers['mcp-session-id'] as string },
        payload: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'parallax_assess_pr', arguments: { orgId, prUrl: mr.web_url } },
        },
      });
      const line = mcp.body.split('\n').find((value) => value.startsWith('data: '));
      const result = JSON.parse(line?.slice(6) ?? '{}').result;
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].text).assessment.id).toBe(rows[0]?.id);
      const steps = await app.db.select().from(schema.jobStep);
      expect(steps.find((step) => step.step === 'code_impact')?.state).toBe('done');
      const [report] = await app.db.select().from(schema.prReport);
      expect(report?.provider).toBe('gitlab');
    } finally {
      await app.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
