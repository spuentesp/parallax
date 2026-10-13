export * from './assess-pr.js';
export * from './explore.js';
export * from './get-assessment.js';
export * from './get-evidence.js';

import { assessPrTool } from './assess-pr.js';
import { exploreTool } from './explore.js';
import { getAssessmentTool } from './get-assessment.js';
import { getEvidenceTool } from './get-evidence.js';

export const productTools = [exploreTool, assessPrTool, getAssessmentTool, getEvidenceTool];
