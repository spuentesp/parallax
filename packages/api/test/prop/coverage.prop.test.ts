import { arbRepoName } from '@parallax/shared/test/prop-arbitraries';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LainCoverage, type Manifest, presentCoverage } from '../../src/coverage.js';
import { arbLainCoverage, arbManifest } from './arbitraries.js';
import { fcDefaults } from './harness.js';

describe('presentCoverage properties (INV 3)', () => {
  it('an excluded repo never appears as reviewed', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbRepoName, (lain: LainCoverage, forced: string) => {
        // Generador correlacionado: mete todos los nombres revisados en el
        // manifiesto como excluidos (además de uno arbitrario). Sin esta
        // correlación, dos diccionarios aleatorios casi nunca se solapan y la
        // propiedad no muerde al filtro de excluidos.
        const reviewedNames = (lain.scope?.reviewed ?? [])
          .map((e) => (typeof e === 'string' ? e : (e.repo ?? '')))
          .filter((n) => n.length > 0);
        const manifest: Manifest = { configured: [forced], excluded: [forced, ...reviewedNames] };
        const presented = presentCoverage(lain, manifest);
        for (const repo of manifest.excluded) {
          expect(presented.scope.reviewed).not.toContain(repo);
        }
      }),
      fcDefaults(),
    );
  });

  it('presents a repo reported twice (string + object form) only once', () => {
    const presented = presentCoverage(
      {
        complete: true,
        scope: {
          configured_only: true,
          reviewed: ['orders', { repo: 'orders', commit: 'abc1234', dirty: false }],
        },
      },
      { configured: ['orders'], excluded: [] },
    );
    expect(presented.scope.reviewed).toEqual(['orders']);
  });

  it('complete is true only when the engine said so and nothing is left out', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain: LainCoverage, manifest: Manifest) => {
        const presented = presentCoverage(lain, manifest);
        if (presented.complete) {
          expect(lain.complete ?? false).toBe(true);
          expect(presented.scope.unreviewed).toEqual([]);
        }
      }),
      fcDefaults(),
    );
  });

  it('every manifest exclusion is visible in scope.excluded', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain: LainCoverage, manifest: Manifest) => {
        const presented = presentCoverage(lain, manifest);
        expect(presented.scope.excluded.map((n) => n.repo).sort()).toEqual(
          [...manifest.excluded].sort(),
        );
      }),
      fcDefaults(),
    );
  });

  it('an incomplete coverage warns in the summary instead of claiming absence', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain: LainCoverage, manifest: Manifest) => {
        const presented = presentCoverage(lain, manifest);
        expect(presented.summary.length).toBeGreaterThan(0);
        if (!presented.complete) {
          expect(presented.summary).toContain('incompleta');
        } else {
          expect(presented.summary).toContain('cobertura completa');
        }
      }),
      fcDefaults(),
    );
  });

  it('reviewed contains no empty repo names and no duplicates', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain: LainCoverage, manifest: Manifest) => {
        const reviewed = presentCoverage(lain, manifest).scope.reviewed;
        for (const name of reviewed) expect(name.length).toBeGreaterThan(0);
        expect(new Set(reviewed).size).toBe(reviewed.length);
      }),
      fcDefaults(),
    );
  });
});
