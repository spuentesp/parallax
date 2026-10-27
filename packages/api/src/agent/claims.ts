// Afirmaciones verificables del investigador (docs/superpowers/specs/
// 2026-10-26-verifiable-claims-design.md). El modelo cierra con `submit_answer`:
// prosa para humanos + afirmaciones tipadas. El MOTOR adjudica las relaciones
// entre servicios; el modelo no decide ningún hecho (P INV 2). Una afirmación
// contradicha no invalida la respuesta: se señala (verdict + lo que dice el motor).

import { z } from 'zod';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { ToolSpec } from './nemotron.js';

export const SUBMIT_TOOL = 'submit_answer';

const RelationClaim = z
  .object({
    kind: z.literal('relation'),
    /** Servicio que consume (nombre del servicio o de su repo). */
    consumer: z.string().min(1),
    /** Servicio consumido. */
    provider: z.string().min(1),
    polarity: z.enum(['present', 'absent']),
    /** Opcional: el motor adjudica la relación con o sin ella. */
    evidence: z.array(z.string()).optional(),
  })
  .strict();

const NoteClaim = z
  .object({
    kind: z.literal('note'),
    text: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  })
  .strict();

export const Claim = z.discriminatedUnion('kind', [RelationClaim, NoteClaim]);
export type Claim = z.infer<typeof Claim>;

export const SubmitAnswerArgs = z
  .object({
    answer: z.string().min(1),
    claims: z.array(Claim).max(20).optional(),
  })
  .strict();
export type SubmitAnswerArgs = z.infer<typeof SubmitAnswerArgs>;

export const SUBMIT_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: SUBMIT_TOOL,
    description:
      'Finish the investigation. `answer` is the explanation for a human (markdown, cite evidence ids as [ev:<id>]). `claims` are the checkable statements behind it: a `relation` claim says a service consumes (polarity "present") or does not consume ("absent") another service and the engine will verify it; a `note` claim is any other statement and needs at least one evidence id. Only claim relations between services of the workspace map.',
    parameters: z.toJSONSchema(SubmitAnswerArgs) as Record<string, unknown>,
  },
};

export type ClaimVerdict =
  | 'verified'
  | 'contradicted'
  | 'unverifiable'
  | 'supported'
  | 'unsupported';

export interface ClaimEvidence {
  accepted: string[];
  /** Recibos de consulta (q:N) citados que existen en esta investigación. */
  receipts: string[];
  rejected: Array<{ ref: string; reason: string }>;
}

export interface ClaimResult {
  claim: Claim;
  verdict: ClaimVerdict;
  reason: string;
  /** Lo que el motor dice de la relación (sólo para `relation`). */
  engine?: { uses: number; endpoints: string[]; complete: boolean };
  evidence: ClaimEvidence;
}

export interface ClaimsSummary {
  total: number;
  verified: number;
  contradicted: number;
  unverifiable: number;
  supported: number;
  unsupported: number;
}

export function summarizeClaims(results: readonly ClaimResult[]): ClaimsSummary {
  const count = (v: ClaimVerdict): number => results.filter((r) => r.verdict === v).length;
  return {
    total: results.length,
    verified: count('verified'),
    contradicted: count('contradicted'),
    unverifiable: count('unverifiable'),
    supported: count('supported'),
    unsupported: count('unsupported'),
  };
}

export interface ClaimVerifierDeps {
  lain: LainAdapter;
  view: string;
  /** Resuelve un nombre de servicio (o el de su repo) al servicio del catálogo. */
  resolveService: (name: string) => Promise<{ service: string; repo: string } | null>;
  /** Valida refs de evidencia contra lo que el backend entregó (INV 1). */
  validateRefs: (refs: string[]) => Promise<ClaimEvidence>;
}

const NO_EVIDENCE: ClaimEvidence = { accepted: [], receipts: [], rejected: [] };

function unreviewedRepos(scope: unknown): string[] {
  const list = (scope as { unreviewed?: unknown } | undefined)?.unreviewed;
  if (!Array.isArray(list)) return [];
  return list.map((entry) =>
    typeof entry === 'string' ? entry : String((entry as { repo?: unknown })?.repo ?? ''),
  );
}

async function verifyRelation(
  claim: Extract<Claim, { kind: 'relation' }>,
  deps: ClaimVerifierDeps,
  evidence: ClaimEvidence,
): Promise<ClaimResult> {
  const consumer = await deps.resolveService(claim.consumer);
  const provider = await deps.resolveService(claim.provider);
  const missing = [
    consumer ? null : `consumer "${claim.consumer}"`,
    provider ? null : `provider "${claim.provider}"`,
  ].filter((m): m is string => m !== null);
  if (!consumer || !provider) {
    return {
      claim,
      verdict: 'unverifiable',
      reason: `${missing.join(' and ')} not in the analyzed view; the engine cannot adjudicate it`,
      evidence,
    };
  }

  let svc: Awaited<ReturnType<LainAdapter['getService']>>;
  try {
    svc = await deps.lain.getService({ snapshot: deps.view as never, service: provider.service });
  } catch (e) {
    return {
      claim,
      verdict: 'unverifiable',
      reason: `engine lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      evidence,
    };
  }

  const uses =
    svc.consumers
      .find((c) => c.service === consumer.service)
      ?.uses.filter((u) => u.endpoint?.key) ?? [];
  const unreviewed = unreviewedRepos((svc as { scope?: unknown }).scope);
  const providerReviewed = (svc as { provider_reviewed?: unknown }).provider_reviewed !== false;
  const complete =
    providerReviewed && !unreviewed.includes(consumer.repo) && !unreviewed.includes(provider.repo);
  const engine = {
    uses: uses.length,
    endpoints: [...new Set(uses.map((u) => u.endpoint?.key as string))].slice(0, 3),
    complete,
  };
  const edge = uses.length > 0;
  const subject = `${consumer.service} → ${provider.service}`;

  if (claim.polarity === 'present') {
    if (edge) {
      return {
        claim,
        verdict: 'verified',
        reason: `engine records ${uses.length} use(s) of ${provider.service} by ${consumer.service}`,
        engine,
        evidence,
      };
    }
    return complete
      ? {
          claim,
          verdict: 'contradicted',
          reason: `engine records no use of ${provider.service} by ${consumer.service} over a complete scope (${subject})`,
          engine,
          evidence,
        }
      : {
          claim,
          verdict: 'unverifiable',
          reason: `engine records no ${subject} edge, but the scope is incomplete (unreviewed: ${unreviewed.join(', ') || 'provider not reviewed'})`,
          engine,
          evidence,
        };
  }

  if (edge) {
    return {
      claim,
      verdict: 'contradicted',
      reason: `engine records ${uses.length} use(s) of ${provider.service} by ${consumer.service} (e.g. ${engine.endpoints.join(', ')})`,
      engine,
      evidence,
    };
  }
  return complete
    ? {
        claim,
        verdict: 'verified',
        reason: `engine records no ${subject} edge over a complete scope`,
        engine,
        evidence,
      }
    : {
        claim,
        verdict: 'unverifiable',
        reason: `no ${subject} edge found, but absence cannot be confirmed: scope incomplete (unreviewed: ${unreviewed.join(', ') || 'provider not reviewed'})`,
        engine,
        evidence,
      };
}

export async function verifyClaims(
  claims: readonly Claim[],
  deps: ClaimVerifierDeps,
): Promise<ClaimResult[]> {
  const out: ClaimResult[] = [];
  for (const claim of claims) {
    const evidence = claim.evidence?.length ? await deps.validateRefs(claim.evidence) : NO_EVIDENCE;
    if (claim.kind === 'relation') {
      out.push(await verifyRelation(claim, deps, evidence));
      continue;
    }
    const supported = evidence.accepted.length + evidence.receipts.length > 0;
    out.push({
      claim,
      verdict: supported ? 'supported' : 'unsupported',
      reason: supported
        ? `${evidence.accepted.length + evidence.receipts.length} citation(s) resolved`
        : 'no cited evidence id was delivered by the backend and resolved in the view',
      evidence,
    });
  }
  return out;
}
