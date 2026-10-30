// Ruta GET /api/workspaces/:id/advisor — el advisor es la superficie del
// producto: devuelve señales, correlación, propuestas y el YAML del §6. El
// motor se habla por HTTP real (mismo patrón que /topology), así que aquí se
// levanta un MCP mínimo con respuestas enlatadas: sonda de capacidad
// graphql rechazada (motor 0.9), un graphql_no_op y dos grupos de
// proveedores para la llave.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

interface RpcReq {
  id?: number | string;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function envelope(id: number | string | undefined, data: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      content: [
        {
          text: JSON.stringify({ analyzer_version: '0.9.1', api_version: 1, data }),
        },
      ],
    },
  });
}

function rpcError(id: number | string | undefined, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32602, message } });
}

describe('GET /api/workspaces/:id/advisor', () => {
  let dir: string;
  let lain: Server;
  let lainUrl: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-advisor-route-'));
    mkdirSync(join(dir, 'checkout', 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'checkout', 'src', 'ProductDetails.graphql'),
      'query ProductDetails($slug: String!) {\n  product(slug: $slug) { id }\n}\n',
    );
    // Copia de SDL + operaciones en el mismo repo: disparan provides_graphql.
    writeFileSync(join(dir, 'checkout', 'schema.graphql'), 'type Query { product: Product }\n');

    lain = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const rpc = JSON.parse(body) as RpcReq;
        if (rpc.method === 'tools/list') {
          const names = [
            'list_services',
            'get_service',
            'prepare_snapshot',
            'get_snapshot',
            'list_contracts',
            'get_contract',
            'list_unresolved',
            'check_binding',
            'diff_contracts',
            'trace_impact',
            'trace_flow',
            'apply_contract_context',
            'list_service_refs',
            'get_coverage',
            'resolve_evidence',
            'read_source',
          ];
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id ?? null,
              result: { tools: names.map((name) => ({ name })) },
            }),
          );
          return;
        }
        res.setHeader('content-type', 'application/json');
        const tool = rpc.params?.name;
        if (tool === 'list_services') {
          res.end(
            envelope(rpc.id, {
              items: [
                {
                  service: 'app',
                  repo: 'app',
                  endpoints: 1,
                  consumer_services: 0,
                  unresolved_inbound: 0,
                  paths: [],
                },
              ],
              scope: { configured_only: true, reviewed: [], unreviewed: [] },
            }),
          );
        } else if (tool === 'list_unresolved') {
          res.end(
            envelope(rpc.id, {
              items: [
                {
                  reason: 'graphql_no_op',
                  consumer: {
                    id: 'app:Function:src/ProductDetails.graphql:graphql-call%3Aquery%3Aproduct:1',
                    repo: 'app',
                    path: 'src/ProductDetails.graphql',
                    line: 1,
                  },
                },
              ],
              ambiguous: [],
              scope: { configured_only: true, reviewed: [], unreviewed: [] },
            }),
          );
        } else if (tool === 'list_contracts') {
          res.end(
            envelope(rpc.id, {
              items: [
                {
                  endpoint: { key: 'graphql:query:product', service: 'app' },
                  bound_consumers: 0,
                  providers: [{ repo: 'app', path: 'schema.graphql', line: 1 }],
                },
              ],
              scope: { configured_only: true, reviewed: [], unreviewed: [] },
            }),
          );
        } else if (tool === 'check_binding') {
          res.end(rpcError(rpc.id, 'invalid_argument: topic endpoints not supported in 0.9'));
        } else {
          res.end(envelope(rpc.id, {}));
        }
      });
    });
    await new Promise<void>((resolve) => lain.listen(0, '127.0.0.1', resolve));
    lainUrl = `http://127.0.0.1:${String((lain.address() as AddressInfo).port)}/mcp`;

    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });

    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { authorization: 'Bearer t' },
      payload: { name: 'demo', lainUrl },
    });
    wsId = ws.json().workspace.id as string;
    // El repo se inserta con el id que usa LAIN en su repos.yaml: el advisor
    // correlaciona por repo id, y el POST generaría un id opaco.
    await app.db.insert(schema.repo).values({
      id: 'app',
      workspaceId: wsId,
      uri: 'local',
      local: join(dir, 'checkout'),
      sha: null,
      createdAt: Date.now(),
    });
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => lain.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = { authorization: 'Bearer t' };

  it('returns findings, proposals and the §6 yaml (no auto-apply)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/advisor`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.source).toBe('lain');
    expect(body.advisor.correlation.graphqlNoOp.byRepo.app).toMatchObject({ total: 1, matched: 1 });
    expect(body.advisor.capability.graphqlBindings).toBe('unsupported');
    expect(body.advisor.proposals.applicableBindings).toBe(0);
    expect(body.advisor.yaml).toContain('provides_graphql: false');
    // nada aplicado: el advisor sólo propone
    expect(body.applied).toBeUndefined();
  });

  it('emits only the yaml with ?emit=yaml', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/advisor?emit=yaml`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(typeof body.yaml).toBe('string');
    expect(body.yaml).toContain('services:');
    expect(body.advisor).toBeUndefined();
  });

  it('reports unconfigured workspaces without inventing findings', async () => {
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'sin-lain' },
    });
    const id = ws.json().workspace.id as string;
    const r = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}/advisor`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ advisor: null, source: 'unconfigured' });
  });

  it('returns null for an unknown workspace', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/workspaces/ws_missing/advisor',
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ advisor: null });
  });
});
