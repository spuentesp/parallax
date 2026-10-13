import { z } from 'zod';
import type { AssessmentId, EvidenceId, ProposalId } from './ids.js';

export const ProposalOption = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  supuestos: z.array(z.string().min(1)),
  evidencias: z.array(z.string().min(1)),
  acciones: z.array(z.string().min(1)),
});
export type ProposalOption = z.infer<typeof ProposalOption>;

export const ArchitectureProposal = z.object({
  id: z.string().min(1),
  assessmentId: z.string().min(1),
  objetivo: z.string().min(1),
  options: z.array(ProposalOption).min(1),
  adoptedOptionId: z.string().optional(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
export type ArchitectureProposal = z.infer<typeof ArchitectureProposal> & {
  id: ProposalId;
  assessmentId: AssessmentId;
  evidenceRefs: EvidenceId[];
};
