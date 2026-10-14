import { describe, expect, it } from 'vitest';
import { presentCoverage } from '../src/coverage.js';

describe('presentCoverage', () => {
  const lain = {
    complete: true,
    scope: {
      configured_only: true,
      reviewed: [{ repo: 'orders', commit: 'b5bf29a' }, { repo: 'billing', commit: '9726517' }],
      unreviewed: [],
      excluded: [],
    },
  };

  it('reports complete coverage when the engine saw everything and nothing was excluded', () => {
    const c = presentCoverage(lain, { configured: ['orders', 'billing'], excluded: [] });
    expect(c.complete).toBe(true);
    expect(c.scope.reviewed).toEqual(['orders', 'billing']);
    expect(c.scope.unreviewed).toEqual([]);
    expect(c.summary).toContain('cobertura completa');
  });

  it('surfaces a manifest exclusion the engine cannot see (INV 3)', () => {
    const c = presentCoverage(lain, {
      configured: ['orders', 'billing', 'reports'],
      excluded: ['reports'],
    });
    expect(c.scope.reviewed).toEqual(['orders', 'billing']);
    const excluded = c.scope.unreviewed.find((n) => n.repo === 'reports');
    expect(excluded?.reason).toBe('excluded');
    // §9.6: el relato debe nombrar el repo omitido.
    expect(c.summary).toContain('reports');
    expect(c.summary).toContain('excluded');
  });

  it('never claims complete coverage while a repo sits outside the scope', () => {
    const c = presentCoverage(lain, {
      configured: ['orders', 'billing', 'reports'],
      excluded: ['reports'],
    });
    expect(c.complete).toBe(false);
    // Un resultado vacío no se presenta como autorización para cambiar.
    expect(c.summary).toMatch(/no autoriza/i);
  });

  it('keeps engine-reported unreviewed entries and does not duplicate them', () => {
    const withEngineGap = {
      ...lain,
      scope: {
        ...lain.scope,
        unreviewed: [{ repo: 'platform', reason: 'not_ready' }],
      },
    };
    const c = presentCoverage(withEngineGap, {
      configured: ['orders', 'billing', 'platform', 'reports'],
      excluded: ['platform', 'reports'],
    });
    const repos = c.scope.unreviewed.map((n) => n.repo);
    expect(repos.filter((r) => r === 'platform')).toHaveLength(1);
    expect(repos).toContain('reports');
  });

  it('inherits complete:false from the engine even without exclusions', () => {
    const incomplete = { ...lain, complete: false };
    const c = presentCoverage(incomplete, { configured: ['orders', 'billing'], excluded: [] });
    expect(c.complete).toBe(false);
  });
});
