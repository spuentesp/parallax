import { z } from 'zod';
import { FindingClass } from '../lain/enums.js';
import type { AssessmentId, EvidenceId } from './ids.js';

export const Finding = z.object({
  id: z.string().min(1),
  assessmentId: z.string().min(1),
  changeDetected: z.object({
    kind: z.string().min(1),
    service: z.string().min(1),
    field: z.string().min(1).optional(),
    route: z.string().min(1).optional(),
  }),
  classification: FindingClass,
  consumers: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
});
export type Finding = z.infer<typeof Finding> & {
  assessmentId: AssessmentId;
  evidenceRefs: EvidenceId[];
};
