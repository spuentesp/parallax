import { describe, expect, it } from 'vitest';
import { presentCoverage } from '../src/coverage.js';

describe('presentCoverage', () => {
  const lain = {
    complete: true,
    scope: {
      configured_only: true,
      reviewed: [
        { repo: 'orders', commit: 'b5bf29a' },
        { repo: 'billing', commit: '9726517' },
      ],
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

  it('accepts the engine 0.9.x string form of unreviewed (INV 3: never dropped)', () => {
    const stringForm = {
      ...lain,
      scope: {
        ...lain.scope,
        unreviewed: ['reports'],
      },
    };
    const c = presentCoverage(stringForm, {
      configured: ['orders', 'billing', 'reports'],
      excluded: [],
    });
    const reports = c.scope.unreviewed.find((n) => n.repo === 'reports');
    expect(reports?.reason).toBe('unreviewed');
    expect(c.complete).toBe(false);
    expect(c.summary).toContain('reports');
  });

  it('surfaces engine-side failed repos as unreviewed with cause', () => {
    const withFailure = {
      ...lain,
      complete: false,
      scope: {
        ...lain.scope,
        failed: [{ repo: 'platform', reason: 'index_error' }],
      },
    };
    const c = presentCoverage(withFailure, {
      configured: ['orders', 'billing', 'platform'],
      excluded: [],
    });
    const failed = c.scope.unreviewed.find((n) => n.repo === 'platform');
    expect(failed?.reason).toBe('index_error');
  });

  it('inherits complete:false from the engine even without exclusions', () => {
    const incomplete = { ...lain, complete: false };
    const c = presentCoverage(incomplete, { configured: ['orders', 'billing'], excluded: [] });
    expect(c.complete).toBe(false);
  });

  it('keeps the name of reviewed entries reported in string form', () => {
    const mixedForms = {
      ...lain,
      scope: { ...lain.scope, reviewed: ['orders', { repo: 'billing', commit: '9726517' }] },
    };
    const c = presentCoverage(mixedForms, { configured: ['orders', 'billing'], excluded: [] });
    expect(c.scope.reviewed).toEqual(['orders', 'billing']);
    expect(c.summary).toBe('revisados: orders, billing · cobertura completa');
  });

  it('drops reviewed entries with no name instead of presenting a phantom repo', () => {
    const nameless = {
      ...lain,
      scope: { ...lain.scope, reviewed: ['', { commit: 'b5bf29a' }] },
    };
    const c = presentCoverage(nameless, { configured: ['orders'], excluded: [] });
    expect(c.scope.reviewed).toEqual([]);
    expect(c.summary).toBe('revisados: (ninguno) · cobertura completa');
  });

  it('normalizes engine notes that omit repo or reason (no phantom names, documented cause)', () => {
    const partialNotes = {
      ...lain,
      complete: false,
      scope: {
        ...lain.scope,
        unreviewed: [{ reason: 'not_ready' }, { repo: 'platform' }],
      },
    };
    const c = presentCoverage(partialNotes, {
      configured: ['orders', 'billing', 'platform'],
      excluded: [],
    });
    expect(c.scope.unreviewed).toEqual([{ repo: 'platform', reason: 'unreviewed' }]);
  });

  it('labels string-form failed and excluded engine entries with their documented cause', () => {
    const stringForms = {
      ...lain,
      complete: false,
      scope: { ...lain.scope, failed: ['payments'], excluded: ['reports'] },
    };
    const c = presentCoverage(stringForms, {
      configured: ['orders', 'billing', 'payments', 'reports'],
      excluded: [],
    });
    expect(c.scope.unreviewed).toEqual([
      { repo: 'payments', reason: 'failed' },
      { repo: 'reports', reason: 'excluded' },
    ]);
    expect(c.summary).toBe(
      'revisados: orders, billing · no revisados: payments (failed), reports (excluded) · ' +
        'la cobertura está incompleta: un resultado vacío no autoriza a concluir ausencia de impacto',
    );
  });

  it('reads a minimal engine payload without inventing scope or completeness', () => {
    const c = presentCoverage({}, { configured: ['orders'], excluded: [] });
    expect(c.complete).toBe(false);
    expect(c.scope.configured_only).toBe(true);
    expect(c.scope.reviewed).toEqual([]);
    expect(c.scope.unreviewed).toEqual([]);
    expect(c.summary).toBe(
      'revisados: (ninguno) · ' +
        'la cobertura está incompleta: un resultado vacío no autoriza a concluir ausencia de impacto',
    );
  });

  it('preserves configured_only when the engine explicitly says false', () => {
    const c = presentCoverage(
      {
        complete: true,
        scope: { configured_only: false, reviewed: ['orders'], unreviewed: [], excluded: [] },
      },
      { configured: ['orders'], excluded: [] },
    );
    expect(c.scope.configured_only).toBe(false);
  });
});
