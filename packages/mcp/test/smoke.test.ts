import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiEndpointNotImplemented } from '../src/api-client.js';

describe('@parallax/mcp api-client', () => {
  it('translates 501 to ApiEndpointNotImplemented with the api body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'NotImplemented', message: 'x', doc: 'https://e' }),
        { status: 501 },
      ),
    );
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiEndpointNotImplemented);
    expect((err as ApiEndpointNotImplemented).body.code).toBe('NotImplemented');
    fetchSpy.mockRestore();
  });
});
