import { ApiClient } from './api-client.js';
import { loadEntryConfig } from './config.js';
import { runStdio } from './server.js';

// Wiring del bin: toda la validación vive en loadEntryConfig (testeable en
// proceso); este fichero sólo la conecta al transporte stdio.
try {
  const cfg = loadEntryConfig(process.env);
  await runStdio(new ApiClient(cfg));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
