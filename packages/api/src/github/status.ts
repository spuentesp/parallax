// Escritura a GitHub: commit status y comentarios de PR. Este archivo es el ÚNICO
// que lee la credencial de escritura (PARALLAX_GITHUB_WRITE_TOKEN). El lector de
// PRs (reader.ts) sigue siendo sólo GET y nunca la recibe.

export type CommitState = 'success' | 'failure' | 'pending' | 'error';

export interface ReportForStatus {
  readonly status: string;
  readonly findings: ReadonlyArray<{ impact?: { class?: string | undefined } | undefined }>;
  readonly coverage?:
    | { complete?: boolean | undefined; summary?: string | undefined }
    | null
    | undefined;
}

export interface CommitStatusSpec {
  readonly state: CommitState;
  readonly description: string;
}

/** GitHub limita la descripción de un status a 140 caracteres. */
const MAX_DESCRIPTION = 140;

function clip(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}

/** El estado con que arranca el análisis: sin él, el PR no mostraba nada hasta el resultado. */
export const PENDING_STATUS: CommitStatusSpec = {
  state: 'pending',
  description: 'Parallax is analyzing this pull request…',
};

/**
 * Estado FINAL del commit. `pending` significa "todavía corriendo" y GitHub lo muestra como
 * "esperando" para siempre si nadie lo cambia, así que un resultado terminal nunca lo usa:
 *   failure — hay un impacto verificado.
 *   error   — no concluyente: hay hallazgos que investigar o la cobertura es incompleta.
 *   success — sólo `NoKnownImpact` con cobertura completa (la cobertura incompleta nunca se
 *             presenta como éxito: INV 3).
 */
export function statusForReport(report: ReportForStatus): CommitStatusSpec {
  if (report.status === 'FAILED') {
    return { state: 'error', description: clip('Parallax assessment failed; no result.') };
  }
  const classes = report.findings.map((f) => f.impact?.class ?? '');
  const verified = classes.filter((c) => c === 'Verified').length;
  const needs = classes.filter((c) => c === 'NeedsInvestigation').length;
  if (verified > 0) {
    return { state: 'failure', description: clip(`${verified} verified impact(s) found.`) };
  }
  if (needs > 0) {
    return { state: 'error', description: clip(`${needs} finding(s) need investigation.`) };
  }
  const complete = report.coverage?.complete === true;
  if (report.status === 'PARTIAL' || !complete) {
    const reason = report.coverage?.summary ?? 'coverage is incomplete';
    return { state: 'error', description: clip(`No result conclusive: ${reason}`) };
  }
  return { state: 'success', description: clip('No known impact; coverage complete.') };
}

/** Comentario en markdown para el PR (sólo si el workspace lo activó). */
export function commentBodyFor(
  report: ReportForStatus,
  reportUrl: string | null,
  workspaceName?: string,
): string {
  const count = (c: string) => report.findings.filter((f) => f.impact?.class === c).length;
  const lines = [
    workspaceName ? `### Parallax assessment — ${workspaceName}` : '### Parallax assessment',
    '',
    `- Verified: ${count('Verified')}`,
    `- Needs investigation: ${count('NeedsInvestigation')}`,
    `- No known impact: ${count('NoKnownImpact')}`,
    '',
    `Coverage: ${report.coverage?.complete === true ? 'complete' : 'incomplete'}`,
  ];
  if (report.coverage?.summary) lines.push('', report.coverage.summary);
  if (reportUrl) lines.push('', `[Full report](${reportUrl})`);
  return lines.join('\n');
}

export interface GitHubWriterConfig {
  readonly token: string;
  readonly apiBase?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export const STATUS_CONTEXT = 'parallax/assessment';

export class GitHubWriter {
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: GitHubWriterConfig) {
    this.apiBase = (cfg.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.token = cfg.token;
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Publica el estado del assessment sobre el SHA de head del PR. */
  async setCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    spec: CommitStatusSpec & { targetUrl: string | null; context?: string },
  ): Promise<void> {
    await this.post(`/repos/${owner}/${repo}/statuses/${sha}`, {
      state: spec.state,
      context: spec.context ?? STATUS_CONTEXT,
      description: spec.description,
      ...(spec.targetUrl ? { target_url: spec.targetUrl } : {}),
    });
  }

  /** Comentario en el PR. Sólo se llama si el workspace activó `reportComments`. */
  async createIssueComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    await this.post(`/repos/${owner}/${repo}/issues/${number}/comments`, { body });
  }

  private async post(path: string, payload: unknown): Promise<void> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'parallax-status',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      // El error no repite el cuerpo ni el token: sólo el estado y la ruta.
      if (!res.ok) throw new Error(`GitHub write failed: HTTP ${res.status} on ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
