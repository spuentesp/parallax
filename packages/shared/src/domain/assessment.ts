import { z } from 'zod';
import type { AssessmentId, OrgId } from './ids.js';

export const AssessmentStatus = z.enum([
  'QUEUED',
  'SNAPSHOTTING',
  'ANALYZING',
  'EXPLAINING',
  'READY',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);
export type AssessmentStatus = z.infer<typeof AssessmentStatus>;

export const AssessmentView = z.object({
  repos: z.record(z.string(), z.string().min(1)),
});
export type AssessmentView = z.infer<typeof AssessmentView>;

export const AssessmentManifest = z.object({
  base: AssessmentView,
  head: AssessmentView,
  configHash: z.string().min(1).optional(),
});
export type AssessmentManifest = z.infer<typeof AssessmentManifest>;

export const AssessmentInput = z.union([
  z.object({
    prUrl: z.string().url(),
    orgId: z.string().min(1),
  }),
  z.object({
    repo: z.string().min(1),
    base: z.string().min(1),
    head: z.string().min(1),
    orgId: z.string().min(1),
  }),
]);
export type AssessmentInput =
  | { prUrl: string; orgId: OrgId }
  | { repo: string; base: string; head: string; orgId: OrgId };

export const Assessment = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  inputDigest: z.string().min(1),
  status: AssessmentStatus,
  baseId: z.string().nullable(),
  headId: z.string().nullable(),
  manifest: AssessmentManifest,
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type Assessment = z.infer<typeof Assessment> & {
  id: AssessmentId;
  orgId: OrgId;
};
