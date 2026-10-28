export interface EntryConfig {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * Entrada del bin parallax-mcp: resuelve la url del api y el primer token del
 * listado. Falla con un mensaje accionable en vez de dejar que el proceso
 * reviente a mitad de la conexión.
 */
export function loadEntryConfig(env: NodeJS.ProcessEnv): EntryConfig {
  const baseUrl = env.PARALLAX_API_URL ?? 'http://localhost:8080';
  const tokensRaw = env.PARALLAX_TOKENS;
  if (!tokensRaw) {
    throw new Error('PARALLAX_TOKENS is required (JSON array of {token, orgId, scopes})');
  }
  let tokens: Array<{ token: string }>;
  try {
    tokens = JSON.parse(tokensRaw) as Array<{ token: string }>;
  } catch {
    throw new Error('PARALLAX_TOKENS is not valid JSON');
  }
  const first = tokens[0];
  if (!first) {
    throw new Error('PARALLAX_TOKENS must contain at least one token');
  }
  return { baseUrl, token: first.token };
}
