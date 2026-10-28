import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api-client.js';
import { buildMcpServer } from '../src/server.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function connect(): Promise<Client> {
  const api = new ApiClient({ baseUrl: 'http://api', token: 't' });
  const server = buildMcpServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mcp-tests', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  const block = res.content[0];
  if (!block || block.type !== 'text' || block.text === undefined) {
    throw new Error(`expected a text block, got ${JSON.stringify(res.content)}`);
  }
  return block.text;
}

describe('buildMcpServer', () => {
  it('announces the parallax server identity', async () => {
    const client = await connect();
    expect(client.getServerVersion()).toEqual({ name: 'parallax', version: '0.1.0' });
  });

  it('parallax_explore serves the organization payload as JSON text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(200, { orgs: [] }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_explore',
      arguments: { orgId: 'acme' },
    });
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toBe('{"orgs":[]}');
    expect(res.isError).toBeFalsy();
  });

  it('parallax_explore reports unimplemented endpoints as an error result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(501, { code: 'NotImplemented', message: 'x' }),
    );
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_explore',
      arguments: { orgId: 'acme' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> }))).toEqual({
      code: 'NotImplemented',
      message: 'x',
    });
  });

  it('parallax_explore surfaces real api failures as an error result, never as success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(500, { boom: true }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_explore',
      arguments: { orgId: 'acme' },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toBe(
      'api 500: {"boom":true}',
    );
  });

  it('parallax_assess_pr posts the prUrl form when a prUrl is given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { created: true }));
    const client = await connect();
    await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme', prUrl: 'https://github.com/o/r/pull/1' },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      prUrl: 'https://github.com/o/r/pull/1',
      orgId: 'acme',
    });
  });

  it('parallax_assess_pr posts the repo/base/head form when no prUrl is given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { created: true }));
    const client = await connect();
    await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme', repo: 'orders', base: 'a', head: 'b' },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      repo: 'orders',
      base: 'a',
      head: 'b',
      orgId: 'acme',
    });
  });

  it('parallax_assess_pr rejects an input with neither prUrl nor repo/base/head', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> }))).toEqual({
      error: 'repo, base and head are required when prUrl is absent',
    });
  });

  it('parallax_assess_pr reports unimplemented endpoints as an error result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(501, { code: 'NotImplemented' }),
    );
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme', prUrl: 'https://github.com/o/r/pull/1' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> }))).toEqual({
      code: 'NotImplemented',
    });
  });

  it('parallax_get_assessment reads the persisted report', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { assessment: { id: 'a_1' } }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_get_assessment',
      arguments: { assessmentId: 'a_1' },
    });
    expect(fetchSpy).toHaveBeenCalledWith('http://api/assessments/a_1', expect.anything());
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toBe(
      '{"assessment":{"id":"a_1"}}',
    );
  });

  it('parallax_get_assessment points at the spec doc when the endpoint is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(501, { code: 'NotImplemented', message: 'x' }),
    );
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_get_assessment',
      arguments: { assessmentId: 'a_1' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> }))).toEqual({
      code: 'NotImplemented',
      message: 'x',
      specDoc: SPEC_DOC,
    });
  });

  it('parallax_get_evidence answers not-implemented without touching the api', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_get_evidence',
      arguments: { assessmentId: 'a_1', evidenceId: 'e_1' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> }))).toEqual({
      code: 'ApiEndpointNotImplemented',
      message: 'parallax_get_evidence lands in subproject 3',
      doc: SPEC_DOC,
    });
  });
});

describe('buildMcpServer (tool contract)', () => {
  it('registers four tools with the documented descriptions and input schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual([
      'parallax_assess_pr',
      'parallax_explore',
      'parallax_get_assessment',
      'parallax_get_evidence',
    ]);
    expect(byName.get('parallax_explore')?.description).toBe(
      'Explore an organization: list services, get a service with its consumers.',
    );
    expect(byName.get('parallax_assess_pr')?.description).toBe(
      'Trigger a PR impact assessment (lands in subproject 3).',
    );
    expect(byName.get('parallax_get_assessment')?.description).toBe(
      'Read a persisted assessment (lands in subproject 3).',
    );
    expect(byName.get('parallax_get_evidence')?.description).toBe(
      'Read evidence (lands in subproject 3).',
    );

    const explore = byName.get('parallax_explore')?.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(explore.required).toEqual(['orgId']);
    expect(explore.properties.orgId).toMatchObject({ minLength: 1 });
    expect(explore.properties.focus?.enum).toEqual(['services', 'consumers', 'providers']);
    expect(explore.properties.serviceId).toMatchObject({ type: 'string' });

    const assess = byName.get('parallax_assess_pr')?.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(assess.required).toEqual(['orgId']);
    expect(assess.properties.prUrl).toMatchObject({ type: 'string', format: 'uri' });
    expect(assess.properties.base).toMatchObject({ minLength: 1 });
    expect(assess.properties.head).toMatchObject({ minLength: 1 });

    const evidence = byName.get('parallax_get_evidence')?.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(evidence.required).toEqual(['assessmentId', 'evidenceId']);
    expect(evidence.properties.assessmentId).toMatchObject({ minLength: 1 });
    expect(evidence.properties.evidenceId).toMatchObject({ minLength: 1 });
  });

  it('parallax_explore requests the orgs path for the given org', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(200, {}));
    const client = await connect();
    await client.callTool({ name: 'parallax_explore', arguments: { orgId: 'acme' } });
    expect(fetchSpy).toHaveBeenCalledWith('http://api/orgs/acme', expect.anything());
  });

  it('parallax_assess_pr posts to /assessments and answers with the payload as JSON text', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { created: true }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme', prUrl: 'https://github.com/o/r/pull/1' },
    });
    expect(fetchSpy).toHaveBeenCalledWith('http://api/assessments', expect.anything());
    const typed = res as { content: Array<{ type: string; text?: string }> };
    expect(typed.content).toHaveLength(1);
    expect(textOf(typed)).toBe('{"created":true}');
    expect(res.isError).toBeFalsy();
  });

  it('parallax_assess_pr surfaces real api failures as an error result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(500, { boom: true }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_assess_pr',
      arguments: { orgId: 'acme', prUrl: 'https://github.com/o/r/pull/1' },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toBe(
      'api 500: {"boom":true}',
    );
  });

  it('parallax_assess_pr rejects partial repo/base/head inputs', async () => {
    const client = await connect();
    for (const args of [
      { orgId: 'acme' },
      { orgId: 'acme', repo: 'orders' },
      { orgId: 'acme', repo: 'orders', base: 'a' },
      { orgId: 'acme', head: 'b' },
      { orgId: 'acme', repo: 'orders', head: 'b' },
      { orgId: 'acme', base: 'a', head: 'b' },
    ]) {
      const res = await client.callTool({ name: 'parallax_assess_pr', arguments: args });
      expect(res.isError).toBe(true);
      expect(
        JSON.parse(textOf(res as { content: Array<{ type: string; text?: string }> })),
      ).toEqual({
        error: 'repo, base and head are required when prUrl is absent',
      });
    }
  });

  it('parallax_get_assessment surfaces real api failures as an error result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(500, { boom: true }));
    const client = await connect();
    const res = await client.callTool({
      name: 'parallax_get_assessment',
      arguments: { assessmentId: 'a_1' },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toBe(
      'api 500: {"boom":true}',
    );
  });
});
