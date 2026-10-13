#!/usr/bin/env tsx
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';

async function main() {
  process.env.LAIN_ADAPTER = 'mock';
  process.env.PARALLAX_MCP_TRANSPORT = 'http-sse';
  if (!process.env.PARALLAX_TOKENS) {
    process.env.PARALLAX_TOKENS = JSON.stringify([
      { token: 'smoke_t', orgId: 'org_smoke', scopes: ['read', 'write', 'publish'] },
    ]);
  }

  const cfg = loadConfig();
  const app = await buildApp(cfg);
  await app.listen({ port: cfg.port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${cfg.port}`;
  const token = cfg.authTokens[0]!.token;

  function parseSse(body: string): Record<string, unknown> {
    const line = body.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`no data line in SSE body: ${body.slice(0, 200)}`);
    return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
  }

  // 1. /health
  const h = await fetch(`${base}/health`);
  if (!h.ok) throw new Error(`/health returned ${h.status}`);
  const hb = (await h.json()) as Record<string, unknown>;
  if (hb.status !== 'ok') throw new Error(`/health status is ${hb.status}`);
  console.log('✓ /health');

  // 2. /orgs with bearer
  const o = await fetch(`${base}/orgs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!o.ok) throw new Error(`/orgs returned ${o.status}`);
  const ob = (await o.json()) as { orgs: unknown[] };
  if (!Array.isArray(ob.orgs)) throw new Error('/orgs is not an array');
  console.log('✓ /orgs returns 200 []');

  // 3. MCP initialize + tools/list over http-sse
  const init = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    }),
  });
  if (!init.ok) throw new Error(`MCP initialize returned ${init.status}`);
  const session = init.headers.get('mcp-session-id');
  if (!session) throw new Error('MCP did not return a session id');

  const list = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-session-id': session,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  const listBody = parseSse(await list.text()) as {
    result?: { tools?: Array<{ name: string }> };
  };
  const names = listBody.result?.tools?.map((t) => t.name) ?? [];
  for (const expected of [
    'parallax_explore',
    'parallax_assess_pr',
    'parallax_get_assessment',
    'parallax_get_evidence',
  ]) {
    if (!names.includes(expected)) throw new Error(`MCP tools/list missing ${expected}`);
  }
  console.log('✓ MCP /mcp tools/list has the 4 product tools');

  await app.close();
  console.log('SMOKE OK');
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
