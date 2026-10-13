import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainClient } from '../src/lain-adapter/client.js';

describe('LainAdapter real client stub', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('probes LAIN_URL at boot and rejects when unreachable (Review Focus #2)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      createLainClient({ lainUrl: 'http://lain.invalid:9999/mcp', apiVersion: '1' }),
    ).rejects.toThrow(/LainUnavailable/);
  });

  it('probes LAIN_URL at boot and accepts when the server responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const a = await createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' });
    expect(a.apiVersion).toBe('1');
  });

  it('raises NotImplementedError on the first tool call (subproject 2 fills in)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const a = await createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' });
    await expect(a.listServices('live')).rejects.toThrow(/not implemented/i);
  });
});
