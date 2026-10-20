import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

// El entrypoint se prueba por el borde de proceso real: se ejecuta con tsx y se
// observa exit code y stderr. No hay mocks internos posibles (es un bin).
function runEntry(env: Record<string, string>) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.PARALLAX_TOKENS;
  delete childEnv.PARALLAX_API_URL;
  Object.assign(childEnv, env);
  return spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// `pnpm exec tsx` por caso tarda varios segundos bajo carga; el timeout por
// defecto de 5 s hace que la suite falle por tiempo y no por comportamiento.
describe('parallax-mcp entrypoint', { timeout: 30_000 }, () => {
  it('exits 1 naming PARALLAX_TOKENS when it is missing', () => {
    const r = runEntry({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PARALLAX_TOKENS is required');
  });

  it('exits 1 when the token list is empty', () => {
    const r = runEntry({ PARALLAX_TOKENS: '[]' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PARALLAX_TOKENS must contain at least one token');
  });

  it('serves the MCP handshake over stdio and calls the api it was configured with', async () => {
    const api = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ orgs: [{ id: String(req.url) }] }));
    });
    await new Promise<void>((resolve) => {
      api.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (api.address() as AddressInfo).port;

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.PARALLAX_API_URL;
    const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      env: {
        ...childEnv,
        PARALLAX_TOKENS: JSON.stringify([{ token: 't', orgId: 'o', scopes: ['read'] }]),
        PARALLAX_API_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    const pending = new Map<number, (m: Record<string, unknown>) => void>();
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim().length > 0) {
          const msg = JSON.parse(line) as Record<string, unknown>;
          const resolve = pending.get(msg.id as number);
          if (resolve) {
            pending.delete(msg.id as number);
            resolve(msg);
          }
        }
        nl = buf.indexOf('\n');
      }
    });
    const waitFor = (id: number) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(
          () => reject(new Error(`no response for id ${id}; stdout so far: ${buf}`)),
          15_000,
        );
      });

    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0.0.0' },
          },
        })}\n`,
      );
      const init = (await waitFor(1)) as {
        result: { serverInfo: { name: string; version: string } };
      };
      expect(init.result.serverInfo).toEqual({ name: 'parallax', version: '0.1.0' });

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'parallax_explore', arguments: { orgId: 'acme' } },
        })}\n`,
      );
      const call = (await waitFor(2)) as {
        result: { content: Array<{ type: string; text: string }> };
      };
      expect(JSON.parse(call.result.content[0]?.text ?? '')).toEqual({
        orgs: [{ id: '/orgs/acme' }],
      });
    } finally {
      child.kill();
      api.close();
    }
  }, 20_000);
});
