import { z } from 'zod';

export const FindingClass = z.enum(['Verified', 'NeedsInvestigation', 'NoKnownImpact']);
export type FindingClass = z.infer<typeof FindingClass>;

export const EdgeType = z.enum(['confirmed', 'heuristic']);
export type EdgeType = z.infer<typeof EdgeType>;

// El contrato real de todas las tools es `snapshot`: 'live' para la vista en
// proceso, o el id `snap_<hex>` devuelto por prepare_snapshot.
export const LainView = z.union([z.literal('live'), z.string().regex(/^snap_[0-9a-f]+$/)]);
export type LainView = z.infer<typeof LainView>;
