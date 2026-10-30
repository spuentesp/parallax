import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLainClient, RealLainAdapter } from '../src/lain-adapter/client.js';

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
    ).rejects.toMatchObject({
      code: 'ToolSchemaMismatch',
      tool: 'list_services',
      message: expect.stringContaining('list_services, get_service'),
      detail: expect.stringContaining('16'),
    });
  });

  it('accepts when the handshake returns all 16 contract tools', async () => {
    const tools = [
      'list_services',
      'get_service',
      'list_contracts',
      'get_contract',
      'list_unresolved',
      'check_binding',
      'prepare_snapshot',
      'get_snapshot',
      'diff_contracts',
      'trace_impact',
      'trace_flow',
      'apply_contract_context',
      'list_service_refs',
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
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            structuredContent: {
              analyzer_version: '0.11.0',
              api_version: 1,
              data: { items: [], scope: { configured_only: true, reviewed: [], unreviewed: [] } },
            },
          },
        }),
      ),
    );
    // El boot opta por raw/arch/workspace de forma defensiva: cada carga
    // responde already_loaded y un fallo no debe romper el arranque.
    for (const pkg of ['raw', 'arch', 'workspace']) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [
                {
                  text: JSON.stringify({ package: pkg, loaded: true, already_loaded: false }),
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    const a = await createLainClient({ lainUrl: 'http://lain:9999/mcp', apiVersion: '1' });
    expect(a.apiVersion).toBe('1');
    expect(a.analyzerVersion).toBe('0.11.0');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const loadBody = JSON.parse((fetchSpy.mock.calls[2]?.[1]?.body as string) ?? '{}') as {
      params?: { name?: string; arguments?: { package?: string; snapshot?: string } };
    };
    expect(loadBody.params?.name).toBe('load_package');
    expect(loadBody.params?.arguments?.package).toBe('raw');
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

const contractTools = [
  'list_services',
  'get_service',
  'list_contracts',
  'get_contract',
  'list_unresolved',
  'check_binding',
  'prepare_snapshot',
  'get_snapshot',
  'diff_contracts',
  'trace_impact',
  'trace_flow',
  'apply_contract_context',
  'list_service_refs',
  'get_coverage',
  'resolve_evidence',
  'read_source',
];

function coreTransport(
  options: {
    apiVersion?: number;
    analyzerVersion?: string | null;
    activate?: boolean;
    textEnvelope?: boolean;
    initialTools?: string[];
  } = {},
): { fetchImpl: typeof fetch; calls: string[] } {
  let loaded = false;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const rpc = JSON.parse(String(init?.body)) as {
      method: string;
      params?: { name?: string; arguments?: { package?: string; snapshot?: string } };
    };
    const tool = rpc.params?.name;
    calls.push(
      tool === 'load_package' ? `load:${rpc.params?.arguments?.package}` : (tool ?? rpc.method),
    );
    let result: unknown;
    if (rpc.method === 'tools/list') {
      result = {
        tools: (loaded ? contractTools : (options.initialTools ?? ['load_package'])).map(
          (name) => ({ name }),
        ),
      };
    } else if (tool === 'load_package') {
      if (options.activate !== false) loaded = true;
      result = { structuredContent: { loaded: true } };
    } else if (tool === 'list_services') {
      if (rpc.params?.arguments?.snapshot !== 'live') {
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32602, message: 'snapshot:live required' },
        });
      }
      const payload = {
        api_version: options.apiVersion ?? 1,
        ...(options.analyzerVersion === null
          ? {}
          : { analyzer_version: options.analyzerVersion ?? '0.11.0' }),
        data: { items: [], scope: { configured_only: true, reviewed: [], unreviewed: [] } },
      };
      result = options.textEnvelope
        ? { content: [{ text: JSON.stringify(payload) }] }
        : { structuredContent: payload };
    } else {
      throw new Error(`unexpected request ${JSON.stringify(rpc)}`);
    }
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  };
  return { fetchImpl, calls };
}

describe('Lain release handshake', () => {
  it.each([false, true])(
    'loads contracts from core and reads the actual version (text=%s)',
    async (textEnvelope) => {
      const transport = coreTransport({ textEnvelope });
      const adapter = await createLainClient({
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: transport.fetchImpl,
      });
      expect(adapter.analyzerVersion).toBe('0.11.0');
      expect(transport.calls).toEqual([
        'tools/list',
        'load:contracts',
        'tools/list',
        'list_services',
        'load:raw',
        'load:arch',
        'load:workspace',
      ]);
    },
  );

  it('rejects an unsupported API before an assessment can use it', async () => {
    const transport = coreTransport({ apiVersion: 2 });
    await expect(
      createLainClient({
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: transport.fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'ToolSchemaMismatch',
      tool: 'list_services',
      message: expect.stringContaining('api_version'),
      detail: expect.stringContaining('1'),
    });
  });

  it.each([null, ''])(
    'rejects a missing or empty analyzer version (%s)',
    async (analyzerVersion) => {
      const transport = coreTransport({ analyzerVersion });
      await expect(
        createLainClient({
          lainUrl: 'http://lain.test/mcp',
          apiVersion: '1',
          fetchImpl: transport.fetchImpl,
        }),
      ).rejects.toMatchObject({
        code: 'ToolSchemaMismatch',
        tool: 'list_services',
        message: expect.stringContaining('analyzer_version'),
        detail: expect.stringContaining('analyzer version'),
      });
    },
  );

  it('verifies that loading contracts actually exposes the required tools', async () => {
    const transport = coreTransport({ activate: false });
    await expect(
      createLainClient({
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: transport.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'ToolSchemaMismatch' });
    expect(transport.calls).toEqual(['tools/list', 'load:contracts', 'tools/list']);
  });
});

describe('Lain handshake boundary cases', () => {
  it('loads contracts when the initial profile exposes only part of the package', async () => {
    const transport = coreTransport({ initialTools: ['load_package', 'list_services'] });
    const adapter = await createLainClient({
      lainUrl: 'http://lain.test/mcp',
      apiVersion: '1',
      fetchImpl: transport.fetchImpl,
    });
    expect(adapter.analyzerVersion).toBe('0.11.0');
    expect(transport.calls.slice(0, 4)).toEqual([
      'tools/list',
      'load:contracts',
      'tools/list',
      'list_services',
    ]);
  });

  it('surfaces a contract error envelope without treating it as catalog data', async () => {
    const adapter = new RealLainAdapter(
      {
        lainUrl: 'http://lain.test/mcp',
        apiVersion: '1',
        fetchImpl: async () =>
          Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              structuredContent: { error: { code: 'not_ready', message: 'still indexing' } },
            },
          }),
      },
      '0.11.0',
    );
    await expect(adapter.listServices({ snapshot: 'live' })).rejects.toMatchObject({
      code: 'LainUnavailable',
      message: expect.stringContaining('not_ready'),
    });
  });
});
