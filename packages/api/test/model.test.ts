// El modelo del investigador se construye en un solo lugar: sin NEBIUS_TOKEN no
// hay modelo (el llamador declara failed:no_model_configured); con él, la
// credencial, el endpoint, los modelos y el presupuesto salen de la config.

import { describe, expect, it } from 'vitest';
import { investigatorModel } from '../src/agent/model.js';
import { INVESTIGATOR_DEFAULTS, loadConfig } from '../src/config.js';

const tokens = JSON.stringify([{ token: 't1', orgId: 'o1', scopes: ['read'] }]);

describe('investigatorModel', () => {
  it('is null without NEBIUS_TOKEN', () => {
    expect(investigatorModel(loadConfig({ PARALLAX_TOKENS: tokens }))).toBeNull();
    expect(investigatorModel(loadConfig({ PARALLAX_TOKENS: tokens, NEBIUS_TOKEN: '' }))).toBeNull();
  });

  it('takes endpoint, models and budget from the config defaults', () => {
    const m = investigatorModel(loadConfig({ PARALLAX_TOKENS: tokens, NEBIUS_TOKEN: 'n' }));
    expect(m?.settings.baseUrl).toBe(INVESTIGATOR_DEFAULTS.nemotronBaseUrl);
    expect(m?.budget).toEqual({
      maxToolCalls: INVESTIGATOR_DEFAULTS.investigatorMaxToolCalls,
      maxModelMs: INVESTIGATOR_DEFAULTS.investigatorMaxModelMs,
    });
  });

  it('honours overrides from the environment', () => {
    const m = investigatorModel(
      loadConfig({
        PARALLAX_TOKENS: tokens,
        NEBIUS_TOKEN: 'n',
        NEMOTRON_BASE_URL: 'https://example.test/v1',
        NEMOTRON_WORKER_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
        INVESTIGATOR_MAX_TOOL_CALLS: '5',
      }),
    );
    expect(m?.settings.baseUrl).toBe('https://example.test/v1');
    expect(m?.settings.workerModel).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(m?.budget.maxToolCalls).toBe(5);
  });

  it('answers get 4096 tokens by default (double the old 2048), overridable and bounded', () => {
    const base = { PARALLAX_TOKENS: tokens, NEBIUS_TOKEN: 'n' };
    expect(INVESTIGATOR_DEFAULTS.investigatorMaxTokens).toBe(4096);
    expect(investigatorModel(loadConfig(base))?.settings.maxTokens).toBe(4096);
    expect(
      investigatorModel(loadConfig({ ...base, INVESTIGATOR_MAX_TOKENS: '8192' }))?.settings
        .maxTokens,
    ).toBe(8192);
    expect(() => loadConfig({ ...base, INVESTIGATOR_MAX_TOKENS: '100' })).toThrow();
    expect(() => loadConfig({ ...base, INVESTIGATOR_MAX_TOKENS: '99999' })).toThrow();
  });
});
