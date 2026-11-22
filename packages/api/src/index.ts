import { loadConfig } from './config.js';
import { buildApp } from './server.js';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host ?? '0.0.0.0' });
  app.log.info(
    {
      host: config.host ?? '0.0.0.0',
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
