import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies sensible defaults when only required vars are set', () => {
    const cfg = loadConfig({
      PARALLAX_TOKENS: JSON.stringify([{ token: 't1', orgId: 'org_demo', scopes: ['read'] }]),
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.databasePath).toBe('./data/parallax.db');
    expect(cfg.lainAdapter).toBe('mock');
    expect(cfg.mcpTransport).toBe('stdio');
    expect(cfg.authTokens).toHaveLength(1);
  });

  it('parses a full env', () => {
    const cfg = loadConfig({
      PORT: '9000',
      DATABASE_PATH: '/tmp/p.db',
      LAIN_ADAPTER: 'real',
      LAIN_URL: 'http://lain:9999/mcp',
      PARALLAX_MCP_TRANSPORT: 'http-sse',
      PARALLAX_TOKENS: JSON.stringify([
        { token: 't1', orgId: 'o1', scopes: ['read', 'write'] },
        { token: 't2', orgId: 'o2', scopes: ['read'] },
      ]),
      NEMOTRON_TOKEN: 'nemo_t',
      WEB_BUNDLE_PATH: './packages/web/dist',
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.lainAdapter).toBe('real');
    expect(cfg.lainUrl).toBe('http://lain:9999/mcp');
    expect(cfg.mcpTransport).toBe('http-sse');
    expect(cfg.authTokens).toHaveLength(2);
    expect(cfg.nemotronToken).toBe('nemo_t');
    expect(cfg.webBundlePath).toBe('./packages/web/dist');
  });

  it('rejects when PARALLAX_TOKENS is missing', () => {
    expect(() => loadConfig({})).toThrow(/PARALLAX_TOKENS/);
  });

  it('rejects when a token is missing scopes', () => {
    expect(() =>
      loadConfig({
        PARALLAX_TOKENS: JSON.stringify([{ token: 't1', orgId: 'o1' }]),
      }),
    ).toThrow();
  });

  it('rejects when LAIN_ADAPTER=real without LAIN_URL', () => {
    expect(() =>
      loadConfig({
        PARALLAX_TOKENS: JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]),
        LAIN_ADAPTER: 'real',
      }),
    ).toThrow(/LAIN_URL/);
  });
});
