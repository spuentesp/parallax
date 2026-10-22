import { z } from 'zod';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

export const exploreTool = {
  name: 'parallax_explore',
  description:
    'Explore an organization: list services, get a service with its consumers. ' +
    'Returns ApiEndpointNotImplemented (with a doc URL) when the underlying endpoint is not yet wired.',
  inputSchema: {
    type: 'object',
    properties: {
      orgId: { type: 'string' },
      focus: { type: 'string', enum: ['services', 'consumers', 'providers'] },
      serviceId: { type: 'string' },
    },
    required: ['orgId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export const ExploreArgs = z.object({
  orgId: z.string().min(1),
  focus: z.enum(['services', 'consumers', 'providers']).optional(),
  serviceId: z.string().optional(),
});
export type ExploreArgs = z.infer<typeof ExploreArgs>;

export const apiNotImplemented = (what: string) => ({
  code: 'ApiEndpointNotImplemented',
  message: what,
  doc: SPEC_DOC,
});

// Helpers de respuesta MCP: todo payload viaja como JSON en content[0].text.
export function jsonResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

export function errorResult(code: string, message: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ code, message, doc: SPEC_DOC }),
      },
    ],
    isError: true,
  };
}
