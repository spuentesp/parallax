import { buildApp } from './server.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    {
      port: config.port,
      lainAdapter: config.lainAdapter,
      mcpTransport: config.mcpTransport,
    },
    'parallax api listening',
  );
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
