import { describe, expect, it } from 'vitest';
import { buildCommentPreview } from '../src/github/comment-preview.js';
import { GitHubReader, PrUrlError, parsePrUrl } from '../src/github/reader.js';
import type { AssessmentApiModel } from '../src/services/assessments.js';

describe('parsePrUrl', () => {
  it('resolves a GitHub PR url to owner/repo/number', () => {
    expect(parsePrUrl('https://github.com/saleor/saleor/pull/19911')).toEqual({
      owner: 'saleor',
      repo: 'saleor',
      number: 19911,
    });
  });

  it('accepts query strings and .git suffixes', () => {
    expect(parsePrUrl('https://github.com/org/repo.git/pull/7?diff=unified')).toEqual({
      owner: 'org',
      repo: 'repo',
      number: 7,
    });
  });

  it('rejects anything that is not a PR url', () => {
    expect(() => parsePrUrl('https://github.com/org/repo/issues/1')).toThrow(PrUrlError);
    expect(() => parsePrUrl('https://gitlab.com/org/repo/-/merge_requests/1')).toThrow(PrUrlError);
  });
});

describe('GitHubReader (sólo lectura)', () => {
  const prJson = {
    number: 19911,
    html_url: 'https://github.com/saleor/saleor/pull/19911',
    title: 'feat: add toggle',
    state: 'closed',
    merged_at: '2026-01-01T00:00:00Z',
    user: { login: 'someone' },
    base: { ref: 'main', sha: '419ddefeb171aaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    head: { ref: 'feature', sha: 'ec58d5d23018bbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  };
  const filesJson = [
    { filename: 'src/a.py', status: 'modified', additions: 3, deletions: 1 },
    { filename: 'src/b.py', status: 'added', additions: 10, deletions: 0 },
  ];

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    // Dry run: sólo se admite GET. Cualquier escritura falla la prueba.
    expect(init?.method ?? 'GET').toBe('GET');
    const body = url.includes('/files?') ? filesJson : prJson;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  it('resolves base/head SHAs and the change scope with GET only', async () => {
    const reader = new GitHubReader({ fetchImpl });
    const pr = await reader.fetchPr('https://github.com/saleor/saleor/pull/19911');
    expect(pr.baseSha).toBe('419ddefeb171aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(pr.headSha).toBe('ec58d5d23018bbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(pr.changedFiles).toBe(2);
    expect(pr.additions).toBe(13);
    expect(pr.deletions).toBe(1);
    expect(pr.files.map((f) => f.path)).toEqual(['src/a.py', 'src/b.py']);
  });

  it('reads code files from the requested commit pair even if the PR has moved', async () => {
    const urls: string[] = [];
    const reader = new GitHubReader({
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({ files: [{ ...filesJson[0], patch: '@@ -1 +1 @@\n-a\n+b' }] }),
        );
      }) as typeof fetch,
    });
    const result = await reader.listFilesAtCommits(
      { owner: 'saleor', repo: 'saleor', number: 19911 },
      prJson.base.sha,
      prJson.head.sha,
    );
    expect(urls).toEqual([
      `https://api.github.com/repos/saleor/saleor/compare/${prJson.base.sha}...${prJson.head.sha}?per_page=100&page=1`,
    ]);
    expect(result.files[0]?.patch).toContain('-a');
    expect(result.truncated).toBe(false);
  });

  it('reads every page of files, keeps each diff and renamed path, and uses the total GitHub reports', async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        filename: `src/f${String(i)}.py`,
        status: i === 0 ? 'renamed' : 'modified',
        additions: 1,
        deletions: 0,
        ...(i === 0 ? { previous_filename: 'src/old0.py' } : {}),
        patch: `@@ -1,1 +1,2 @@ def f${String(i)}():\n x\n+y`,
      }));
    const pages: Record<string, unknown[]> = { '1': mk(100), '2': mk(40) };
    const reader = new GitHubReader({
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        const body = url.pathname.endsWith('/files')
          ? (pages[url.searchParams.get('page') ?? '1'] ?? [])
          : { ...prJson, changed_files: 140 };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch,
    });
    const pr = await reader.fetchPr('https://github.com/saleor/saleor/pull/19911');
    expect(pr.files).toHaveLength(140);
    expect(pr.changedFiles).toBe(140);
    expect(pr.filesTruncated).toBe(false);
    expect(pr.files[0]).toMatchObject({ previousPath: 'src/old0.py' });
    expect(pr.files[1]?.patch).toContain('@@ -1,1 +1,2 @@');
  });

  it('declares a PR with more files than it read instead of presenting the page as the whole', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/f${String(i)}.py`,
      status: 'modified',
      additions: 1,
      deletions: 0,
    }));
    let filePages = 0;
    const reader = new GitHubReader({
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/files')) {
          return new Response(JSON.stringify({ ...prJson, changed_files: 450 }), { status: 200 });
        }
        filePages++;
        return new Response(JSON.stringify(full), { status: 200 });
      }) as typeof fetch,
    });
    const pr = await reader.fetchPr('https://github.com/saleor/saleor/pull/19911');
    expect(filePages).toBe(3); // el tope de páginas
    expect(pr.files).toHaveLength(300);
    expect(pr.changedFiles).toBe(450);
    expect(pr.filesTruncated).toBe(true);
  });

  it('surfaces a missing PR as not_found', async () => {
    const reader = new GitHubReader({
      fetchImpl: (async () => new Response('{}', { status: 404 })) as typeof fetch,
    });
    await expect(reader.fetchPr('https://github.com/a/b/pull/1')).rejects.toThrow(/not found/);
  });
});

function report(over: Partial<AssessmentApiModel> = {}): AssessmentApiModel {
  return {
    id: 'a_1',
    orgId: 'ws_fixture',
    inputDigest: 'sha256_x',
    status: 'PARTIAL',
    baseId: 'snap_base',
    headId: 'snap_head',
    manifest: {},
    findings: [
      {
        kind: 'FieldRemoved',
        field: 'customer_id',
        side: 'provider',
        compat: 'BreakingIfRead',
        endpoint: { key: 'http:GET /api/orders/{}' },
        impact: { class: 'Verified' },
        affected: [{ service: 'billing', class: 'Verified' }],
      },
    ],
    engine: {},
    coverage: {
      complete: false,
      summary: 'revisados: orders, billing · no revisados: reports (excluded)',
      scope: {
        reviewed: [{ repo: 'orders' }, { repo: 'billing' }],
        unreviewed: [],
        excluded: [{ repo: 'reports', reason: 'excluded' }],
      },
    },
    evidence: [
      {
        id: 'e1',
        viewId: 'live',
        repo: 'billing',
        sha: 'abcdef123456',
        path: 'src/main.py',
        range: null,
        hash: 'h',
      },
    ],
    explanation: { status: 'skipped', revision: 0, model: 'none' },
    createdAt: 1,
    completedAt: 2,
    ...over,
  } as AssessmentApiModel;
}

describe('buildCommentPreview', () => {
  const preview = buildCommentPreview(report(), { includeEvidence: true });

  it('marks itself as a dry run and never as a posted comment', () => {
    expect(preview.dryRun).toBe(true);
    expect(preview.markdown).toContain('DRY RUN');
    expect(preview.markdown).toMatch(/preview generated locally/i);
    expect(preview.markdown).toMatch(/posts nothing to GitHub/i);
  });

  it('keeps the evaluated SHAs and the assessment id (§2)', () => {
    expect(preview.evaluated).toEqual({
      baseSha: 'snap_base',
      headSha: 'snap_head',
      assessmentId: 'a_1',
    });
    expect(preview.markdown).toContain('snap_base');
    expect(preview.markdown).toContain('snap_head');
    expect(preview.markdown).toContain('a_1');
  });

  it('publishes the coverage limits, including what was not reviewed (INV 3)', () => {
    expect(preview.coverage.complete).toBe(false);
    expect(preview.coverage.reviewed).toEqual(['orders', 'billing']);
    expect(preview.coverage.notReviewed).toEqual([{ repo: 'reports', reason: 'excluded' }]);
    expect(preview.markdown).toContain('**incomplete**');
    expect(preview.markdown).toContain('`reports` (excluded)');
    expect(preview.markdown).toMatch(/not.*authorization to change/i);
  });

  it('keeps the engine classification and warns the model cannot promote it (INV 2)', () => {
    expect(preview.markdown).toContain('**Verified**');
    expect(preview.markdown).toMatch(/cannot promote `NeedsInvestigation` to `Verified`/);
    expect(preview.markdown).toContain('Model output does not change analyzer classification');
  });

  it('lists resolved evidence only when asked', () => {
    const without = buildCommentPreview(report());
    expect(without.markdown).not.toContain('src/main.py');
    expect(preview.markdown).toContain('src/main.py');
  });
});
