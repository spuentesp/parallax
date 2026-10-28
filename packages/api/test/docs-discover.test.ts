import { describe, expect, it } from 'vitest';
import { candidatePaths, classify, discoverDocs, parseDoc } from '../src/docs/discover.js';
import { createLainMock } from '../src/lain-adapter/mock.js';

const snip = (title: string, body: string[]) =>
  `File: /x/y.md\nShowing lines 1-9\n\n${[`# ${title}`, '', ...body].map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n')}`;

describe('classify / candidatePaths', () => {
  it('sorts docs by what they are for', () => {
    expect(classify('AGENTS.md')).toBe('conventions');
    expect(classify('src/lib/AGENTS.md')).toBe('conventions');
    expect(classify('docs/adr/0004-x.md')).toBe('decision');
    expect(classify('0004-x.md')).toBe('decision');
    expect(classify('CONTEXT.md')).toBe('domain');
    expect(classify('SECURITY.md')).toBe('security');
    expect(classify('README.md')).toBe('readme');
    expect(classify('docs/deployment.md')).toBe('guide');
  });
  it('guesses where a file known only by name usually lives', () => {
    expect(candidatePaths('0004-race-safe.md')).toEqual(['docs/adr/0004-race-safe.md']);
    expect(candidatePaths('AGENTS.md')).toEqual(['AGENTS.md']);
    expect(candidatePaths('domain.md')).toEqual(['docs/agents/domain.md', 'docs/domain.md']);
    expect(candidatePaths('deployment.md')).toEqual(['docs/deployment.md']);
  });
});

describe('parseDoc', () => {
  it('takes the title and the first real paragraph, skipping tags, tables and sub-headings', () => {
    const d = parseDoc(
      snip('Race-safe adjustments', [
        '**Tags:** gift card',
        '',
        '## Context',
        '',
        'Changing a balance is money movement.',
        'It can be concurrent.',
        '',
        'Later.',
      ]),
    );
    expect(d).toEqual({
      title: 'Race-safe adjustments',
      summary: 'Changing a balance is money movement. It can be concurrent.',
    });
  });
  it('an error text is not a document', () => {
    expect(parseDoc('Error: Not found: Path not found: /x')).toBeNull();
  });
  it('a file with no heading has an empty title (the caller falls back to the path)', () => {
    expect(parseDoc(snip('', ['plain text']))?.title).toBe('');
  });
});

describe('discoverDocs — nothing is listed that was not read', () => {
  const files: Record<string, string> = {
    'docs/adr/0004-race-safe.md': snip('Race safe', ['Because concurrency.']),
    'AGENTS.md': snip('Agents', ['Conventions here.']),
  };
  const lain = {
    ...createLainMock(),
    queryGraph: async () => ({
      nodes: [
        { id: '1', name: '0004-race-safe.md', type: 'File' },
        { id: '2', name: 'AGENTS.md', type: 'File' },
        { id: '3', name: 'ghost.md', type: 'File' },
        { id: '4', name: 'CHANGELOG.md', type: 'File' },
      ],
      edges: [],
    }),
    codeTool: async () => ({ text: '1. **AGENTS.md** file src/AGENTS.md anchor=0 (`x`)\n' }),
    getCodeSnippet: async (a: { path: string }) => ({
      text: files[a.path] ?? snip('Nested', ['n']).replace('File:', 'File:'),
    }),
  } as never;

  it('reads each candidate, drops the ones that do not exist, skips the changelog, orders by kind', async () => {
    const seen: string[] = [];
    const l = {
      ...(lain as object),
      getCodeSnippet: async (a: { path: string }) => {
        seen.push(a.path);
        return files[a.path]
          ? { text: files[a.path] }
          : { text: 'Error: Not found: Path not found: /x' };
      },
    } as never;
    const docs = await discoverDocs(l, 'orders');
    expect(docs.map((d) => [d.kind, d.path])).toEqual([
      ['conventions', 'AGENTS.md'],
      ['decision', 'docs/adr/0004-race-safe.md'],
    ]);
    expect(docs[1]).toMatchObject({
      repo: 'orders',
      title: 'Race safe',
      summary: 'Because concurrency.',
    });
    expect(seen).not.toContain('CHANGELOG.md');
    expect(seen).toContain('docs/ghost.md');
  });

  it('an engine that cannot list files gives no docs, not an error', async () => {
    const l = {
      ...createLainMock(),
      queryGraph: async () => {
        throw new Error('down');
      },
    } as never;
    expect(await discoverDocs(l, 'orders')).toEqual([]);
  });
});
