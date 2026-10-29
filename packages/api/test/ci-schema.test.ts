// Esquema de la configuración de CI por workspace: valores por defecto y clave foránea.
// Se usa la base real que construye buildApp; ninguna fila de estado se fabrica a mano
// para leerla después (la configuración sólo se escribe por la ruta PUT en otros tests).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema.js';
import { buildApp } from '../src/server.js';

describe('workspace_ci table', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-ci-schema-'));
    app = await buildApp({
      port: 0,
      databasePath: join(dir, 'p.db'),
      lainAdapter: 'mock',
      mcpTransport: 'stdio',
      authTokens: [{ token: 't', orgId: 'o', scopes: ['read', 'write'] }],
      webBundlePath: join(dir, 'web'),
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to mode off, no branch filter and no comments', async () => {
    const ws = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { authorization: 'Bearer t' },
      payload: { name: 'shop' },
    });
    const workspaceId = ws.json().workspace.id as string;
    await app.db.insert(schema.workspaceCi).values({ workspaceId, updatedAt: 1 });
    const [row] = await app.db
      .select()
      .from(schema.workspaceCi)
      .where(eq(schema.workspaceCi.workspaceId, workspaceId));
    expect(row?.mode).toBe('off');
    expect(row?.baseBranch).toBeNull();
    expect(row?.reportComments).toBe(false);
  });

  it('refuses CI settings for a workspace that does not exist', async () => {
    await expect(
      app.db.insert(schema.workspaceCi).values({ workspaceId: 'ws_missing', updatedAt: 1 }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
