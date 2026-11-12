import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentBodyFor, GitHubWriter, statusForReport } from '../src/github/status.js';
import {
  EVALUATED_ACTIONS,
  parsePullRequestEvent,
  verifySignature,
} from '../src/github/webhook.js';

const finding = (cls: string) => ({ impact: { class: cls } });
const complete = { complete: true, summary: '' };

describe('statusForReport (tabla del diseño)', () => {
  it.each([
    [
      'a Verified finding fails the check',
      [finding('Verified'), finding('NoKnownImpact')],
      complete,
      'READY',
      'failure',
    ],
    [
      'NeedsInvestigation is inconclusive (error), never an endless pending',
      [finding('NeedsInvestigation')],
      complete,
      'READY',
      'error',
    ],
    [
      'no findings and complete coverage succeeds',
      [finding('NoKnownImpact')],
      complete,
      'READY',
      'success',
    ],
    ['an empty report with complete coverage succeeds', [], complete, 'READY', 'success'],
    [
      'PARTIAL is never success',
      [],
      { complete: false, summary: 'reports not reviewed' },
      'PARTIAL',
      'error',
    ],
    [
      'incomplete coverage is never success even when READY',
      [finding('NoKnownImpact')],
      { complete: false },
      'READY',
      'error',
    ],
    ['a failed assessment is an error', [], null, 'FAILED', 'error'],
  ])('%s', (_name, findings, coverage, status, state) => {
    expect(statusForReport({ status, findings, coverage }).state).toBe(state);
  });

  it('a Verified finding wins over incomplete coverage', () => {
    const r = statusForReport({
      status: 'PARTIAL',
      findings: [finding('Verified')],
      coverage: { complete: false },
    });
    expect(r.state).toBe('failure');
  });

  it('keeps the description within GitHub limits', () => {
    const r = statusForReport({
      status: 'PARTIAL',
      findings: [],
      coverage: { complete: false, summary: 'x'.repeat(500) },
    });
    expect(r.description.length).toBeLessThanOrEqual(140);
  });
});

describe('commentBodyFor', () => {
  it('counts each classification and links the report when there is a URL', () => {
    const body = commentBodyFor(
      { status: 'READY', findings: [finding('Verified'), finding('Verified')], coverage: complete },
      'https://parallax.example/app/orgs/ws/assessments/a1',
    );
    expect(body).toContain('- Verified: 2');
    expect(body).toContain('- No known impact: 0');
    expect(body).toContain('Coverage: complete');
    expect(body).toContain('[Full report](https://parallax.example/app/orgs/ws/assessments/a1)');
  });

  it('omits the link when no public URL is configured', () => {
    const body = commentBodyFor({ status: 'READY', findings: [], coverage: complete }, null);
    expect(body).not.toContain('Full report');
  });
});

describe('GitHubWriter (única credencial de escritura)', () => {
  it('posts the status to the head SHA with the parallax context and the bearer token', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
    const writer = new GitHubWriter({
      token: 'write-token',
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          auth: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        });
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.setCommitStatus('acme', 'shop', 'abc123', {
      state: 'success',
      description: 'ok',
      targetUrl: 'https://parallax.example/r/1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/repos\/acme\/shop\/statuses\/abc123$/);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.auth).toBe('Bearer write-token');
    expect(calls[0]?.body).toEqual({
      state: 'success',
      context: 'parallax/assessment',
      description: 'ok',
      target_url: 'https://parallax.example/r/1',
    });
  });

  it('posts a comment on the PR issue', async () => {
    const seen: string[] = [];
    const writer = new GitHubWriter({
      token: 't',
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        seen.push(String(input));
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.createIssueComment('acme', 'shop', 9, 'hi');
    expect(seen[0]).toMatch(/\/repos\/acme\/shop\/issues\/9\/comments$/);
  });

  it('reports a failed write with status and path, never the token', async () => {
    const writer = new GitHubWriter({
      token: 'secret-write-token',
      fetchImpl: (async () =>
        new Response('{"message":"forbidden"}', { status: 403 })) as typeof fetch,
    });
    const err = await writer
      .setCommitStatus('acme', 'shop', 'abc', {
        state: 'failure',
        description: 'x',
        targetUrl: null,
      })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(err?.message).toContain('HTTP 403');
    expect(err?.message).not.toContain('secret-write-token');
  });

  it('only the status module reads the write token', () => {
    const srcDir = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(srcDir);
    const readers = files
      .filter((f) => readFileSync(f, 'utf8').includes('githubWriteToken'))
      .map((f) => f.slice(srcDir.length + 1))
      .sort();
    expect(readers).toEqual(['config.ts', 'routes/ci.ts']);
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"action":"opened"}');
  const sign = (secret: string, b: Buffer) =>
    `sha256=${createHmac('sha256', secret).update(b).digest('hex')}`;

  it('accepts a correct signature over the raw body', () => {
    expect(verifySignature('s3cret', body, sign('s3cret', body))).toBe(true);
  });

  it('rejects a signature made with another secret or over another body', () => {
    expect(verifySignature('s3cret', body, sign('other', body))).toBe(false);
    expect(verifySignature('s3cret', body, sign('s3cret', Buffer.from('{}')))).toBe(false);
  });

  it('never accepts when the secret or the header is missing', () => {
    expect(verifySignature(undefined, body, sign('s3cret', body))).toBe(false);
    expect(verifySignature('s3cret', body, undefined)).toBe(false);
    expect(verifySignature('s3cret', body, 'sha1=abc')).toBe(false);
  });
});

describe('verifySignature edge cases', () => {
  const body = Buffer.from('{"action":"opened"}');
  const digest = createHmac('sha256', 's3cret').update(body).digest('hex');

  it('rejects a header whose length differs from a real signature without throwing', () => {
    expect(verifySignature('s3cret', body, 'sha256=abc')).toBe(false);
    expect(verifySignature('s3cret', body, `sha256=${digest}00`)).toBe(false);
  });

  it('requires the sha256= prefix on an otherwise correct digest', () => {
    expect(verifySignature('s3cret', body, `sha512=${digest}`)).toBe(false);
    expect(verifySignature('s3cret', body, digest)).toBe(false);
  });
});

describe('parsePullRequestEvent edge cases', () => {
  const full = (overrides: Record<string, unknown> = {}) => ({
    action: 'opened',
    repository: { full_name: 'acme/shop' },
    pull_request: {
      number: 7,
      html_url: 'https://github.com/acme/shop/pull/7',
      base: { ref: 'main', sha: 'a'.repeat(40), repo: { full_name: 'acme/shop' } },
      head: { ref: 'feat/x', sha: 'b'.repeat(40), repo: { full_name: 'acme/shop' } },
      ...overrides,
    },
  });

  it('keeps the html_url GitHub sent instead of rebuilding it', () => {
    expect(parsePullRequestEvent(full())?.htmlUrl).toBe('https://github.com/acme/shop/pull/7');
  });

  it('builds the html_url from the repository when GitHub omits it', () => {
    const p = full();
    delete (p.pull_request as { html_url?: string }).html_url;
    expect(parsePullRequestEvent(p)?.htmlUrl).toBe('https://github.com/acme/shop/pull/7');
  });

  it('reads the base and head branch names exactly', () => {
    const e = parsePullRequestEvent(full());
    expect(e?.baseRef).toBe('main');
    expect(e?.headRef).toBe('feat/x');
  });

  it('returns null, and never throws, when the payload has no repository, PR or action', () => {
    const noRepo = full();
    delete (noRepo as { repository?: unknown }).repository;
    expect(parsePullRequestEvent(noRepo)).toBeNull();

    const noPr = full();
    delete (noPr as { pull_request?: unknown }).pull_request;
    expect(parsePullRequestEvent(noPr)).toBeNull();

    const noAction = full();
    delete (noAction as { action?: unknown }).action;
    expect(parsePullRequestEvent(noAction)).toBeNull();
  });

  it('returns null when the repository name has no owner/repo split', () => {
    expect(parsePullRequestEvent({ ...full(), repository: { full_name: 'acme' } })).toBeNull();
  });

  it('returns null when the PR number is missing', () => {
    expect(parsePullRequestEvent(full({ number: undefined }))).toBeNull();
  });

  it('returns null, without throwing, when the base or head object is absent', () => {
    expect(parsePullRequestEvent(full({ base: undefined }))).toBeNull();
    expect(parsePullRequestEvent(full({ head: undefined }))).toBeNull();
  });

  it('falls back to empty branch names when a ref is absent', () => {
    const e = parsePullRequestEvent(
      full({
        base: { sha: 'a'.repeat(40), repo: { full_name: 'acme/shop' } },
        head: { sha: 'b'.repeat(40), repo: { full_name: 'acme/shop' } },
      }),
    );
    expect(e?.baseRef).toBe('');
    expect(e?.headRef).toBe('');
  });

  it('exposes exactly the evaluated actions', () => {
    expect([...EVALUATED_ACTIONS].sort()).toEqual([
      'opened',
      'ready_for_review',
      'reopened',
      'synchronize',
    ]);
  });
});

describe('parsePullRequestEvent', () => {
  const pr = (headRepo: string | null) => ({
    action: 'opened',
    repository: { full_name: 'acme/shop' },
    pull_request: {
      number: 4,
      html_url: 'https://github.com/acme/shop/pull/4',
      base: { ref: 'main', sha: 'a'.repeat(40), repo: { full_name: 'acme/shop' } },
      head: {
        ref: 'feat',
        sha: 'b'.repeat(40),
        repo: headRepo === null ? null : { full_name: headRepo },
      },
    },
  });

  it('reads owner, repo, number and both SHAs', () => {
    expect(parsePullRequestEvent(pr('acme/shop'))).toMatchObject({
      owner: 'acme',
      repo: 'shop',
      number: 4,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      isFork: false,
    });
  });

  it('marks a PR from a fork, and a head whose repo is gone, as fork', () => {
    expect(parsePullRequestEvent(pr('someone/shop'))?.isFork).toBe(true);
    expect(parsePullRequestEvent(pr(null))?.isFork).toBe(true);
  });

  it('returns null for a payload without SHAs', () => {
    const p = pr('acme/shop') as { pull_request: { head: { sha: string } } };
    p.pull_request.head.sha = '';
    expect(parsePullRequestEvent(p)).toBeNull();
  });
});

// Textos exactos: cada cadena de estado y descripción llega a GitHub tal cual.
describe('statusForReport exact descriptions', () => {
  it('uses the exact failed-assessment text', () => {
    expect(statusForReport({ status: 'FAILED', findings: [], coverage: null })).toEqual({
      state: 'error',
      description: 'Parallax assessment failed; no result.',
    });
  });

  it('counts verified impacts in the description', () => {
    expect(
      statusForReport({
        status: 'READY',
        findings: [finding('Verified'), finding('Verified'), finding('NoKnownImpact')],
        coverage: complete,
      }),
    ).toEqual({ state: 'failure', description: '2 verified impact(s) found.' });
  });

  it('counts findings that need investigation in the description', () => {
    expect(
      statusForReport({
        status: 'READY',
        findings: [finding('NeedsInvestigation'), finding('NeedsInvestigation')],
        coverage: complete,
      }),
    ).toEqual({ state: 'error', description: '2 finding(s) need investigation.' });
  });

  it('keeps a PARTIAL assessment pending even when its coverage claims complete', () => {
    expect(
      statusForReport({
        status: 'PARTIAL',
        findings: [finding('NoKnownImpact')],
        coverage: { complete: true, summary: 'all reviewed' },
      }),
    ).toEqual({ state: 'error', description: 'No result conclusive: all reviewed' });
  });

  it('reports an empty coverage summary as an empty reason', () => {
    expect(
      statusForReport({
        status: 'PARTIAL',
        findings: [],
        coverage: { complete: false, summary: '' },
      }),
    ).toEqual({ state: 'error', description: 'No result conclusive: ' });
  });

  it('falls back to the generic reason when coverage is missing', () => {
    expect(statusForReport({ status: 'READY', findings: [], coverage: null })).toEqual({
      state: 'error',
      description: 'No result conclusive: coverage is incomplete',
    });
  });

  it('uses the exact success text', () => {
    expect(statusForReport({ status: 'READY', findings: [], coverage: complete })).toEqual({
      state: 'success',
      description: 'No known impact; coverage complete.',
    });
  });

  it('treats a missing coverage object as incomplete, not as an error', () => {
    expect(statusForReport({ status: 'READY', findings: [] })).toEqual({
      state: 'error',
      description: 'No result conclusive: coverage is incomplete',
    });
  });

  it('keeps a description of exactly 140 characters untouched', () => {
    const summary = 'y'.repeat(140 - 'No result conclusive: '.length);
    const r = statusForReport({
      status: 'PARTIAL',
      findings: [],
      coverage: { complete: false, summary },
    });
    expect(r.description).toHaveLength(140);
    expect(r.description.endsWith('…')).toBe(false);
  });

  it('clips one character longer than 140 and marks the cut with an ellipsis', () => {
    const summary = 'y'.repeat(141 - 'No result conclusive: '.length);
    const r = statusForReport({
      status: 'PARTIAL',
      findings: [],
      coverage: { complete: false, summary },
    });
    const text = `No result conclusive: ${summary}`;
    expect(text).toHaveLength(141);
    expect(r.description).toBe(`${text.slice(0, 139)}…`);
    expect(r.description).toHaveLength(140);
  });
});

describe('commentBodyFor exact output', () => {
  it('counts needs-investigation and no-impact findings under their own labels', () => {
    const body = commentBodyFor(
      {
        status: 'READY',
        findings: [
          finding('NeedsInvestigation'),
          finding('NeedsInvestigation'),
          finding('NeedsInvestigation'),
          finding('NoKnownImpact'),
        ],
        coverage: complete,
      },
      null,
    );
    expect(body).toContain('- Needs investigation: 3');
    expect(body).toContain('- No known impact: 1');
    expect(body).toContain('- Verified: 0');
  });

  it('reports incomplete coverage and omits the summary line when there is none', () => {
    const body = commentBodyFor({ status: 'PARTIAL', findings: [], coverage: null }, null);
    expect(body).toBe(
      [
        '### Parallax advisory',
        '',
        'Advisory only; this review does not gate merging.',
        '',
        'Assessment: PARTIAL',
        '',
        '- Verified: 0',
        '- Needs investigation: 0',
        '- No known impact: 0',
        '',
        'Coverage: incomplete',
      ].join('\n'),
    );
  });

  it('adds the coverage summary and the report link after the coverage line', () => {
    const body = commentBodyFor(
      {
        status: 'PARTIAL',
        findings: [],
        coverage: { complete: false, summary: 'two repos unreviewed' },
      },
      'https://parallax.example/r/9',
    );
    expect(body.split('\n').slice(-6)).toEqual([
      '',
      'Coverage: incomplete',
      '',
      'two repos unreviewed',
      '',
      '[Full report](https://parallax.example/r/9)',
    ]);
  });
});

describe('GitHubWriter wire details', () => {
  it('sends the fixed headers GitHub expects', async () => {
    let seen: Headers | undefined;
    const writer = new GitHubWriter({
      token: 'tok',
      fetchImpl: (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        seen = new Headers(init?.headers);
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.createIssueComment('acme', 'shop', 1, 'x');
    expect(seen?.get('accept')).toBe('application/vnd.github+json');
    expect(seen?.get('content-type')).toBe('application/json');
    expect(seen?.get('user-agent')).toBe('parallax-status');
    expect(seen?.get('authorization')).toBe('Bearer tok');
  });

  it('defaults to the public GitHub API', async () => {
    let url = '';
    const writer = new GitHubWriter({
      token: 'tok',
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        url = String(input);
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.createIssueComment('acme', 'shop', 2, 'x');
    expect(url).toBe('https://api.github.com/repos/acme/shop/issues/2/comments');
  });

  it('strips one trailing slash from a configured base so paths never double it', async () => {
    let url = '';
    const writer = new GitHubWriter({
      token: 'tok',
      apiBase: 'https://ghe.example/api/v3/',
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        url = String(input);
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.createIssueComment('acme', 'shop', 3, 'x');
    expect(url).toBe('https://ghe.example/api/v3/repos/acme/shop/issues/3/comments');
  });

  it('aborts a write that exceeds the timeout', async () => {
    const writer = new GitHubWriter({
      token: 'tok',
      timeoutMs: 20,
      fetchImpl: ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    await expect(writer.createIssueComment('acme', 'shop', 4, 'x')).rejects.toThrow('aborted');
  });

  it('clears the timeout once the write completes, so a fast write is never aborted later', async () => {
    let signal: AbortSignal | undefined;
    const writer = new GitHubWriter({
      token: 'tok',
      timeoutMs: 15,
      fetchImpl: (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    await writer.createIssueComment('acme', 'shop', 5, 'x');
    await new Promise((r) => setTimeout(r, 40));
    expect(signal?.aborted).toBe(false);
  });
});
