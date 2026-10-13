import { createLainClient } from '../src/lain-adapter/client.js';
async function main() {
  const a = await createLainClient({ lainUrl: 'http://localhost:9999/mcp', apiVersion: '1' });
  const base = await a.prepareSnapshot({ repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf', billing: '972651746b73f234031e3eae3c7b71b5d255d0ef', reports: '06f27bd72248a3c8513bc58807d98de15c286b8c', platform: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c' } });
  const head = await a.prepareSnapshot({ repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e', billing: '972651746b73f234031e3eae3c7b71b5d255d0ef', reports: '06f27bd72248a3c8513bc58807d98de15c286b8c', platform: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c' } });
  const diff = await a.diffContracts({ base: (base as any).snapshot, head: (head as any).snapshot });
  console.log(JSON.stringify(diff, null, 2).slice(0, 2000));
}
main().catch(console.error);
