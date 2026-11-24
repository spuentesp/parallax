import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoverageLedgerDto } from '../api/hooks.js';
// DTO producido por el normalizador real (packages/api) sobre la salida literal de
// `get_coverage` de LAIN 0.16.0 (Saleor, vista viva).
import LIVE from '../test/fixtures/coverage-ledger-0.16-saleor.json';
import { IndexHealth } from './IndexHealth.js';

afterEach(cleanup);
const ledger = LIVE as unknown as CoverageLedgerDto;

describe('IndexHealth', () => {
  it('shows each repo with its health, sensors that ran and skipped files', () => {
    render(<IndexHealth ledger={ledger} />);
    const table = screen.getByTestId('index-health');
    for (const repo of ['saleor', 'saleor-dashboard', 'storefront']) {
      expect(within(table).getAllByText(repo).length).toBeGreaterThan(0);
    }
    expect(within(table).getAllByText('indexed')).toHaveLength(3);
    expect(within(table).getByText('sql_tables')).toBeTruthy();
    expect(within(table).getByText('788')).toBeTruthy();
    expect(within(table).getByText('python')).toBeTruthy();
  });

  it('says why the engine does not claim complete coverage, using its own counts', () => {
    render(<IndexHealth ledger={ledger} />);
    const note = screen.getByTestId('not-complete');
    expect(note.textContent).toContain('does not claim complete coverage');
    expect(note.textContent).toContain('32 unresolved consumers');
    expect(note.textContent).toContain('1 URL taken from an environment default');
  });

  it('lists the blind spots with the directories the engine groups them by', () => {
    render(<IndexHealth ledger={ledger} />);
    const spots = screen.getByTestId('blind-spots');
    expect(within(spots).getByText('OrmDynamicQuery')).toBeTruthy();
    expect(within(spots).getByText('1,760')).toBeTruthy();
    expect(spots.textContent).toMatch(/Mostly in saleor\//);
    expect(spots.textContent).toContain('are not evidence of safety');
  });

  it('shows nothing when the engine reports no per-repo ledger', () => {
    const { container } = render(<IndexHealth ledger={{ ...ledger, repos: [] }} />);
    expect(container.textContent).toBe('');
    const none = render(<IndexHealth ledger={{ ...ledger, source: 'error', repos: [] }} />);
    expect(none.container.textContent).toBe('');
  });

  it('shows a repo error and a skipped-files count when the engine reports them', () => {
    const l: CoverageLedgerDto = {
      ...ledger,
      complete: true,
      repos: [
        {
          repo: 'x',
          state: 'failed',
          error: 'timed out',
          commit: null,
          languages: [],
          sensors: [],
          skips: [{ reason: 'UnsupportedLanguage', count: 12, samplePaths: ['a/b.kt'] }],
          blindSpots: [],
        },
      ],
    };
    render(<IndexHealth ledger={l} />);
    expect(screen.getByText('timed out')).toBeTruthy();
    expect(screen.getByText(/UnsupportedLanguage/).textContent).toContain('12');
    expect(screen.queryByTestId('not-complete')).toBeNull();
    expect(screen.queryByTestId('blind-spots')).toBeNull();
  });
});
