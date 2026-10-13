// Branded IDs: compile-time only, no runtime cost. Each brand is keyed by its
// own `unique symbol`, so `AssessmentId` and `EvidenceId` are structurally
// distinct and cannot be mixed without a cast. At runtime the value is a plain
// string; validation happens at the boundary.

export declare const assessmentIdBrand: unique symbol;
export declare const evidenceIdBrand: unique symbol;
export declare const explanationIdBrand: unique symbol;
export declare const orgIdBrand: unique symbol;
export declare const proposalIdBrand: unique symbol;
export declare const snapshotIdBrand: unique symbol;

export type AssessmentId = string & { [assessmentIdBrand]: void };
export type EvidenceId = string & { [evidenceIdBrand]: void };
export type ExplanationId = string & { [explanationIdBrand]: void };
export type OrgId = string & { [orgIdBrand]: void };
export type ProposalId = string & { [proposalIdBrand]: void };
export type SnapshotId = string & { [snapshotIdBrand]: void };

const nonEmptyString = (input: unknown, brand: string): string => {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError(`${brand}: expected a non-empty string`);
  }
  return input;
};

function makeParser<T>(brand: string) {
  return {
    parse(input: unknown): T {
      return nonEmptyString(input, brand) as T;
    },
    safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown } {
      try {
        return { success: true, data: nonEmptyString(input, brand) as T };
      } catch (e) {
        return { success: false, error: e };
      }
    },
  };
}

function makeConstructor<T>(brand: string) {
  return (input: string): T => nonEmptyString(input, brand) as T;
}

export const AssessmentId = makeParser<AssessmentId>('AssessmentId');
export const EvidenceId = makeParser<EvidenceId>('EvidenceId');
export const ExplanationId = makeParser<ExplanationId>('ExplanationId');
export const OrgId = makeParser<OrgId>('OrgId');
export const ProposalId = makeParser<ProposalId>('ProposalId');
export const SnapshotId = makeParser<SnapshotId>('SnapshotId');

export const asAssessmentId = makeConstructor<AssessmentId>('AssessmentId');
export const asEvidenceId = makeConstructor<EvidenceId>('EvidenceId');
export const asExplanationId = makeConstructor<ExplanationId>('ExplanationId');
export const asOrgId = makeConstructor<OrgId>('OrgId');
export const asProposalId = makeConstructor<ProposalId>('ProposalId');
export const asSnapshotId = makeConstructor<SnapshotId>('SnapshotId');
