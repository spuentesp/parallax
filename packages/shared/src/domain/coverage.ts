import { z } from 'zod';

export const Coverage = z.object({
  reviewed: z.array(z.string().min(1)),
  omitted: z.array(z.object({ repo: z.string().min(1), cause: z.string().min(1) })),
  refsUnresolved: z.array(z.string().min(1)),
  truncated: z.array(z.object({ repo: z.string().min(1), surface: z.string().min(1) })),
});
export type Coverage = z.infer<typeof Coverage>;
