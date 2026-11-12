import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { NemotronProvider } from '../src/agent/nemotron.js';
import { RealLainAdapter } from '../src/lain-adapter/client.js';

describe('transport body deadlines', () => {
  it.each(['nemotron', 'lain'] as const)(
    '%s keeps its deadline after response headers arrive',
    async (transport) => {
      let headersSent = false;
      let bodyCompleted = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.flushHeaders();
        headersSent = true;
        const timer = setTimeout(() => {
          bodyCompleted = true;
          res.end(
            JSON.stringify(
              transport === 'nemotron'
                ? {
                    model: 'test',
                    choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
                  }
                : {
                    jsonrpc: '2.0',
                    id: 1,
                    result: { structuredContent: { data: { items: [] } } },
                  },
            ),
          );
        }, 3_000);
        timers.push(timer);
        res.on('close', () => clearTimeout(timer));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        if (transport === 'nemotron') {
          const provider = new NemotronProvider({
            baseUrl: url,
            apiKey: 'test',
            plannerModel: 'test',
            workerModel: 'test',
            timeoutMs: 400,
          });
          await expect(
            provider.complete([{ role: 'user', content: 'hello' }]),
          ).rejects.toMatchObject({ name: 'AbortError' });
        } else {
          const adapter = new RealLainAdapter(
            {
              lainUrl: url,
              apiVersion: '1',
              timeoutMs: 400,
              maxRetries: 0,
            },
            '0.11.0',
          );
          await expect(adapter.listServices({ snapshot: 'live' })).rejects.toMatchObject({
            code: 'LainUnavailable',
          });
        }
        expect(headersSent).toBe(true);
        expect(bodyCompleted).toBe(false);
      } finally {
        for (const timer of timers) clearTimeout(timer);
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
