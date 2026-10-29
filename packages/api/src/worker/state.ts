import { createHash } from 'node:crypto';
import type { AssessmentId, OrgId } from '@parallax/shared/domain';
import { z } from 'zod';

export const AssessmentStatus = z.enum([
  'QUEUED',
  'SNAPSHOTTING',
  'ANALYZING',
  'EXPLAINING',
  'READY',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);
export type AssessmentStatus = z.infer<typeof AssessmentStatus>;

// Allowed transitions (P INV 5: READY only after persisting).
export const TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  QUEUED: ['SNAPSHOTTING', 'CANCELLED', 'FAILED'],
  SNAPSHOTTING: ['ANALYZING', 'FAILED', 'CANCELLED'],
  ANALYZING: ['EXPLAINING', 'PARTIAL', 'FAILED', 'CANCELLED'],
  EXPLAINING: ['READY', 'PARTIAL', 'FAILED', 'CANCELLED'],
  READY: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: AssessmentStatus, to: AssessmentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: AssessmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export interface AssessmentRecord {
  id: AssessmentId;
  orgId: OrgId;
  inputDigest: string;
  status: AssessmentStatus;
  baseId: string | null;
  headId: string | null;
  manifestJson: string;
  engineJson: string | null;
  coverageJson: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface AssessmentEvent {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: number;
}

// Versión de la política de Parallax que gobierna este análisis (§4: la clave
// incluye la versión de la política; cambiarla invalida la identidad del trabajo).
export const PARALLAX_POLICY_VERSION = '1';

export interface DigestInput {
  /** Manifiesto resuelto: repo → commit en ambas vistas (§5). */
  readonly manifest: {
    readonly base: Readonly<Record<string, string>>;
    readonly head: Readonly<Record<string, string>>;
  };
  readonly configHash?: string | null;
  readonly analyzerVersion: string;
  readonly policyVersion?: string;
  /** El workspace dueño de la evaluación (ver computeInputDigest). */
  readonly orgId?: string;
}

// JSON canónico: claves ordenadas recursivamente, sin dependencia del orden de
// inserción. Mismas entradas → mismo texto → mismo digest.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  // Las claves de un objeto son únicas, así que nunca hay empate: basta `<`.
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

// Idempotencia (§4, INV 4): la clave del trabajo se calcula sólo sobre hechos
// resueltos — manifiesto de commits, config_hash, analyzer_version y política.
// Nada derivado del modelo entra aquí, así que un PR se re-evalúa con la misma
// identidad aunque el modelo cambie (o no exista).
export function computeInputDigest(input: DigestInput): string {
  const canonical = canonicalJson({
    manifest: {
      base: input.manifest.base,
      head: input.manifest.head,
    },
    configHash: input.configHash ?? null,
    analyzerVersion: input.analyzerVersion,
    policyVersion: input.policyVersion ?? PARALLAX_POLICY_VERSION,
    // El workspace entra en la identidad: dos workspaces con el mismo repo en los mismos commits
    // son evaluaciones distintas (su LAIN, su informe, su estado en GitHub). Sin esto, la segunda
    // recibía la evaluación de la primera y nunca se publicaba la suya.
    orgId: input.orgId,
  });
  return `sha256_${createHash('sha256').update(canonical).digest('hex')}`;
}
