import { describe, expect, it } from 'vitest';
import {
  GitLabReader,
  parseGitLabMergeRequestUrl,
  parseGitLabRepoUri,
} from '../src/gitlab/reader.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const mr = {
  iid: 4,
  web_url: 'https://gitlab.com/group/sub/shop/-/merge_requests/4',
  title: 'update',
  state: 'opened',
  source_branch: 'feature',
  target_branch: 'main',
  updated_at: '2026-10-29',
  diff_refs: { start_sha: base, head_sha: head },
  changes_count: '1',
};
const diff = {
  old_path: 'src/old.ts',
  new_path: 'src/new.ts',
  renamed_file: true,
  diff: '@@ -1 +1 @@\n-old\n+new',
};

describe('GitLab merge request reader', () => {
  it('parses nested projects and rejects other hosts', () => {
    expect(parseGitLabMergeRequestUrl(mr.web_url)).toEqual({
      owner: 'group/sub',
      repo: 'shop',
      number: 4,
    });
    expect(parseGitLabRepoUri('https://gitlab.com/group/sub/shop.git')).toEqual({
      owner: 'group/sub',
      repo: 'shop',
    });
    expect(
      parseGitLabMergeRequestUrl('https://elsewhere.example/group/shop/-/merge_requests/4'),
    ).toBeNull();
  });
  it('reads private MRs and immutable comparison diffs using the configured API', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    const reader = new GitLabReader({
      apiBase: 'https://standin.example/api/v4',
      token: 'read-token',
      fetchImpl: async (input, init) => {
        const url = String(input);
        seen.push({ url, token: new Headers(init?.headers).get('private-token') });
        const result = url.includes('/repository/compare')
          ? { diffs: [diff], compare_timeout: false }
          : mr;
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    const result = await reader.fetchPr(mr.web_url);
    expect(result).toMatchObject({
      baseSha: base,
      headSha: head,
      changedFiles: 1,
      filesTruncated: false,
    });
    expect(result.files[0]).toMatchObject({
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
      additions: 1,
      deletions: 1,
      patch: diff.diff,
    });
    expect(seen.every((request) => request.token === 'read-token')).toBe(true);
    expect(seen[0]?.url).toContain('/projects/group%2Fsub%2Fshop/merge_requests/4');
    expect(seen[1]?.url).toContain(`from=${base}&to=${head}`);
  });
  it('declares an incomplete comparison', async () => {
    const reader = new GitLabReader({
      fetchImpl: async () => new Response(JSON.stringify({ diffs: [diff], compare_timeout: true })),
    });
    expect(
      (await reader.listFilesAtCommits({ owner: 'g', repo: 'r', number: 1 }, base, head)).truncated,
    ).toBe(true);
  });
  it('fetches missing list refs from the individual merge request', async () => {
    const reader = new GitLabReader({
      fetchImpl: async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('?state=opened') ? [{ ...mr, diff_refs: undefined }] : mr,
          ),
        ),
    });
    const listing = await reader.listOpenPrs('group/sub', 'shop');
    expect(listing.items[0]).toMatchObject({ baseSha: base, headSha: head });
    expect(listing.truncated).toBe(false);
  });
});
