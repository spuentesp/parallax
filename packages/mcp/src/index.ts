import { ApiClient } from './api-client.js';
import { runStdio } from './server.js';

const baseUrl = process.env.PARALLAX_API_URL ?? 'http://localhost:8080';
const tokensRaw = process.env.PARALLAX_TOKENS;
if (!tokensRaw) {
  console.error('PARALLAX_TOKENS is required (JSON array of {token, orgId, scopes})');
  process.exit(1);
}
const tokens = JSON.parse(tokensRaw) as Array<{
  token: string;
  orgId: string;
  scopes: string[];
}>;
if (!tokens[0]) {
  console.error('PARALLAX_TOKENS must contain at least one token');
  process.exit(1);
}

const api = new ApiClient({ baseUrl, token: tokens[0].token });
await runStdio(api);
