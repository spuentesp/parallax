import { z } from 'zod';
import { getAssessmentReport } from '../../services/assessments.js';
import type { AssessmentToolDeps } from './assess-pr.js';
import { errorResult, jsonResult } from './explore.js';

export const getAssessmentTool = {
  name: 'parallax_get_assessment',
  description:
    'Read a persisted assessment by id. Same service as GET /api/assessments/:id: ' +
    'identity, findings and coverage come from the persisted report.',
  inputSchema: {
    type: 'object',
    properties: { assessmentId: { type: 'string' } },
    required: ['assessmentId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export const GetAssessmentArgs = z.object({ assessmentId: z.string().min(1) });

export const getAssessmentShape = {
  assessmentId: z.string().min(1),
};

// P09: la tool MCP lee el MISMO informe persistido que la ruta HTTP.
export function makeGetAssessmentHandler(deps: AssessmentToolDeps) {
  return async (args: unknown) => {
    const parsed = GetAssessmentArgs.safeParse(args);
    if (!parsed.success) {
      return errorResult('InvalidArguments', 'assessmentId is required');
    }
    const report = await getAssessmentReport(deps.db, parsed.data.assessmentId);
    if (!report) {
      return errorResult('NotFound', `assessment ${parsed.data.assessmentId} not found`);
    }
    return jsonResult({ assessment: report });
  };
}

export type GetAssessmentHandler = ReturnType<typeof makeGetAssessmentHandler>;
