import { z } from 'zod';

export const FindingClass = z.enum(['Verified', 'NeedsInvestigation', 'NoKnownImpact']);
export type FindingClass = z.infer<typeof FindingClass>;

export const EdgeType = z.enum(['confirmed', 'heuristic']);
export type EdgeType = z.infer<typeof EdgeType>;

export const LainView = z.union([z.literal('live'), z.string().regex(/^snapshot:.+$/)]);
export type LainView = z.infer<typeof LainView>;
