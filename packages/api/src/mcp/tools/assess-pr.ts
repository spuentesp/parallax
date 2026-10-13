import { z } from 'zod';
import { apiNotImplemented } from './explore.js';

export const assessPrTool = {
  name: 'parallax_assess_pr',
  description:
    'Trigger a PR impact assessment. Returns ApiEndpointNotImplemented in subproject 1; lands in subproject 3.',
  inputSchema: {
    type: 'object',
    properties: {
      prUrl: { type: 'string' },
      orgId: { type: 'string' },
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
    },
    required: ['orgId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export const AssessPrArgs = z.union([
  z.object({ prUrl: z.string().url(), orgId: z.string().min(1) }),
  z.object({
    repo: z.string().min(1),
    base: z.string().min(1),
    head: z.string().min(1),
    orgId: z.string().min(1),
  }),
]);
export type AssessPrArgs = z.infer<typeof AssessPrArgs>;

export const assessPrNotImpl = () => apiNotImplemented('parallax_assess_pr lands in subproject 3');
