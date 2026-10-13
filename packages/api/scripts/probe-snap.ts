async function main() {
  const raw = await fetch('http://localhost:9999/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'prepare_snapshot', arguments: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf', billing: '972651746b73f234031e3eae3c7b71b5d255d0ef' } } },
    }),
  });
  const body = await raw.json() as any;
  console.log('=== raw result ===');
  console.log(JSON.stringify(body.result, null, 2).slice(0, 1500));
}
main().catch(console.error);
