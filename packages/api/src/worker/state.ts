import type { AssessmentId, OrgId } from '@parallax/shared/domain';
import { z } from 'zod';

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

// Allowed transitions (P INV 5: READY only after persisting).
export const TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  QUEUED: ['SNAPSHOTTING', 'CANCELLED', 'FAILED'],
  SNAPSHOTTING: ['ANALYZING', 'FAILED', 'CANCELLED'],
  ANALYZING: ['EXPLAINING', 'PARTIAL', 'FAILED', 'CANCELLED'],
  EXPLAINING: ['READY', 'PARTIAL', 'FAILED', 'CANCELLED'],
  READY: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: AssessmentStatus, to: AssessmentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface AssessmentRecord {
  id: AssessmentId;
  orgId: OrgId;
  inputDigest: string;
  status: AssessmentStatus;
  baseId: string | null;
  headId: string | null;
  manifestJson: string;
  engineJson: string | null;
  coverageJson: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface AssessmentEvent {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: number;
}

// Idempotency: input_digest is computed from the assessment request.
// Same digest → same assessment (P INV 4).
export function computeInputDigest(input: {
  orgId: string;
  prUrl?: string;
  repo?: string;
  base?: string;
  head?: string;
  configHash?: string;
}): string {
  const canonical = JSON.stringify({
    orgId: input.orgId,
    prUrl: input.prUrl ?? null,
    repo: input.repo ?? null,
    base: input.base ?? null,
    head: input.head ?? null,
    configHash: input.configHash ?? null,
  });
  // Simple hash — not cryptographic, just deterministic.
  let h = 0;
  for (let i = 0; i < canonical.length; i++) {
    h = ((h << 5) - h + canonical.charCodeAt(i)) | 0;
  }
  return `digest_${(h >>> 0).toString(16).padStart(8, '0')}`;
}
