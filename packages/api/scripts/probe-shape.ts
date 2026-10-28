import { createLainClient } from '../src/lain-adapter/client.js';

async function main() {
  const a = await createLainClient({
    lainUrl: 'http://localhost:9999/mcp',
    apiVersion: '1',
  });
  const raw = await fetch('http://localhost:9999/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_services', arguments: { snapshot: 'live' } } }),
  });
  const body = await raw.json() as any;
  console.log('=== raw result ===');
  console.log(JSON.stringify(body.result, null, 2).slice(0, 2000));
}
main().catch((e) => { console.error(e); process.exit(1); });
