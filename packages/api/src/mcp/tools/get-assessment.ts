import { z } from 'zod';
import { apiNotImplemented } from './explore.js';

export const getAssessmentTool = {
  name: 'parallax_get_assessment',
  description: 'Read a persisted assessment by id. Not implemented in subproject 1.',
  inputSchema: {
    type: 'object',
    properties: { assessmentId: { type: 'string' } },
    required: ['assessmentId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export const GetAssessmentArgs = z.object({ assessmentId: z.string().min(1) });

export const getAssessmentNotImpl = () =>
  apiNotImplemented('parallax_get_assessment lands in subproject 3');
