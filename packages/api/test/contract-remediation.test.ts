import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplyContractContextArgs } from '@parallax/shared/lain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';
import { buildApp } from '../src/server.js';

const declaration = {
  provides: [{ service: 'api', key: 'http:GET /orders', source: 'test' }],
};

describe('contract remediation', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let calls: ApplyContractContextArgs[];
  const auth = { authorization: 'Bearer t' };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-contracts-'));
    calls = [];
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [
        { token: 't', orgId: 'o', scopes: ['read', 'write'] },
        { token: 'reader', orgId: 'o', scopes: ['read'] },
      ],
      webBundlePath: dir,
    });
    const engine = {
      ...createLainMock(),
      applyContractContext: async (args: ApplyContractContextArgs) => {
        calls.push(args);
        return {
          applied: !args.dry_run,
          dry_run: args.dry_run,
          yaml: 'provides:\n  - service: api\n',
        };
      },
    } as LainAdapter;
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

  const apply = (dryRun: boolean, token = 't', body: unknown = declaration) =>
    app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/contracts/remediation`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snapshot: 'live', ...(body as Record<string, unknown>), dry_run: dryRun },
    });

  it('forwards dry-run and apply to the native Lain write path', async () => {
    const preview = await apply(true);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ applied: false, dry_run: true });

    const applied = await apply(false);
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ applied: true, dry_run: false });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ snapshot: 'live', dry_run: true, ...declaration });
    expect(calls[1]).toMatchObject({ snapshot: 'live', dry_run: false, ...declaration });
  });

  it('rejects empty declarations before calling Lain', async () => {
    const response = await apply(true, 't', {});
    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('requires a write token', async () => {
    const response = await apply(false, 'reader');
    expect(response.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
