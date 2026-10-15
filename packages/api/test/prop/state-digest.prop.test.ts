import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeInputDigest, type DigestInput } from '../../src/worker/state.js';
import { arbJson } from '@parallax/shared/test/prop-arbitraries';
import { arbDigestInput } from './arbitraries.js';
import { fcDefaults } from './harness.js';

describe('canonicalJson properties', () => {
  it('is independent of key insertion order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), arbJson, { maxKeys: 6 }),
        (dict: Record<string, unknown>) => {
          const reversed: Record<string, unknown> = {};
          for (const key of Object.keys(dict).reverse()) reversed[key] = dict[key];
          expect(canonicalJson(reversed)).toBe(canonicalJson(dict));
        },
      ),
      fcDefaults(),
    );
  });

  it('round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(arbJson, (value: unknown) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(value);
      }),
      fcDefaults(),
    );
  });
});

describe('computeInputDigest properties (INV 4)', () => {
  it('is stable: same input, same digest', () => {
    fc.assert(
      fc.property(arbDigestInput, (input: DigestInput) => {
        expect(computeInputDigest(input)).toBe(computeInputDigest(input));
      }),
      fcDefaults(),
    );
  });

  it('is sensitive: a new head repo changes the digest', () => {
    fc.assert(
      fc.property(arbDigestInput, (input: DigestInput) => {
        const changed: DigestInput = {
          ...input,
          manifest: { ...input.manifest, head: { ...input.manifest.head, 'ZZ-extra': 'ff' } },
        };
        expect(computeInputDigest(changed)).not.toBe(computeInputDigest(input));
      }),
      fcDefaults(),
    );
  });

  it('formats as sha256_<64 hex>', () => {
    fc.assert(
      fc.property(arbDigestInput, (input: DigestInput) => {
        expect(computeInputDigest(input)).toMatch(/^sha256_[0-9a-f]{64}$/);
      }),
      fcDefaults(),
    );
  });

  it('treats an omitted configHash like an explicit null', () => {
    fc.assert(
      fc.property(arbDigestInput, (input: DigestInput) => {
        const { configHash: _configHash, ...withoutConfigHash } = input;
        const withUndefined: DigestInput = withoutConfigHash;
        const withNull: DigestInput = { ...withoutConfigHash, configHash: null };
        expect(computeInputDigest(withUndefined)).toBe(computeInputDigest(withNull));
      }),
      fcDefaults(),
    );
  });
});
