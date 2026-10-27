import { describe, expect, it } from 'vitest';
import { investigatorSettings, loadConfig, modelEnv } from '../src/config.js';

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
      NEBIUS_TOKEN: 'nebius_t',
      WEB_BUNDLE_PATH: './packages/web/dist',
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.lainAdapter).toBe('real');
    expect(cfg.lainUrl).toBe('http://lain:9999/mcp');
    expect(cfg.mcpTransport).toBe('http-sse');
    expect(cfg.authTokens).toHaveLength(2);
    expect(cfg.nebiusToken).toBe('nebius_t');
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

  it('treats an empty NEBIUS_TOKEN as unset', () => {
    const tokens = JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]);
    expect(loadConfig({ PARALLAX_TOKENS: tokens, NEBIUS_TOKEN: '' }).nebiusToken).toBeUndefined();
    expect(loadConfig({ PARALLAX_TOKENS: tokens, NEBIUS_TOKEN: '  ' }).nebiusToken).toBeUndefined();
    expect(loadConfig({ PARALLAX_TOKENS: tokens }).nebiusToken).toBeUndefined();
  });

  it('has a single model credential: the old NEMOTRON_TOKEN name fails loudly', () => {
    const tokens = JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]);
    expect(() => loadConfig({ PARALLAX_TOKENS: tokens, NEMOTRON_TOKEN: 'old' })).toThrow(
      /renamed to NEBIUS_TOKEN/,
    );
    // Un `NEMOTRON_TOKEN=` vacío heredado del .env.example anterior no estorba.
    expect(
      loadConfig({ PARALLAX_TOKENS: tokens, NEMOTRON_TOKEN: '', NEBIUS_TOKEN: 'n' }).nebiusToken,
    ).toBe('n');
  });

  it('modelEnv is the one reader of the model variables, usable without app tokens', () => {
    expect(
      modelEnv({
        NEBIUS_TOKEN: 'n',
        NEMOTRON_BASE_URL: 'https://example.test/v1',
        NEMOTRON_WORKER_MODEL: 'w',
      }),
    ).toEqual({
      nebiusToken: 'n',
      nemotronBaseUrl: 'https://example.test/v1',
      nemotronPlannerModel: undefined,
      nemotronWorkerModel: 'w',
    });
  });

  it('investigatorSettings resolves the §6 budget and §14 model defaults', () => {
    const base = loadConfig({
      PARALLAX_TOKENS: JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]),
    });
    const d = investigatorSettings(base);
    expect(d.maxToolCalls).toBe(16);
    expect(d.maxModelMs).toBe(120_000);
    expect(d.baseUrl).toBe('https://api.tokenfactory.nebius.com/v1');
    expect(d.workerModel).toContain('Nemotron');

    const custom = loadConfig({
      PARALLAX_TOKENS: JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]),
      INVESTIGATOR_MAX_TOOL_CALLS: '3',
      INVESTIGATOR_MAX_MODEL_MS: '5000',
      NEMOTRON_WORKER_MODEL: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    });
    const c = investigatorSettings(custom);
    expect(c.maxToolCalls).toBe(3);
    expect(c.maxModelMs).toBe(5000);
    expect(c.workerModel).toBe('nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B');
  });
});
