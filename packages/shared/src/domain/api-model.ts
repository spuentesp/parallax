import { z } from 'zod';

// Contrato único entre superficies: estos schemas son la fuente de verdad de
// los modelos que la API sirve y el web consume. Los tipos de
// `packages/web/src/api/hooks.ts` y de `services/assessments.ts` se derivan de
// aquí con `z.infer` — nadie vuelve a escribirlos a mano (feature isolation
// nace de interfaces paralelas).

/**
 * Hallazgo del motor. Admite los dos vocabularios vivos: el del diff
 * (`{kind, service, field}`) y el que consumen los helpers de investigator
 * (`{endpoint, impact}`). `kind` se normaliza a '' cuando falta; cuando la
 * divergencia de vocabulario se cierre, endurecer a requerido.
 */
export const AssessmentFindingSchema = z.object({
  kind: z.string().default(''),
  side: z.string().optional(),
  field: z.string().optional(),
  route: z.string().optional(),
  compat: z.string().optional(),
  service: z.string().optional(),
  endpoint: z.object({ key: z.string().optional(), service: z.string().optional() }).optional(),
  impact: z
    .object({
      class: z.string().optional(),
      reasons: z.union([z.array(z.string()), z.string()]).optional(),
    })
    .optional(),
  affected: z
    .array(
      z.object({
        service: z.string().optional(),
        class: z.string().optional(),
        consumer: z.string().optional(),
      }),
    )
    .optional(),
});
export type AssessmentFinding = z.infer<typeof AssessmentFindingSchema>;

export const CoverageRepoNoteSchema = z.object({ repo: z.string(), reason: z.string() });

export const PresentedCoverageSchema = z
  .object({
    complete: z.boolean().optional(),
    summary: z.string().optional(),
    scope: z
      .object({
        reviewed: z.array(z.string()).optional(),
        unreviewed: z.array(z.union([CoverageRepoNoteSchema, z.string()])).optional(),
        excluded: z.array(z.union([CoverageRepoNoteSchema, z.string()])).optional(),
      })
      .optional(),
  })
  .nullable();
export type PresentedCoverage = z.infer<typeof PresentedCoverageSchema>;

export const ReportEvidenceSchema = z.object({
  id: z.string(),
  viewId: z.string(),
  repo: z.string(),
  sha: z.string(),
  path: z.string(),
  range: z.unknown(),
  hash: z.string(),
});
export type ReportEvidence = z.infer<typeof ReportEvidenceSchema>;

export const AssessmentReportSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  inputDigest: z.string(),
  status: z.string(),
  baseId: z.string().nullable(),
  headId: z.string().nullable(),
  manifest: z.unknown(),
  findings: z.array(AssessmentFindingSchema),
  engine: z.unknown(),
  coverage: PresentedCoverageSchema,
  evidence: z.array(ReportEvidenceSchema),
  explanation: z.object({
    status: z.string(),
    revision: z.number().nullable(),
    model: z.string().nullable(),
  }),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type AssessmentReport = z.infer<typeof AssessmentReportSchema>;

export const AssessmentSummarySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  status: z.string(),
  inputDigest: z.string(),
  findingCount: z.number(),
  coverageComplete: z.boolean(),
  coverageSummary: z.string().nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type AssessmentSummary = z.infer<typeof AssessmentSummarySchema>;

/** SHA ya resuelto por el flujo (7..40 hex) — mismo contrato que exige la API. */
export const ResolvedSha = z
  .string()
  .regex(/^[0-9a-fA-F]{7,64}$/, 'expected a resolved commit SHA');

const OptionalAssessmentFields = {
  configHash: z.string().min(1).max(256).optional(),
  excludeRepos: z.array(z.string().min(1)).optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
};

export const AssessmentRequestBody = z.union([
  z.object({
    prUrl: z.string().url(),
    orgId: z.string().min(1),
    ...OptionalAssessmentFields,
  }),
  z.object({
    repo: z.string().min(1),
    base: ResolvedSha,
    head: ResolvedSha,
    orgId: z.string().min(1),
    ...OptionalAssessmentFields,
  }),
]);
export type AssessmentRequestBody = z.infer<typeof AssessmentRequestBody>;
// Alias corto para el lado web.
export type AssessmentRequest = AssessmentRequestBody;
