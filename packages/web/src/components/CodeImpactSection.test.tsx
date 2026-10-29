import type { CodeImpact } from '@parallax/shared/domain';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeImpactSection } from './CodeImpactSection.js';

const sym = (over: Partial<CodeImpact['symbols'][number]> = {}): CodeImpact['symbols'][number] => ({
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
  dependents: [{ name: 'fulfill_order_lines', path: 'saleor/order/actions.py' }],
  ...over,
});

const impact = (over: Partial<CodeImpact> = {}): CodeImpact => ({
  repo: 'saleor',
  index: { commit: '487885d437feed94922cdbdf16a76552c120b550', matchesBase: true },
  filesChanged: 4,
  filesAnalyzed: 2,
  symbols: [
    sym({
      name: 'get_stocks',
      risk: 'medium',
      direct: 1,
      transitive: 1,
      untested: true,
      dependents: [],
    }),
    sym(),
    sym({
      name: 'ghost',
      risk: 'unknown',
      direct: null,
      transitive: null,
      untested: null,
      dependents: [],
      note: 'not found in the code index at that path',
    }),
  ],
  newDefinitions: 2,
  moduleScopeFiles: ['saleor/warehouse/lock_objects.py'],
  skipped: { nonCode: 1, tests: 2, addedFiles: 0, noDiff: 0, overFileLimit: 0, overSymbolLimit: 0 },
  gaps: ['a change is attributed to the nearest preceding definition'],
  highestRisk: 'high',
  ...over,
});

describe('CodeImpactSection', () => {
  afterEach(cleanup);

  it('lists the riskiest symbol first with reach, tests and who calls it', () => {
    render(<CodeImpactSection impact={impact()} />);
    const rows = screen.getAllByRole('row').slice(1); // sin la cabecera
    expect(within(rows[0] as HTMLElement).getByText('decrease_stock')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('12')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('tested')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/called by fulfill_order_lines/)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('get_stocks')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('untested')).toBeTruthy();
    expect(screen.getByText(/highest risk: high/)).toBeTruthy();
    expect(
      screen.getByText(/2 of 4 changed file\(s\) analyzed · code index at 487885d/),
    ).toBeTruthy();
  });

  it('shows why a symbol has no measure instead of numbers', () => {
    render(<CodeImpactSection impact={impact()} />);
    const ghost = screen
      .getAllByRole('row')
      .find((r) => within(r).queryByText('ghost')) as HTMLElement;
    expect(within(ghost).getByText('not found in the code index at that path')).toBeTruthy();
    expect(within(ghost).getByText('unknown')).toBeTruthy();
  });

  it('says what it did not analyze and what limits the reading', () => {
    render(<CodeImpactSection impact={impact()} />);
    expect(
      screen.getByText(/2 definition\(s\) added by this PR are not in the code index yet/),
    ).toBeTruthy();
    expect(screen.getByText(/Not analyzed: 2 test file\(s\), 1 non-code file\(s\)\./)).toBeTruthy();
    expect(screen.getByText(/nearest preceding definition/)).toBeTruthy();
  });

  it('warns when the code index is not at the PR base commit', () => {
    render(
      <CodeImpactSection
        impact={impact({ index: { commit: 'c'.repeat(40), matchesBase: false } })}
      />,
    );
    expect(screen.getByText('index is not at the PR base')).toBeTruthy();
  });

  it('an empty result is said, not left blank', () => {
    render(<CodeImpactSection impact={impact({ symbols: [], highestRisk: null })} />);
    expect(screen.getByText(/No changed symbols were found in the files analyzed/)).toBeTruthy();
  });
});
