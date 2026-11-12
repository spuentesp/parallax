import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ListServiceRefsArgs } from '@parallax/shared/lain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

describe('native RPC and HTTP analysis', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let refsArgs: ListServiceRefsArgs | undefined;
  const auth = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-analysis-'));
    refsArgs = undefined;
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: dir,
    });
    const engine = {
      ...createLainMock(),
      listServiceRefs: async (args: ListServiceRefsArgs) => {
        refsArgs = args;
        return {
          items: [
            {
              repo: 'sdk',
              path: 'src/client.py',
              line: 8,
              value: 'grpc.gateway.internal',
              host: 'grpc.gateway.internal',
              outcome: { kind: 'resolved', service: 'gateway' },
              usage: 'production',
              self_reference: false,
              linked_to_call: true,
            },
          ],
          scope: { reviewed: [], unreviewed: [] },
        };
      },
      listContracts: async () => ({
        items: [
          {
            endpoint: { key: 'http:GET /orders/:id', service: 'web' },
            providers: [{ repo: 'web', path: 'app/orders/[id]/route.ts', line: 3 }],
          },
        ],
        cursor: null,
      }),
    } as unknown as LainAdapter;
    app.lainClientFor = async () => engine;
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'ws', lainUrl: 'http://lain.test' },
    });
    workspaceId = (created.json() as { workspace: { id: string } }).workspace.id;
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns real Lain service-reference identities and filter arguments', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/service-refs?outcome=resolved&suggestions=true&limit=5`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      repo: 'sdk',
      outcome: { kind: 'resolved', service: 'gateway' },
      linked_to_call: true,
    });
    expect(refsArgs).toMatchObject({
      snapshot: 'live',
      outcome: 'resolved',
      suggestions: true,
      limit: 5,
    });
  });

  it('returns HTTP routes discovered by the native Next.js App Router sensor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/http-routes?repo=web`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      endpoint: { key: 'http:GET /orders/:id', service: 'web' },
      providers: [{ path: 'app/orders/[id]/route.ts' }],
    });
  });
});
