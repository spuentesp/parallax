// Cómo se cuenta el impacto de código: estado, comentario y vista previa. El estado lo decide el
// contrato; el código sólo se añade a lo que se dice.

import type { CodeImpact } from '@parallax/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildCommentPreview } from '../src/github/comment-preview.js';
import { commentBodyFor, statusForReport } from '../src/github/status.js';
import { codeImpactMarkdown, codeImpactSummary } from '../src/pr-review/render.js';

const impact = (over: Partial<CodeImpact> = {}): CodeImpact => ({
  repo: 'saleor',
  index: { commit: '487885d437feed94922cdbdf16a76552c120b550', matchesBase: true },
  filesChanged: 4,
  filesAnalyzed: 2,
  symbols: [
    {
      name: 'decrease_stock',
      kind: 'function',
      repo: 'saleor',
      path: 'saleor/warehouse/management.py',
      line: 586,
      change: 'edited',
      direct: 12,
      transitive: 11,
      risk: 'high',
      untested: false,
      dependents: [],
    },
    {
      name: 'get_stocks',
      kind: 'function',
      repo: 'saleor',
      path: 'saleor/graphql/warehouse/bulk_mutations/stock_bulk_update.py',
      line: 340,
      change: 'edited',
      direct: 1,
      transitive: 1,
      risk: 'medium',
      untested: true,
      dependents: [],
    },
    {
      name: 'ghost',
      kind: 'function',
      repo: 'saleor',
      path: 'saleor/x.py',
      line: 3,
      change: 'edited',
      direct: null,
      transitive: null,
      risk: 'unknown',
      untested: null,
      dependents: [],
      note: 'not found in the code index at that path',
    },
  ],
  newDefinitions: 1,
  moduleScopeFiles: ['saleor/warehouse/lock_objects.py'],
  skipped: { nonCode: 1, tests: 2, addedFiles: 0, noDiff: 0, overFileLimit: 0, overSymbolLimit: 0 },
  gaps: ['the code index is at ccccccc and the PR is based on 487885d'],
  highestRisk: 'high',
  ...over,
});

const report = (codeImpact?: CodeImpact | null) => ({
  status: 'READY',
  findings: [] as Array<{ impact?: { class?: string } }>,
  coverage: { complete: true },
  ...(codeImpact !== undefined ? { codeImpact } : {}),
});

describe('code impact in the commit status', () => {
  it('adds the code summary to the description and never changes the state', () => {
    const plain = statusForReport(report());
    const withCode = statusForReport(report(impact()));
    expect(withCode.state).toBe(plain.state); // el estado lo decide el contrato
    expect(plain.state).toBe('success');
    expect(withCode.description).toBe(
      'No known impact; coverage complete. Code: 3 symbols, highest risk high (1 unmeasured).',
    );
  });

  it('keeps the 140-character limit of GitHub', () => {
    const long = statusForReport({
      status: 'PARTIAL',
      findings: [],
      coverage: { complete: false, summary: 'x'.repeat(130) },
      codeImpact: impact(),
    });
    expect(long.description.length).toBeLessThanOrEqual(140);
  });

  it('says so when no changed symbol was found, and stays silent without a code review', () => {
    expect(codeImpactSummary(impact({ symbols: [], highestRisk: null }))).toBe(
      'Code: no changed symbols found.',
    );
    expect(codeImpactSummary(null)).toBeNull();
    expect(statusForReport(report(null)).description).toBe('No known impact; coverage complete.');
  });
});

describe('code impact in the PR comment', () => {
  it('shows cross-repository leaves and their traversal limit', () => {
    const sample = impact();
    const symbol = sample.symbols[0];
    if (!symbol) throw new Error('missing fixture');
    symbol.crossRepo = {
      repositories: [{ repo: 'storefront', leaves: ['leaf'] }],
      truncated: true,
    };
    const md = codeImpactMarkdown(sample).join('\n');
    expect(md).toContain('`storefront` (1 leaf path(s)) (truncated)');
    expect(md).toContain('traversal leaves at depth 4, not a count of all callers');
  });
  it('lists the symbols riskiest first, with reach and tests, and says what it did not analyze', () => {
    const md = codeImpactMarkdown(impact()).join('\n');
    expect(md).toContain('### Code impact');
    expect(md).toContain(
      '3 changed symbol(s) measured · highest risk **high** against the code index at `487885d`',
    );
    const rows = md.split('\n').filter((l) => l.startsWith('| `'));
    expect(rows[0]).toContain('decrease_stock');
    expect(rows[0]).toContain('| 12 | 11 | tested | **high** |');
    expect(rows[1]).toContain('get_stocks');
    expect(rows[1]).toContain('| 1 | 1 | untested | **medium** |');
    // Sin medida: se dice por qué, no se rellena con números.
    expect(rows[2]).toContain('ghost');
    expect(rows[2]).toContain('_unknown: not found in the code index at that path_');
    expect(md).toContain('1 definition(s) added by this PR are not in the code index yet');
    expect(md).toContain(
      'Changes outside any definition (imports, constants) in: `saleor/warehouse/lock_objects.py`',
    );
    expect(md).toContain('Not analyzed: 2 test file(s), 1 non-code file(s).');
    expect(md).toContain('the code index is at ccccccc and the PR is based on 487885d');
  });

  it('commentBodyFor and the local preview carry the same section', () => {
    const body = commentBodyFor(report(impact()), null, 'shop');
    expect(body).toContain('### Parallax assessment — shop');
    expect(body).toContain('### Code impact');
    const preview = buildCommentPreview({
      id: 'a_1',
      orgId: 'o',
      inputDigest: 'd',
      status: 'READY',
      baseId: 'b',
      headId: 'h',
      manifest: {},
      findings: [],
      engine: {},
      codeImpact: impact(),
      coverage: { complete: true },
      evidence: [],
      explanation: { status: 'pending', revision: null, model: null },
      createdAt: 0,
      completedAt: null,
    });
    expect(preview.markdown).toContain('### Code impact');
    // Sin revisión de código no hay sección vacía.
    expect(commentBodyFor(report(), null)).not.toContain('Code impact');
  });
});
