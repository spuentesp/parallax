import type { CommitStatusSpec } from '../github/status.js';

/** Write-only GitLab adapter; the read credential never reaches this class. */
export class GitLabWriter {
  private readonly apiBase: string;
  constructor(
    private readonly config: { token: string; apiBase?: string; fetchImpl?: typeof fetch },
  ) {
    this.apiBase = (config.apiBase ?? 'https://gitlab.com/api/v4').replace(/\/$/, '');
  }
  private project(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }
  private async post(path: string, payload: unknown): Promise<void> {
    const response = await (this.config.fetchImpl ?? fetch)(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'private-token': this.config.token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitLab write failed: HTTP ${response.status} on ${path}`);
  }
  async setCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    spec: CommitStatusSpec & { targetUrl: string | null; context?: string },
  ): Promise<void> {
    await this.post(`/projects/${this.project(owner, repo)}/statuses/${sha}`, {
      state: spec.state === 'failure' || spec.state === 'error' ? 'failed' : spec.state,
      description: spec.description,
      name: spec.context ?? 'parallax/assessment',
      ...(spec.targetUrl ? { target_url: spec.targetUrl } : {}),
    });
  }
  async createIssueComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    await this.post(`/projects/${this.project(owner, repo)}/merge_requests/${number}/notes`, {
      body,
    });
  }
}
