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
  // Credencial de Nebius Token Factory (NEBIUS_TOKEN): es del proveedor, no del
  // modelo, que es configurable.
  nebiusToken: z.string().optional(),
  // Endpoint y modelos del investigador (§14): configurables porque el modelo
  // efectivo es una condición experimental, no una constante del código. Los
  // defaults viven en investigatorSettings() para no romper AppConfig en tests.
  nemotronBaseUrl: z.string().url().optional(),
  nemotronPlannerModel: z.string().min(1).optional(),
  nemotronWorkerModel: z.string().min(1).optional(),
  // Presupuesto de investigación (§6): 16 llamadas (eran 8) y 120 s de modelo
  // por consulta, medidos y reportados en la demo.
  investigatorMaxToolCalls: z.coerce.number().int().min(1).max(50).optional(),
  investigatorMaxModelMs: z.coerce.number().int().min(1000).optional(),
  // Tope de preguntas al investigador por token y hora (0 o ausente = sin tope).
  // Para demos públicas: cada pregunta consume créditos de Token Factory.
  queryRateLimitPerHour: z.coerce.number().int().min(0).optional(),
  webBundlePath: z.string().default('./packages/web/dist'),
  // Lectura de PRs de GitHub (selector y auto CI). Sólo GET: el token de escritura
  // (estado y comentarios) es otra credencial, que nunca usa el lector.
  githubReadToken: z.string().min(1).optional(),
  // Base de la API de GitHub: configurable para que los tests apunten a un stand-in local.
  githubApiBase: z.string().url().optional(),
  // Escritura a GitHub (commit status y comentarios): credencial aparte, sólo
  // `Commit statuses: write` y `Issues: write`. La lee únicamente GitHubWriter.
  githubWriteToken: z.string().min(1).optional(),
  // Secreto HMAC de los webhooks de pull_request. Sin él no se acepta ningún webhook.
  githubWebhookSecret: z.string().min(1).optional(),
  // URL pública de Parallax, para enlazar el informe desde el estado y el comentario.
  publicUrl: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AuthToken = z.infer<typeof AuthToken>;

// §6: valores iniciales del presupuesto y §14: endpoint/modelos configurables.
export const INVESTIGATOR_DEFAULTS = {
  nemotronBaseUrl: 'https://api.tokenfactory.nebius.com/v1',
  nemotronPlannerModel: 'nvidia/nemotron-3-super-120b-a12b',
  nemotronWorkerModel: 'nvidia/Nemotron-3_5-Lightning',
  investigatorMaxToolCalls: 16,
  investigatorMaxModelMs: 120_000,
} as const;

export function investigatorSettings(
  cfg: Pick<
    AppConfig,
    | 'nemotronBaseUrl'
    | 'nemotronPlannerModel'
    | 'nemotronWorkerModel'
    | 'investigatorMaxToolCalls'
    | 'investigatorMaxModelMs'
  >,
): {
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

// Un valor vacío en el .env (`NEBIUS_TOKEN=`) es "sin configurar", no un token.
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * ÚNICO lugar que lee las variables del modelo (credencial, endpoint, modelos).
 * `loadConfig` y los gates pasan por aquí; ninguno lee `process.env` por su
 * cuenta ni con otro nombre.
 */
export function modelEnv(
  env: NodeJS.ProcessEnv,
): Pick<
  AppConfig,
  'nebiusToken' | 'nemotronBaseUrl' | 'nemotronPlannerModel' | 'nemotronWorkerModel'
> {
  // NEMOTRON_TOKEN fue el nombre anterior. Aceptarlo en silencio mantendría dos
  // fuentes de verdad; ignorarlo en silencio apagaría el modelo sin decir por qué.
  if (nonEmpty(env.NEMOTRON_TOKEN) !== undefined) {
    throw new Error('NEMOTRON_TOKEN was renamed to NEBIUS_TOKEN: set NEBIUS_TOKEN and remove it');
  }
  return {
    nebiusToken: nonEmpty(env.NEBIUS_TOKEN),
    nemotronBaseUrl: env.NEMOTRON_BASE_URL,
    nemotronPlannerModel: env.NEMOTRON_PLANNER_MODEL,
    nemotronWorkerModel: env.NEMOTRON_WORKER_MODEL,
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
    ...modelEnv(env),
    investigatorMaxToolCalls: env.INVESTIGATOR_MAX_TOOL_CALLS,
    investigatorMaxModelMs: env.INVESTIGATOR_MAX_MODEL_MS,
    queryRateLimitPerHour: env.QUERY_RATE_LIMIT_PER_HOUR,
    webBundlePath: env.WEB_BUNDLE_PATH,
    githubReadToken: env.PARALLAX_GITHUB_READ_TOKEN,
    githubApiBase: env.PARALLAX_GITHUB_API_BASE,
    githubWriteToken: env.PARALLAX_GITHUB_WRITE_TOKEN,
    githubWebhookSecret: env.PARALLAX_GITHUB_WEBHOOK_SECRET,
    publicUrl: env.PARALLAX_PUBLIC_URL,
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
