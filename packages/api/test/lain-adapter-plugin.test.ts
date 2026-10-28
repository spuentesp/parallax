import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { resetLainMock } from '../src/lain-adapter/mock.js';
import lainAdapterPlugin from '../src/plugins/lain-adapter.js';

const baseConfig: AppConfig = {
  port: 8080,
  databasePath: ':memory:',
  lainAdapter: 'mock',
  mcpTransport: 'stdio',
  authTokens: [{ token: 't', orgId: 'o', scopes: ['read'] }],
  webBundlePath: '/tmp',
};

describe('lain-adapter plugin', () => {
  beforeEach(() => resetLainMock());
  afterEach(() => resetLainMock());

  it('uses the mock when LAIN_ADAPTER=mock', async () => {
    const app = Fastify();
    app.decorate('config', baseConfig);
    await app.register(lainAdapterPlugin);
    expect(app.lain.apiVersion).toBe('1');
    const services = await app.lain.listServices({ snapshot: 'live' });
    expect(services.items.length).toBeGreaterThan(0);
    await app.close();
  });

  it('probes LAIN_URL when LAIN_ADAPTER=real (Review Focus #2)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const app = Fastify();
    app.decorate('config', {
      ...baseConfig,
      lainAdapter: 'real',
      lainUrl: 'http://lain.invalid/mcp',
    });
    await expect(app.register(lainAdapterPlugin)).rejects.toMatchObject({
      code: 'LainUnavailable',
    });
    fetchSpy.mockRestore();
    await app.close();
  });
});
