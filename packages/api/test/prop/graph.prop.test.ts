import { arbRepoName, arbText } from '@parallax/shared/test/prop-arbitraries';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyNode, deriveLainRepoId } from '../../src/code-graph.js';
import { resolveServiceForPath } from '../../src/topology.js';
import { fcDefaults } from './harness.js';

const KINDS = ['container', 'symbol', 'route', 'schema', 'other'] as const;

// Oráculo de fuerza bruta, independiente de la implementación: recorre las
// longitudes de prefijo de mayor a menor (semántica "el prefijo más largo
// gana") en lugar de rastrear el mejor candidato incrementalmente.
function resolveOracle(
  path: string,
  index: ReadonlyMap<string, readonly string[]>,
): string | null {
  for (let len = path.length; len > 0; len--) {
    const prefix = path.slice(0, len);
    for (const [service, paths] of index) {
      if (paths.includes(prefix)) return service;
    }
  }
  return null;
}

const arbIndex = fc
  .dictionary(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.array(fc.stringMatching(/^[a-z/]{1,12}$/), { minLength: 1, maxLength: 3 }),
    { maxKeys: 4 },
  )
  .map((dict: Record<string, string[]>) => new Map(Object.entries(dict)));

describe('classifyNode properties', () => {
  it('is total and stable: any string maps to a valid kind', () => {
    fc.assert(
      fc.property(arbText, (type: string) => {
        const kind = classifyNode(type);
        expect(KINDS).toContain(kind);
        expect(classifyNode(type)).toBe(kind);
      }),
      fcDefaults(),
    );
  });

  it('maps the documented type names to their kind', () => {
    const table: Array<[string, (typeof KINDS)[number]]> = [
      ['File', 'container'],
      ['Namespace', 'container'],
      ['HttpRoute', 'route'],
      ['Schema', 'schema'],
      ['Function', 'symbol'],
      ['TotallyUnknownType', 'other'],
    ];
    for (const [type, kind] of table) {
      expect(classifyNode(type)).toBe(kind);
    }
  });
});

describe('deriveLainRepoId properties', () => {
  it('returns the last path segment without .git, normalizing backslashes', () => {
    fc.assert(
      fc.property(arbRepoName, arbRepoName, (a: string, b: string) => {
        expect(deriveLainRepoId({ uri: `x/${a}/${b}.git` })).toBe(b);
        expect(deriveLainRepoId({ uri: `x\\${a}\\${b}.git` })).toBe(b);
      }),
      fcDefaults(),
    );
  });

  it('local checkout wins over uri when present and non-empty', () => {
    fc.assert(
      fc.property(arbRepoName, arbRepoName, (localName: string, uriName: string) => {
        expect(
          deriveLainRepoId({
            uri: `https://example.com/${uriName}.git`,
            local: `./test-repos/${localName}`,
          }),
        ).toBe(localName);
        expect(deriveLainRepoId({ uri: `https://example.com/${uriName}.git`, local: '  ' })).toBe(
          uriName,
        );
      }),
      fcDefaults(),
    );
  });
});

describe('resolveServiceForPath properties (differential)', () => {
  it('matches the brute-force longest-prefix oracle', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z/]{1,16}$/),
        arbIndex,
        (path: string, index: Map<string, string[]>) => {
          expect(resolveServiceForPath(path, index)).toBe(resolveOracle(path, index));
        },
      ),
      fcDefaults(),
    );
  });

  it('picks the longest matching prefix over shorter nested ones', () => {
    // Generador correlacionado: el path de la consulta se DERIVA de los
    // prefijos del índice. Sin esto, path e índice aleatorios casi nunca se
    // solapan y la propiedad diferencial se cumple vacía (null === null).
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{2,8}$/),
        fc.stringMatching(/^[a-z/]{0,6}$/),
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.boolean(),
        (
          base: string,
          suffix: string,
          serviceLong: string,
          serviceShort: string,
          includeShort: boolean,
        ) => {
          const longPrefix = base;
          const shortPrefix = longPrefix.slice(0, 1);
          const query = longPrefix + suffix;
          const index = new Map<string, string[]>([[serviceLong, [longPrefix]]]);
          if (includeShort && serviceShort !== serviceLong) {
            index.set(serviceShort, [shortPrefix]);
          }
          expect(resolveServiceForPath(query, index)).toBe(resolveOracle(query, index));
          expect(resolveServiceForPath(query, index)).toBe(serviceLong);
        },
      ),
      fcDefaults(),
    );
  });

  it('returns null for empty or undefined paths', () => {
    fc.assert(
      fc.property(arbIndex, (index: Map<string, string[]>) => {
        expect(resolveServiceForPath(undefined, index)).toBeNull();
        expect(resolveServiceForPath('', index)).toBeNull();
      }),
      fcDefaults(),
    );
  });

  it('is a pure function of the index (metamorphic: repeated calls agree)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z/]{1,16}$/),
        arbIndex,
        (path: string, index: Map<string, string[]>) => {
          expect(resolveServiceForPath(path, index)).toBe(resolveServiceForPath(path, index));
        },
      ),
      fcDefaults(),
    );
  });
});
