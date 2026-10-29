import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la firma `X-Hub-Signature-256` de GitHub sobre el cuerpo crudo. La
 * comparación es en tiempo constante. Sin secreto o sin firma, nunca es válida.
 */
export function verifySignature(
  secret: string | undefined,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PullRequestEvent {
  readonly provider?: 'github' | 'gitlab';
  readonly action: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly htmlUrl: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly baseSha: string;
  readonly headSha: string;
  /** True si el head vive en un fork: su código no lo ha revisado la organización. */
  readonly isFork: boolean;
  /** Borrador: no se evalúa hasta que se marca listo (cuesta tokens de modelo). */
  readonly isDraft: boolean;
  /** `edited` que cambió la rama base: cambia contra qué se compara el PR. */
  readonly baseChanged: boolean;
}

interface RawPr {
  number?: number;
  draft?: boolean;
  html_url?: string;
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
}

/** Extrae lo necesario de un evento `pull_request`. Devuelve null si le falta algo. */
export function parsePullRequestEvent(payload: unknown): PullRequestEvent | null {
  const p = payload as {
    action?: string;
    repository?: { full_name?: string };
    pull_request?: RawPr;
    changes?: { base?: unknown };
  };
  const fullName = p.repository?.full_name ?? '';
  const [owner, repo] = fullName.split('/');
  const pr = p.pull_request;
  if (!p.action || !owner || !repo || !pr?.number) return null;
  const baseSha = pr.base?.sha ?? '';
  const headSha = pr.head?.sha ?? '';
  if (!baseSha || !headSha) return null;
  const headRepo = pr.head?.repo?.full_name ?? null;
  return {
    action: p.action,
    owner,
    repo,
    number: pr.number,
    htmlUrl: pr.html_url ?? `https://github.com/${fullName}/pull/${pr.number}`,
    baseRef: pr.base?.ref ?? '',
    headRef: pr.head?.ref ?? '',
    baseSha,
    headSha,
    // Un head sin repo (repo eliminado) también cuenta como fork: no hay forma de verificarlo.
    isFork: headRepo !== fullName,
    isDraft: pr.draft === true,
    baseChanged: p.changes?.base !== undefined,
  };
}

/** Acciones de PR que disparan una evaluación. */
export const EVALUATED_ACTIONS: ReadonlySet<string> = new Set([
  'opened',
  'synchronize',
  'reopened',
  // Un borrador no se evalúa; al marcarlo listo, sí.
  'ready_for_review',
]);

/** ¿Este evento merece una evaluación? `edited` sólo si cambió la rama base. */
export function isEvaluated(
  pr: Pick<PullRequestEvent, 'action' | 'isDraft' | 'baseChanged' | 'isFork'>,
): boolean {
  if (pr.isFork || pr.isDraft) return false;
  return EVALUATED_ACTIONS.has(pr.action) || (pr.action === 'edited' && pr.baseChanged);
}
