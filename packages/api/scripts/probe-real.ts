import { createLainClient } from '../src/lain-adapter/client.js';

async function main() {
  const a = await createLainClient({
    lainUrl: 'http://localhost:9999/mcp',
    apiVersion: '1',
  });
  console.log('handshake OK — apiVersion:', a.apiVersion, 'analyzerVersion:', a.analyzerVersion);
  const services = await a.listServices('live');
  console.log('listServices →', JSON.stringify(services, null, 2).slice(0, 600));
}
main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
