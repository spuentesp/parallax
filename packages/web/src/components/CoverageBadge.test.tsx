import type { Coverage } from '@parallax/shared/domain';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverageBadge } from './CoverageBadge.js';

afterEach(() => cleanup());

const base: Coverage = {
  reviewed: [],
  omitted: [],
  refsUnresolved: [],
  truncated: [],
};

describe('CoverageBadge', () => {
  it('is red "sin datos" when coverage is empty', () => {
    render(<CoverageBadge coverage={base} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toMatch(/sin datos/i);
  });
  it('is yellow when there are omissions but reviewed is non-empty', () => {
    render(
      <CoverageBadge
        coverage={{
          ...base,
          reviewed: ['orders'],
          omitted: [{ repo: 'reports', cause: 'excluded' }],
        }}
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toMatch(/cobertura parcial|omitted/i);
  });
  it('is green when reviewed is non-empty and nothing is omitted or truncated', () => {
    render(<CoverageBadge coverage={{ ...base, reviewed: ['orders', 'billing'] }} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toMatch(/completa|ok/i);
  });
});
