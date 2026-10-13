import { z } from 'zod';
import { LainView } from '../lain/enums.js';
import type { AssessmentId, EvidenceId } from './ids.js';

export const EvidenceRef = z.object({
  id: z.string().min(1),
  assessmentId: z.string().min(1),
  view: LainView,
  repo: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{7,}$/),
  path: z.string().min(1),
  range: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .optional(),
  hash: z.string().min(1),
  source: z.string().min(1).optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef> & {
  id: EvidenceId;
  assessmentId: AssessmentId;
};
