import { z } from 'zod';
import type { AssessmentId } from './ids.js';

export const PublicationState = z.enum(['PENDING', 'CONFIRMED', 'UNCERTAIN']);
export type PublicationState = z.infer<typeof PublicationState>;

export const Publication = z.object({
  assessmentId: z.string().min(1),
  target: z.string().min(1),
  state: PublicationState,
  marker: z.string().min(1),
  remoteId: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type Publication = z.infer<typeof Publication> & { assessmentId: AssessmentId };
