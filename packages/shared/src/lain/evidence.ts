import { z } from 'zod';
import { LainView } from './enums.js';

export const LainEvidenceRef = z.object({
  repo: z.string().min(1),
  sha: z.string().min(1),
  path: z.string().min(1),
  range: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .optional(),
});
export type LainEvidenceRef = z.infer<typeof LainEvidenceRef>;

export const LainEvidence = z.object({
  id: z.string().min(1),
  view: LainView,
  ref: LainEvidenceRef,
});
export type LainEvidence = z.infer<typeof LainEvidence>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  truncated: boolean;
}

export function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  const start = Math.max(0, offset);
  const end = start + Math.max(0, limit);
  const slice = items.slice(start, end);
  const more = end < items.length;
  return {
    items: slice,
    nextCursor: more ? String(end) : null,
    truncated: more,
  };
}
