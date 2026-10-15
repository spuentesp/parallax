import { arbText } from '@parallax/shared/test/prop-arbitraries';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeGlobalId } from '../../src/advisor/correlate.js';
import { maskGraphqlSource } from '../../src/advisor/scan.js';
import { fcDefaults } from './harness.js';

describe('maskGraphqlSource properties', () => {
  it('actually blanks comment and string content', () => {
    const src = 'query Q # top secret\n  field(arg: "hidden value")';
    const masked = maskGraphqlSource(src);
    expect(masked).not.toContain('top secret');
    expect(masked).not.toContain('hidden value');
  });

  it('comment tokens never survive masking', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 20 }),
        (token: string) => {
          if (token.trim().length === 0 || token.includes('\n')) return;
          // El comentario arranca en el offset 4 ("x # "); esa región debe
          // quedar totalmente blanqueada, sin importar qué contuviera.
          const masked = maskGraphqlSource(`x # ${token}`);
          expect(masked.slice(4)).toBe(' '.repeat(token.length));
        },
      ),
      fcDefaults(),
    );
  });

  it('string literal tokens never survive masking', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 20 }),
        (token: string) => {
          if (token.includes('\n') || token.includes('"') || token.includes('\\')) return;
          // El contenido del literal empieza en el offset 8 ('f(arg: "');
          // la comilla misma también se blanquea, por eso el prefijo se
          // comprueba sólo hasta el offset 7.
          const masked = maskGraphqlSource(`f(arg: "${token}")`);
          expect(masked.slice(0, 7)).toBe('f(arg: ');
          expect(masked.slice(8, 8 + token.length)).toBe(' '.repeat(token.length));
        },
      ),
      fcDefaults(),
    );
  });

  it('preserves length and newline positions', () => {
    fc.assert(
      fc.property(arbText, (text: string) => {
        const masked = maskGraphqlSource(text);
        expect(masked.length).toBe(text.length);
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '\n') expect(masked[i]).toBe('\n');
        }
      }),
      fcDefaults(),
    );
  });

  it('only blanks characters (every position is the original char or a space)', () => {
    fc.assert(
      fc.property(arbText, (text: string) => {
        const masked = maskGraphqlSource(text);
        for (let i = 0; i < text.length; i++) {
          expect(masked[i] === text[i] || masked[i] === ' ').toBe(true);
        }
      }),
      fcDefaults(),
    );
  });
});

describe('decodeGlobalId properties', () => {
  // Codificador local, independiente: repo:type:path:urlencoded-name:line
  function encodeGlobalId(parts: {
    repo: string;
    nodeType: string;
    path: string;
    name: string;
    line: number;
  }): string {
    return `${parts.repo}:${parts.nodeType}:${parts.path}:${encodeURIComponent(parts.name)}:${parts.line}`;
  }

  it('round-trips ids built by the reference encoder', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.constantFrom('Function', 'Class', 'HttpRoute'),
        fc.oneof(
          fc.stringMatching(/^[a-z/.]{1,16}$/),
          fc.stringMatching(/^[a-z]+:[a-z]+$/), // paths con ':' se re-arman al decodificar
        ),
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 100000 }),
        (repo: string, nodeType: string, path: string, name: string, line: number) => {
          const id = encodeGlobalId({ repo, nodeType, path, name, line });
          expect(decodeGlobalId(id)).toEqual({ repo, nodeType, path, name, line });
        },
      ),
      fcDefaults(),
    );
  });

  it('returns null or a complete shape for arbitrary strings, never throws', () => {
    fc.assert(
      fc.property(arbText, (id: string) => {
        const decoded = decodeGlobalId(id);
        if (decoded !== null) {
          expect(typeof decoded.repo).toBe('string');
          expect(typeof decoded.name).toBe('string');
          expect(Number.isFinite(decoded.line)).toBe(true);
        }
      }),
      fcDefaults(),
    );
  });
});
