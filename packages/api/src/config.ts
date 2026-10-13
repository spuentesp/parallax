import { z } from 'zod';

const AuthToken = z.object({
  token: z.string().min(1),
  orgId: z.string().min(1),
  scopes: z.array(z.enum(['read', 'write', 'publish'])).min(1),
});

const AppConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  databasePath: z.string().min(1).default('./data/parallax.db'),
  lainAdapter: z.enum(['mock', 'real']).default('mock'),
  lainUrl: z.string().url().optional(),
  mcpTransport: z.enum(['stdio', 'http-sse']).default('stdio'),
  authTokens: z.array(AuthToken).min(1),
  nemotronToken: z.string().optional(),
  webBundlePath: z.string().default('./packages/web/dist'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AuthToken = z.infer<typeof AuthToken>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const tokensRaw = env.PARALLAX_TOKENS;
  if (!tokensRaw) {
    throw new Error('PARALLAX_TOKENS is required (JSON array of {token, orgId, scopes})');
  }
  let authTokens: unknown;
  try {
    authTokens = JSON.parse(tokensRaw);
  } catch {
    throw new Error('PARALLAX_TOKENS is not valid JSON');
  }

  const parsed = AppConfigSchema.safeParse({
    port: env.PORT,
    databasePath: env.DATABASE_PATH,
    lainAdapter: env.LAIN_ADAPTER,
    lainUrl: env.LAIN_URL,
    mcpTransport: env.PARALLAX_MCP_TRANSPORT,
    authTokens,
    nemotronToken: env.NEMOTRON_TOKEN ?? env.NEBIUS_TOKEN,
    webBundlePath: env.WEB_BUNDLE_PATH,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid config: ${issues}`);
  }
  if (parsed.data.lainAdapter === 'real' && !parsed.data.lainUrl) {
    throw new Error('LAIN_URL is required when LAIN_ADAPTER=real');
  }
  return parsed.data;
}
