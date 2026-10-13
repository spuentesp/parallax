import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';

describe('MCP HTTP transport', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-mcp-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'http-sse',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer t',
  };

  // MCP Streamable HTTP transport replies with an SSE stream. Parse the first
  // `data: {...}` line as the JSON-RPC envelope.
  function parseSse(body: string): Record<string, unknown> {
    const line = body.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`no data line in SSE body: ${body.slice(0, 200)}`);
    return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
  }

  it('POST /mcp with initialize returns a valid JSON-RPC response', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      },
    });
    expect([200, 201]).toContain(r.statusCode);
    const body = parseSse(r.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect((body.result as { serverInfo?: { name?: string } })?.serverInfo?.name).toBe('parallax');
  });

  it('POST /mcp with tools/list returns the four product tools', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      },
    });
    const session = init.headers['mcp-session-id'];
    expect(session).toBeTruthy();

    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...headers, 'mcp-session-id': String(session) },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    const body = parseSse(list.body) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const tools = body.result?.tools?.map((t) => t.name) ?? [];
    expect(tools).toEqual(
      expect.arrayContaining([
        'parallax_explore',
        'parallax_assess_pr',
        'parallax_get_assessment',
        'parallax_get_evidence',
      ]),
    );
  });

  it('parallax_explore call returns a JSON-RPC 2.0 response without uncaught throw', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      },
    });
    const session = init.headers['mcp-session-id'];

    const explore = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...headers, 'mcp-session-id': String(session) },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'parallax_explore', arguments: { orgId: 'o' } },
      },
    });
    expect(explore.statusCode).toBe(200);
    const body = parseSse(explore.body);
    expect(body.jsonrpc).toBe('2.0');
  });
});
