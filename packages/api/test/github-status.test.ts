import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentBodyFor, GitHubWriter, statusForReport } from '../src/github/status.js';
import { parsePullRequestEvent, verifySignature } from '../src/github/webhook.js';

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
      'NeedsInvestigation leaves the check pending',
      [finding('NeedsInvestigation')],
      complete,
      'READY',
      'pending',
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
      'pending',
    ],
    [
      'incomplete coverage is never success even when READY',
      [finding('NoKnownImpact')],
      { complete: false },
      'READY',
      'pending',
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
