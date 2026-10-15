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
  // Endpoint y modelos del investigador (§14): configurables porque el modelo
  // efectivo es una condición experimental, no una constante del código. Los
  // defaults viven en investigatorSettings() para no romper AppConfig en tests.
  nemotronBaseUrl: z.string().url().optional(),
  nemotronPlannerModel: z.string().min(1).optional(),
  nemotronWorkerModel: z.string().min(1).optional(),
  // Presupuesto de investigación (§6): ocho llamadas y 120 s de modelo por
  // consulta, medidos y reportados en la demo.
  investigatorMaxToolCalls: z.coerce.number().int().min(1).max(50).optional(),
  investigatorMaxModelMs: z.coerce.number().int().min(1000).optional(),
  webBundlePath: z.string().default('./packages/web/dist'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AuthToken = z.infer<typeof AuthToken>;

// §6: valores iniciales del presupuesto y §14: endpoint/modelos configurables.
export const INVESTIGATOR_DEFAULTS = {
  nemotronBaseUrl: 'https://api.tokenfactory.nebius.com/v1',
  nemotronPlannerModel: 'nvidia/nemotron-3-super-120b-a12b',
  nemotronWorkerModel: 'nvidia/Nemotron-3_5-Lightning',
  investigatorMaxToolCalls: 8,
  investigatorMaxModelMs: 120_000,
} as const;

export function investigatorSettings(cfg: AppConfig): {
  baseUrl: string;
  plannerModel: string;
  workerModel: string;
  maxToolCalls: number;
  maxModelMs: number;
} {
  return {
    baseUrl: cfg.nemotronBaseUrl ?? INVESTIGATOR_DEFAULTS.nemotronBaseUrl,
    plannerModel: cfg.nemotronPlannerModel ?? INVESTIGATOR_DEFAULTS.nemotronPlannerModel,
    workerModel: cfg.nemotronWorkerModel ?? INVESTIGATOR_DEFAULTS.nemotronWorkerModel,
    maxToolCalls: cfg.investigatorMaxToolCalls ?? INVESTIGATOR_DEFAULTS.investigatorMaxToolCalls,
    maxModelMs: cfg.investigatorMaxModelMs ?? INVESTIGATOR_DEFAULTS.investigatorMaxModelMs,
  };
}

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
    nemotronBaseUrl: env.NEMOTRON_BASE_URL,
    nemotronPlannerModel: env.NEMOTRON_PLANNER_MODEL,
    nemotronWorkerModel: env.NEMOTRON_WORKER_MODEL,
    investigatorMaxToolCalls: env.INVESTIGATOR_MAX_TOOL_CALLS,
    investigatorMaxModelMs: env.INVESTIGATOR_MAX_MODEL_MS,
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
