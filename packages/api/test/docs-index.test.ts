import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDispatcher } from '../src/agent/dispatcher.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  chunkMarkdown,
  indexRepo,
  readDocs,
  resolveCheckout,
  searchDocs,
} from '../src/docs/index.js';
import { DOC_STOPWORDS } from '../src/docs/service.js';

const ADR = `# 4. Adjust gift card balance with a row lock

## Context

Two checkouts spending the same gift card raced and the balance went negative.

## Decision

Balance adjustments take select_for_update inside a transaction.

\`\`\`python
# not a heading
\`\`\`
`;

describe('docs index', () => {
  let dir: string;
  let db: Database.Database;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-docs-'));
    mkdirSync(join(dir, 'docs/adr'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
    writeFileSync(join(dir, 'docs/adr/0004-gift-card-lock.md'), ADR);
    writeFileSync(join(dir, 'README.md'), '# Shop\n\nA storefront for orders.\n');
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changes\n\n- gift card balance\n');
    writeFileSync(join(dir, 'node_modules/x/README.md'), '# vendored gift card\n');
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('splits by headings, keeps the heading trail, and ignores # inside code fences', () => {
    const { title, sections } = chunkMarkdown(ADR);
    expect(title).toBe('4. Adjust gift card balance with a row lock');
    expect(sections.map((s) => s.heading)).toEqual([
      '4. Adjust gift card balance with a row lock',
      '4. Adjust gift card balance with a row lock › Context',
      '4. Adjust gift card balance with a row lock › Decision',
    ]);
    expect(sections[2]?.body).toContain('# not a heading');
    expect(sections[2]?.lineStart).toBe(7);
  });

  it('reads the checkout (not vendored code or changelogs) and finds the section by meaning-bearing words', () => {
    const files = readDocs(dir);
    expect(files.map((f) => f.path).sort()).toEqual([
      'README.md',
      'docs/adr/0004-gift-card-lock.md',
    ]);
    expect(files.find((f) => f.path.startsWith('docs/adr'))?.kind).toBe('decision');
    indexRepo(db, 'ws', 'saleor', files, 'abc123');

    const hits = searchDocs(
      db,
      'ws',
      'how do we avoid negative gift card balance races?',
      DOC_STOPWORDS,
    );
    expect(hits[0]).toMatchObject({
      repo: 'saleor',
      path: 'docs/adr/0004-gift-card-lock.md',
      kind: 'decision',
    });
    expect(hits[0]?.snippet.length).toBeGreaterThan(0);
    // otro workspace no ve nada
    expect(searchDocs(db, 'other', 'gift card', DOC_STOPWORDS)).toEqual([]);
  });

  it('hands the model the best sections already read, with the section to cite', async () => {
    indexRepo(db, 'ws', 'saleor', readDocs(dir), 'abc123');
    const dispatcher = createDispatcher({
      lain: {} as never,
      view: 'live',
      docs: (q, o) => searchDocs(db, 'ws', q, DOC_STOPWORDS, o),
    });
    const hint = await dispatcher.docsFor(
      'How do two checkouts avoid a negative gift card balance?',
    );
    expect(hint).toContain('- saleor: docs/adr/0004-gift-card-lock.md');
    expect(hint).toContain('already read from the checkout');
    expect(hint).toContain('DOC QUOTE claim');
    expect(hint).toContain('select_for_update inside a transaction');
    expect(hint).toMatch(/heading at line \d+/);
  });

  it('re-indexing replaces what was there', () => {
    indexRepo(db, 'ws', 'saleor', readDocs(dir), 'a');
    writeFileSync(
      join(dir, 'docs/adr/0004-gift-card-lock.md'),
      '# 4. Other\n\nRefunds are queued.\n',
    );
    indexRepo(db, 'ws', 'saleor', readDocs(dir), 'b');
    expect(searchDocs(db, 'ws', 'select_for_update', DOC_STOPWORDS)).toEqual([]);
    expect(searchDocs(db, 'ws', 'refunds queued', DOC_STOPWORDS)[0]?.path).toBe(
      'docs/adr/0004-gift-card-lock.md',
    );
  });

  it('resolves a sibling checkout by repo name and refuses to clone anything but https on known hosts', async () => {
    const opts = { roots: [resolve(dir, '..')], cacheDir: join(dir, 'cache') };
    const name = dir.split('/').pop() as string;
    expect((await resolveCheckout({ uri: 'x' }, name, opts))?.dir).toBe(dir);
    for (const uri of [
      'file:///etc',
      'ssh://git@github.com/a/b',
      'https://user:pw@github.com/a/b',
      'https://evil.example/a/b',
    ])
      expect(await resolveCheckout({ uri }, 'nope', opts)).toBeNull();
  });
});
