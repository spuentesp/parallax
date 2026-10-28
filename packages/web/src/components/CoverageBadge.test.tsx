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

function styleOf(el: HTMLElement) {
  return {
    background: el.style.background,
    color: el.style.color,
    padding: el.style.padding,
    borderRadius: el.style.borderRadius,
    fontSize: el.style.fontSize,
  };
}

const CHIP = { color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' };

describe('CoverageBadge', () => {
  it('is red "sin datos" when coverage is empty', () => {
    render(<CoverageBadge coverage={base} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('sin datos');
    expect(styleOf(badge)).toEqual({ background: 'rgb(220, 38, 38)', ...CHIP });
  });

  it('is yellow and counts omissions in the title when reviewed is non-empty', () => {
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
    expect(badge.textContent).toBe('cobertura parcial (1 revisados, 1 omitidos)');
    expect(badge.getAttribute('title')).toBe('omitted=1 truncated=0 unresolved=0');
    expect(styleOf(badge)).toEqual({ background: 'rgb(217, 119, 6)', ...CHIP });
  });

  it('is yellow when refs are truncated, even with nothing omitted', () => {
    render(
      <CoverageBadge
        coverage={{
          ...base,
          reviewed: ['orders'],
          truncated: [{ repo: 'orders', surface: 'orders-openapi.json' }],
        }}
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('cobertura parcial (1 revisados, 0 omitidos)');
    expect(badge.getAttribute('title')).toBe('omitted=0 truncated=1 unresolved=0');
    expect(styleOf(badge)).toEqual({ background: 'rgb(217, 119, 6)', ...CHIP });
  });

  it('is yellow when refs are unresolved, even with nothing omitted or truncated', () => {
    render(
      <CoverageBadge
        coverage={{
          ...base,
          reviewed: ['orders'],
          refsUnresolved: ['orders#/paths/~1orders'],
        }}
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('cobertura parcial (1 revisados, 0 omitidos)');
    expect(badge.getAttribute('title')).toBe('omitted=0 truncated=0 unresolved=1');
    expect(styleOf(badge)).toEqual({ background: 'rgb(217, 119, 6)', ...CHIP });
  });

  it('is green when reviewed is non-empty and nothing is omitted, truncated or unresolved', () => {
    render(<CoverageBadge coverage={{ ...base, reviewed: ['orders', 'billing'] }} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('completa (2 revisados)');
    expect(styleOf(badge)).toEqual({ background: 'rgb(22, 163, 74)', ...CHIP });
  });
});
