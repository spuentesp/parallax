import { z } from 'zod';
import type { OrgId } from './ids.js';

// Shape validation only. The branded `OrgId` is a compile-time wrapper around
// `string`; Zod validates the runtime shape and the brand is preserved through
// the type-level export.

export const Org = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type Org = z.infer<typeof Org> & { id: OrgId };

export const OrgRepo = z.object({
  name: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{7,}$/),
  remote: z.string().url().optional(),
});
export type OrgRepo = z.infer<typeof OrgRepo>;

export const OrgService = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repo: z.string().min(1),
  description: z.string().optional(),
});
export type OrgService = z.infer<typeof OrgService>;

export const OrgManifest = z.object({
  orgId: z.string().min(1),
  repos: z.array(OrgRepo).min(1),
  services: z.array(OrgService).min(1),
  configVersion: z.string().min(1),
  lainUrl: z.string().url().optional(),
});
export type OrgManifest = z.infer<typeof OrgManifest> & { orgId: OrgId };
