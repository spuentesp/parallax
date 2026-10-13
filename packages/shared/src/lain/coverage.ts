import { z } from 'zod';

export const RepoOmission = z.object({
  repo: z.string().min(1),
  cause: z.string().min(1),
});
export type RepoOmission = z.infer<typeof RepoOmission>;

export const Truncation = z.object({
  repo: z.string().min(1),
  surface: z.string().min(1),
});
export type Truncation = z.infer<typeof Truncation>;

export const LainCoverage = z.object({
  reviewed: z.array(z.string().min(1)),
  omitted: z.array(RepoOmission),
  truncated: z.array(Truncation),
});
export type LainCoverage = z.infer<typeof LainCoverage>;
