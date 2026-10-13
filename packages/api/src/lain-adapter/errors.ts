import { z } from 'zod';

export const LainCallErrorCode = z.enum([
  'LainUnavailable',
  'SnapshotNotReady',
  'ApiVersionMismatch',
  'AnalyzerVersionMismatch',
  'ToolSchemaMismatch',
  'IncompatibleView',
  'NotImplemented',
]);
export type LainCallErrorCode = z.infer<typeof LainCallErrorCode>;

export const LainCallError = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('LainUnavailable'),
    message: z.string(),
    cause: z.unknown().optional(),
  }),
  z.object({
    code: z.literal('SnapshotNotReady'),
    message: z.string(),
    snapshotId: z.string(),
  }),
  z.object({
    code: z.literal('ApiVersionMismatch'),
    message: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
  z.object({
    code: z.literal('AnalyzerVersionMismatch'),
    message: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
  z.object({
    code: z.literal('ToolSchemaMismatch'),
    message: z.string(),
    tool: z.string(),
    detail: z.string(),
  }),
  z.object({
    code: z.literal('IncompatibleView'),
    message: z.string(),
    view: z.string(),
  }),
  z.object({
    code: z.literal('NotImplemented'),
    message: z.string(),
    doc: z.string().url(),
  }),
]);
export type LainCallError = z.infer<typeof LainCallError>;

export function isLainCallError(value: unknown): value is LainCallError {
  return LainCallError.safeParse(value).success;
}
