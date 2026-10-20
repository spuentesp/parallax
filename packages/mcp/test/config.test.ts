import { describe, expect, it } from 'vitest';
import { loadEntryConfig } from '../src/config.js';

const TOKENS = JSON.stringify([{ token: 't', orgId: 'o', scopes: ['read'] }]);

describe('loadEntryConfig', () => {
  it('defaults the api url and takes the first configured token', () => {
    const cfg = loadEntryConfig({ PARALLAX_TOKENS: TOKENS });
    expect(cfg).toEqual({ baseUrl: 'http://localhost:8080', token: 't' });
  });

  it('prefers PARALLAX_API_URL over the default', () => {
    const cfg = loadEntryConfig({ PARALLAX_API_URL: 'http://api:9', PARALLAX_TOKENS: TOKENS });
    expect(cfg.baseUrl).toBe('http://api:9');
  });

  it('rejects a missing PARALLAX_TOKENS naming the variable', () => {
    expect(() => loadEntryConfig({})).toThrow(
      'PARALLAX_TOKENS is required (JSON array of {token, orgId, scopes})',
    );
  });

  it('rejects an empty token list', () => {
    expect(() => loadEntryConfig({ PARALLAX_TOKENS: '[]' })).toThrow(
      'PARALLAX_TOKENS must contain at least one token',
    );
  });

  it('rejects malformed JSON with a clean message', () => {
    expect(() => loadEntryConfig({ PARALLAX_TOKENS: '{bad' })).toThrow(
      'PARALLAX_TOKENS is not valid JSON',
    );
  });
});
