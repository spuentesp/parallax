import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { type ApiClient, ApiEndpointNotImplemented } from './api-client.js';
import { TraceFlowInputSchema } from './tools/trace_flow.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

export function buildMcpServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'parallax', version: '0.1.0' });

  server.tool(
    'parallax_explore',
    'Explore an organization: list services, get a service with its consumers.',
    {
      orgId: z.string().min(1),
      focus: z.enum(['services', 'consumers', 'providers']).optional(),
      serviceId: z.string().optional(),
    },
    async (args) => {
      try {
        const data = await api.get(`/orgs/${args.orgId}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(e.body) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  server.tool(
    'parallax_assess_pr',
    'Trigger a PR impact assessment (lands in subproject 3).',
    {
      prUrl: z.string().url().optional(),
      orgId: z.string().min(1),
      repo: z.string().min(1).optional(),
      base: z.string().min(1).optional(),
      head: z.string().min(1).optional(),
    },
    async (args) => {
      const body = args.prUrl
        ? { prUrl: args.prUrl, orgId: args.orgId }
        : args.repo && args.base && args.head
          ? { repo: args.repo, base: args.base, head: args.head, orgId: args.orgId }
          : null;
      if (body === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'repo, base and head are required when prUrl is absent',
              }),
            },
          ],
          isError: true,
        };
      }
      try {
        const data = await api.post('/assessments', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(e.body) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  server.tool(
    'parallax_get_assessment',
    'Read a persisted assessment (lands in subproject 3).',
    { assessmentId: z.string().min(1) },
    async (args) => {
      try {
        const data = await api.get(`/assessments/${args.assessmentId}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ...e.body, specDoc: SPEC_DOC }),
              },
            ],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  server.tool(
    'parallax_get_evidence',
    'Read evidence (lands in subproject 3).',
    {
      assessmentId: z.string().min(1),
      evidenceId: z.string().min(1),
    },
    async () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              code: 'ApiEndpointNotImplemented',
              message: 'parallax_get_evidence lands in subproject 3',
              doc: SPEC_DOC,
            }),
          },
        ],
        isError: true,
      };
    },
  );

  server.tool(
    'parallax_step_call_stack',
    'Traverse the call stack on demand for a function or class. Returns definition file:line, outgoing calls (what it calls), and incoming callers (who calls it).',
    {
      workspaceId: z.string().min(1),
      repo: z.string().min(1),
      symbol: z.string().min(1),
    },
    async (args) => {
      try {
        const qs = new URLSearchParams({ repo: args.repo, symbol: args.symbol });
        const data = await api.get(
          `/api/workspaces/${args.workspaceId}/graph/symbol-context?${qs}`,
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(e.body) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  server.tool(
    'parallax_get_call_chain',
    'Find the call path between two symbols within a repo (from -> to).',
    {
      workspaceId: z.string().min(1),
      repo: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
    },
    async (args) => {
      try {
        const qs = new URLSearchParams({ repo: args.repo, from: args.from, to: args.to });
        const data = await api.get(`/api/workspaces/${args.workspaceId}/graph/call-chain?${qs}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(e.body) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  server.tool(
    'trace_flow',
    'Trace a value\'s flow through the codebase across boundaries (UI to DB, RPC to service, etc.). ' +
    'Replaces manual get_call_chain + trace_impact with a single cross-boundary trace. ' +
    'Supports BFS (impact analysis) and DFS (root cause analysis) strategies. ' +
    'Reports explicit gaps where the trace cannot continue.',
    TraceFlowInputSchema,
    async (args) => {
      try {
        const data = await api.post(`/api/workspaces/${args.workspaceId || 'default'}/trace/flow`, args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (e) {
        if (e instanceof ApiEndpointNotImplemented) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(e.body) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );

  return server;
}

export async function runStdio(api: ApiClient): Promise<void> {
  const server = buildMcpServer(api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
