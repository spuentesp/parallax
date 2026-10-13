import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiEndpointNotImplemented } from './client.js';

describe('web apiClient', () => {
  it('throws ApiEndpointNotImplemented on 501', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'NotImplemented' }), { status: 501 }),
      );
    const c = new ApiClient({ baseUrl: 'http://x', token: 't' });
    await expect(c.get('/y')).rejects.toBeInstanceOf(ApiEndpointNotImplemented);
    spy.mockRestore();
  });
  it('parses the JSON body on success', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ orgs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new ApiClient({ baseUrl: 'http://x', token: 't' });
    const r = await c.get<{ orgs: unknown[] }>('/orgs');
    expect(r.orgs).toEqual([]);
    spy.mockRestore();
  });
});
