import { z } from 'zod';
import { FindingClass } from './enums.js';

export const LainChangeType = z.enum([
  'FieldRemoved',
  'FieldAdded',
  'CompatibleChange',
  'FieldTypeChanged',
  'RouteRemoved',
  'RouteAdded',
  'RouteChanged',
]);
export type LainChangeType = z.infer<typeof LainChangeType>;

export const Binding = z.object({
  kind: z.enum(['confirmed', 'heuristic']),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1),
});
export type Binding = z.infer<typeof Binding>;

export const Match = z.object({
  field: z.string().min(1),
  evidence: z.object({
    repo: z.string().min(1),
    sha: z.string().min(1),
  }),
});
export type Match = z.infer<typeof Match>;

export const LainFinding = z.object({
  id: z.string().min(1),
  change: z.object({
    kind: LainChangeType,
    service: z.string().min(1),
    field: z.string().min(1).optional(),
    route: z.string().min(1).optional(),
  }),
  classification: FindingClass,
  consumers: z.array(
    z.object({
      consumer: z.string().min(1),
      matches: z.array(Match).optional(),
    }),
  ),
});
export type LainFinding = z.infer<typeof LainFinding>;
