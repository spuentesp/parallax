import type { OpenPrItem, PrFile, PrRef, PrSummary } from '../github/reader.js';

interface MergeRequest {
  iid: number;
  web_url: string;
  title: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author?: { username?: string };
  source_branch: string;
  target_branch: string;
  updated_at?: string;
  merged_at?: string | null;
  changes_count?: string;
  diff_refs?: { start_sha?: string; head_sha?: string };
}
interface Diff {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
  too_large?: boolean;
  collapsed?: boolean;
}

/** Parse only the configured GitLab host, including nested group paths. */
export function parseGitLabMergeRequestUrl(input: string, host = 'gitlab.com'): PrRef | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host.toLowerCase()) return null;
    const match = /^\/(.+)\/-\/merge_requests\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const parts = (match[1] ?? '').split('/');
    const repo = parts.pop();
    if (!repo || parts.length === 0 || parts.some((part) => !part)) return null;
    return { owner: parts.join('/'), repo, number: Number(match[2]) };
  } catch {
    return null;
  }
}

export function parseGitLabRepoUri(
  input: string,
  host = 'gitlab.com',
): { owner: string; repo: string } | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host.toLowerCase()) return null;
    const parts = url.pathname
      .replace(/\/$/, '')
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    const repo = parts.pop();
    return repo && parts.length ? { owner: parts.join('/'), repo } : null;
  } catch {
    return null;
  }
}

export class GitLabReader {
  private readonly apiBase: string;
  constructor(
    private readonly cfg: {
      apiBase?: string;
      token?: string;
      host?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.apiBase = (cfg.apiBase ?? 'https://gitlab.com/api/v4').replace(/\/$/, '');
  }
  private async get<T>(path: string): Promise<T> {
    const response = await (this.cfg.fetchImpl ?? fetch)(`${this.apiBase}${path}`, {
      headers: {
        accept: 'application/json',
        ...(this.cfg.token ? { 'private-token': this.cfg.token } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitLab returned HTTP ${response.status} for ${path}`);
    return (await response.json()) as T;
  }
  private project(ref: Pick<PrRef, 'owner' | 'repo'>): string {
    return encodeURIComponent(`${ref.owner}/${ref.repo}`);
  }
  canHandle(url: string): boolean {
    return parseGitLabMergeRequestUrl(url, this.cfg.host) !== null;
  }
  matchesRepo(uri: string, ref: PrRef): boolean {
    const repo = parseGitLabRepoUri(uri, this.cfg.host);
    return (
      repo !== null &&
      repo.owner.toLowerCase() === ref.owner.toLowerCase() &&
      repo.repo.toLowerCase() === ref.repo.toLowerCase()
    );
  }
  async listFilesAtCommits(
    ref: PrRef,
    base: string,
    head: string,
  ): Promise<{ files: PrFile[]; truncated: boolean }> {
    if (!/^[a-f\d]{7,64}$/i.test(base) || !/^[a-f\d]{7,64}$/i.test(head))
      throw new Error('code impact requires immutable commit SHAs');
    const comparison = await this.get<{ diffs?: Diff[]; compare_timeout?: boolean }>(
      `/projects/${this.project(ref)}/repository/compare?from=${base}&to=${head}`,
    );
    if (!Array.isArray(comparison.diffs)) throw new Error('GitLab compare returned no file list');
    const files = comparison.diffs.map(
      (diff): PrFile => ({
        path: diff.new_path,
        status: diff.new_file
          ? 'added'
          : diff.deleted_file
            ? 'removed'
            : diff.renamed_file
              ? 'renamed'
              : 'modified',
        additions: (diff.diff?.match(/^\+(?!\+\+)/gm) ?? []).length,
        deletions: (diff.diff?.match(/^-(?!--)/gm) ?? []).length,
        ...(diff.diff && !diff.too_large && !diff.collapsed ? { patch: diff.diff } : {}),
        ...(diff.renamed_file ? { previousPath: diff.old_path } : {}),
      }),
    );
    return { files, truncated: comparison.compare_timeout === true };
  }
  async fetchPr(url: string): Promise<PrSummary> {
    const ref = parseGitLabMergeRequestUrl(url, this.cfg.host);
    if (!ref) throw new Error('expected a merge request URL on the configured GitLab host');
    const mr = await this.get<MergeRequest>(
      `/projects/${this.project(ref)}/merge_requests/${ref.number}`,
    );
    const baseSha = mr.diff_refs?.start_sha;
    const headSha = mr.diff_refs?.head_sha;
    if (!baseSha || !headSha) throw new Error('GitLab merge request diff refs are not ready');
    const { files, truncated } = await this.listFilesAtCommits(ref, baseSha, headSha);
    return {
      ref,
      url: mr.web_url || url,
      title: mr.title,
      author: mr.author?.username ?? null,
      state: mr.state,
      baseRef: mr.target_branch,
      headRef: mr.source_branch,
      baseSha,
      headSha,
      mergedAt: mr.merged_at ?? null,
      changedFiles: Number.parseInt(mr.changes_count ?? '', 10) || files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      files,
      filesTruncated: truncated || (mr.changes_count?.endsWith('+') ?? false),
    };
  }
  async listOpenPrs(
    owner: string,
    repo: string,
  ): Promise<{ items: OpenPrItem[]; truncated: boolean }> {
    const rows = await this.get<MergeRequest[]>(
      `/projects/${this.project({ owner, repo })}/merge_requests?state=opened&per_page=100&order_by=updated_at&sort=desc`,
    );
    // Some GitLab list responses omit diff refs. Resolve those from the individual MR,
    // with bounded concurrency; entries whose refs are still unavailable remain declared.
    const resolved: MergeRequest[] = [];
    for (let start = 0; start < rows.length; start += 5) {
      const batch = rows.slice(start, start + 5);
      resolved.push(
        ...(await Promise.all(
          batch.map(async (mr) => {
            if (mr.diff_refs?.start_sha && mr.diff_refs.head_sha) return mr;
            try {
              return await this.get<MergeRequest>(
                `/projects/${this.project({ owner, repo })}/merge_requests/${mr.iid}`,
              );
            } catch {
              return mr;
            }
          }),
        )),
      );
    }
    const items: OpenPrItem[] = [];
    for (const mr of resolved) {
      if (!mr.diff_refs?.start_sha || !mr.diff_refs.head_sha) continue;
      items.push({
        number: mr.iid,
        url: mr.web_url,
        title: mr.title,
        author: mr.author?.username ?? null,
        draft: mr.draft ?? mr.work_in_progress ?? false,
        baseRef: mr.target_branch,
        headRef: mr.source_branch,
        baseSha: mr.diff_refs.start_sha,
        headSha: mr.diff_refs.head_sha,
        updatedAt: mr.updated_at ?? '',
      });
    }
    return { items, truncated: rows.length >= 100 || items.length !== rows.length };
  }
}

export function gitlabReaderFor(cfg: {
  gitlabApiBase?: string | undefined;
  gitlabReadToken?: string | undefined;
  gitlabHost?: string | undefined;
}): GitLabReader {
  return new GitLabReader({
    ...(cfg.gitlabApiBase ? { apiBase: cfg.gitlabApiBase } : {}),
    ...(cfg.gitlabReadToken ? { token: cfg.gitlabReadToken } : {}),
    ...(cfg.gitlabHost ? { host: cfg.gitlabHost } : {}),
  });
}
