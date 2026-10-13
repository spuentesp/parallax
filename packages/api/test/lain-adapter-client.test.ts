import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainClient } from '../src/lain-adapter/client.js';

describe('LainAdapter real client', () => {
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
    ).rejects.toMatchObject({ code: 'LainUnavailable' });
  });

  it('probes LAIN_URL at boot and rejects when tools/list is missing contract tools', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'foo' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' }),
    ).rejects.toMatchObject({ code: 'ToolSchemaMismatch' });
  });

  it('accepts when the handshake returns all 9 contract tools', async () => {
    const tools = [
      'list_services',
      'get_service',
      'prepare_snapshot',
      'get_snapshot',
      'diff_contracts',
      'trace_impact',
      'get_coverage',
      'resolve_evidence',
      'read_source',
    ].map((name) => ({ name }));
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const a = await createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' });
    expect(a.apiVersion).toBe('1');
    expect(typeof a.analyzerVersion).toBe('string');
  });

  it('rejects when lain returns HTTP 503 at handshake', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(
      createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' }),
    ).rejects.toMatchObject({ code: 'LainUnavailable' });
  });

  it('rejects when JSON-RPC returns an error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'method not found' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' }),
    ).rejects.toMatchObject({ code: 'LainUnavailable' });
  });
});
