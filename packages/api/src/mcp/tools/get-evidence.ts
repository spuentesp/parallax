import { z } from 'zod';
import { apiNotImplemented } from './explore.js';

export const getEvidenceTool = {
  name: 'parallax_get_evidence',
  description: 'Read a single evidence ref from an assessment. Not implemented in subproject 1.',
  inputSchema: {
    type: 'object',
    properties: { assessmentId: { type: 'string' }, evidenceId: { type: 'string' } },
    required: ['assessmentId', 'evidenceId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export const GetEvidenceArgs = z.object({
  assessmentId: z.string().min(1),
  evidenceId: z.string().min(1),
});

export const getEvidenceNotImpl = () =>
  apiNotImplemented('parallax_get_evidence lands in subproject 3');
