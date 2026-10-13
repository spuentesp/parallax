import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { productTools } from '../tools/index.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

// Map tool names to Zod schemas — the MCP SDK's server.tool() requires Zod
// input schemas (or ToolAnnotations), not raw JSON Schema objects.
const inputSchemas: Record<string, z.ZodTypeAny> = {
  parallax_explore: z.object({
    orgId: z.string().min(1),
    focus: z.enum(['services', 'consumers', 'providers']).optional(),
    serviceId: z.string().optional(),
  }),
  parallax_assess_pr: z
    .object({
      prUrl: z.string().url().optional(),
      orgId: z.string().min(1),
      repo: z.string().min(1).optional(),
      base: z.string().min(1).optional(),
      head: z.string().min(1).optional(),
    })
    .refine((v) => v.prUrl !== undefined || (v.repo && v.base && v.head), {
      message: 'prUrl OR (repo, base, head) must be provided',
    }),
  parallax_get_assessment: z.object({ assessmentId: z.string().min(1) }),
  parallax_get_evidence: z.object({
    assessmentId: z.string().min(1),
    evidenceId: z.string().min(1),
  }),
};

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'parallax', version: '0.1.0' });
  for (const t of productTools) {
    const schema = inputSchemas[t.name] ?? z.object({});
    // MCP SDK's server.tool() expects a record of Zod schemas (one per field).
    // Build it from the schema's shape when possible; fall back to empty.
    const shape: Record<string, z.ZodTypeAny> = schema instanceof z.ZodObject ? schema.shape : {};
    server.tool(t.name, t.description, shape, async () => {
      const err = {
        code: 'ApiEndpointNotImplemented',
        message: `${t.name} is registered but lands in a later subproject.`,
        doc: SPEC_DOC,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(err) }],
        isError: true,
      };
    });
  }
  return server;
}

export function buildTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}
