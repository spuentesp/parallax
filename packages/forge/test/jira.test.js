// Tests for reading a Jira issue as plain text. The ADF below has the shapes Jira really
// produces, including the way the seed script writes its pull request line.
import { describe, expect, it } from 'vitest';
import { adfToText, ticketText } from '../src/jira.js';
import { extractPrRefs } from '../src/review.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (...content) => ({ type: 'paragraph', content });
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const PR = 'https://github.com/NVIDIA/NemoClaw/pull/13812';

describe('adfToText', () => {
  it('reads plain paragraphs and keeps them on separate lines', () => {
    const text = adfToText(doc(p(t('First line.')), p(t('Second line.'))));
    expect(text.trim().split('\n').filter(Boolean)).toEqual(['First line.', 'Second line.']);
  });

  it('sees a pull request written as plain text, the way the seed script writes it', () => {
    expect(extractPrRefs(adfToText(doc(p(t(`Pull request: ${PR}`)))))).toHaveLength(1);
  });

  it('sees a pull request hidden behind a link mark', () => {
    const text = adfToText(doc(p(t('the fix', [{ type: 'link', attrs: { href: PR } }]))));
    expect(extractPrRefs(text).map((r) => r.number)).toEqual([13812]);
  });

  it('does not repeat the address when the visible words already are the address', () => {
    const text = adfToText(doc(p(t(PR, [{ type: 'link', attrs: { href: PR } }]))));
    expect(text.trim()).toBe(PR);
  });

  it('sees a pull request pasted as a smart link card', () => {
    const text = adfToText(doc(p({ type: 'inlineCard', attrs: { url: PR } })));
    expect(extractPrRefs(text)).toHaveLength(1);
    expect(adfToText(doc({ type: 'blockCard', attrs: { url: PR } }))).toContain(PR);
  });

  it('reads lists, code blocks, mentions and line breaks', () => {
    const text = adfToText(
      doc(
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }] },
        { type: 'codeBlock', content: [t('rpc CreateSandbox')] },
        p({ type: 'mention', attrs: { text: '@ana' } }, { type: 'hardBreak' }, t('hi')),
      ),
    );
    expect(text).toContain('one');
    expect(text).toContain('rpc CreateSandbox');
    expect(text).toContain('@ana');
    expect(text).toMatch(/@ana\s*\nhi/);
  });

  it('ignores media and survives empty or missing input', () => {
    expect(adfToText(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: {} }] }))).toBe(
      '',
    );
    expect(adfToText(undefined)).toBe('');
    expect(adfToText(null)).toBe('');
    expect(adfToText(doc())).toBe('');
  });
});

describe('ticketText', () => {
  const issue = (over = {}) => ({
    fields: {
      summary: 'Fix the stale profile',
      description: doc(p(t('GetProviderProfile returns old data.'))),
      comment: { comments: [] },
      ...over,
    },
  });

  it('puts the summary first, then the description', () => {
    const out = ticketText(issue());
    expect(out.indexOf('Fix the stale profile')).toBeLessThan(out.indexOf('GetProviderProfile'));
  });

  it('adds remote links so a PR linked from Jira is found', () => {
    const out = ticketText(issue(), [{ object: { url: PR, title: 'PR' } }]);
    expect(extractPrRefs(out).map((r) => r.number)).toEqual([13812]);
  });

  it('reads comments too, newest ten only', () => {
    const comments = Array.from({ length: 12 }, (_, i) => ({ body: doc(p(t(`comment ${i}`))) }));
    const out = ticketText(issue({ comment: { comments } }));
    expect(out).toContain('comment 11');
    expect(out).toContain('comment 2');
    expect(out).not.toContain('comment 1\n');
    expect(out).not.toContain('comment 0');
  });

  it('cuts from the end, so the summary and the PR link survive a long ticket', () => {
    const long = issue({ comment: { comments: [{ body: doc(p(t('x'.repeat(20000)))) }] } });
    const out = ticketText(long, [{ object: { url: PR } }], { maxChars: 500 });
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toContain('Fix the stale profile');
    expect(out).toContain(PR);
  });

  it('survives an issue with no fields at all', () => {
    expect(ticketText({})).toBe('');
    expect(ticketText(undefined, undefined)).toBe('');
  });
});
