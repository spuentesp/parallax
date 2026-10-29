// Búsqueda web (Tavily) para preguntas técnicas y de orientación general: qué es una
// librería, cómo hace algo un framework. Sólo lee. Lo que devuelve se indexa en el mismo
// índice de documentación que los repos (repo "web", ruta = URL), así que una cita se
// comprueba con el mismo verificador `doc_quote`: la frase tiene que estar en lo que el
// modelo VIO. Los hechos de LAIN siguen mandando; la web explica, no sobrescribe.

export const WEB_REPO = 'web';
const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_CONTENT_CHARS = 1500;
const DEFAULT_LIMIT = 4;
const TIMEOUT_MS = 15_000;

export interface WebPage {
  title: string;
  url: string;
  /** Lo que se le enseña al modelo y lo que se indexa: son el mismo texto. */
  content: string;
  score: number;
  publishedDate: string | null;
  official: boolean;
}

export interface WebSearchOptions {
  /** Dominios a los que limitar (o preferir). Vacío = toda la web. */
  domains?: readonly string[];
  /** 'restrict' sólo esos dominios; 'prefer' los sube pero deja el resto. */
  /**
   * 'restrict' sólo esos dominios; 'prefer' los sube pero deja entrar blogs y vídeos por encima
   * (medido: con 'prefer' la documentación oficial quedaba por debajo de Medium y YouTube).
   */
  mode?: 'restrict' | 'prefer';
  limit?: number;
}

export type WebSearch = (query: string, opts?: WebSearchOptions) => Promise<WebPage[]>;

/** Palabra clave de una librería → sus dominios de documentación oficial. */
export type OfficialDocs = Readonly<Record<string, readonly string[]>>;

/**
 * La lista con la que se siembra cada workspace. Corta y a propósito: la fuente de verdad de un
 * workspace es su tabla `official_doc` (docs/official.ts), que cada uno amplía o recorta.
 */
export const DEFAULT_OFFICIAL_DOCS: OfficialDocs = {
  react: ['react.dev'],
  next: ['nextjs.org'],
  nextjs: ['nextjs.org'],
  typescript: ['typescriptlang.org'],
  node: ['nodejs.org'],
  nodejs: ['nodejs.org'],
  fastify: ['fastify.dev'],
  express: ['expressjs.com'],
  graphql: ['graphql.org'],
  apollo: ['apollographql.com'],
  django: ['docs.djangoproject.com'],
  celery: ['docs.celeryq.dev'],
  flask: ['flask.palletsprojects.com'],
  fastapi: ['fastapi.tiangolo.com'],
  sqlalchemy: ['docs.sqlalchemy.org'],
  pydantic: ['docs.pydantic.dev'],
  python: ['docs.python.org'],
  postgres: ['postgresql.org'],
  postgresql: ['postgresql.org'],
  sqlite: ['sqlite.org'],
  redis: ['redis.io'],
  kafka: ['kafka.apache.org'],
  rabbitmq: ['rabbitmq.com'],
  docker: ['docs.docker.com'],
  kubernetes: ['kubernetes.io'],
  terraform: ['developer.hashicorp.com'],
  stripe: ['docs.stripe.com'],
  tailwind: ['tailwindcss.com'],
  vite: ['vite.dev'],
  vitest: ['vitest.dev'],
  zod: ['zod.dev'],
  drizzle: ['orm.drizzle.team'],
  prisma: ['prisma.io'],
  oauth: ['oauth.net', 'datatracker.ietf.org'],
  jwt: ['jwt.io', 'datatracker.ietf.org'],
  openapi: ['spec.openapis.org', 'swagger.io'],
  grpc: ['grpc.io'],
  protobuf: ['protobuf.dev'],
  webhook: ['developer.mozilla.org'],
  http: ['developer.mozilla.org', 'datatracker.ietf.org'],
  css: ['developer.mozilla.org'],
  javascript: ['developer.mozilla.org'],
  rust: ['doc.rust-lang.org'],
  go: ['go.dev'],
  golang: ['go.dev'],
};

export function isOfficial(url: string, docs: OfficialDocs = DEFAULT_OFFICIAL_DOCS): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return Object.values(docs).some((domains) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`)),
  );
}

/** Dominios oficiales de las librerías que nombra la consulta; vacío si no nombra ninguna. */
export function officialDomainsFor(
  query: string,
  docs: OfficialDocs = DEFAULT_OFFICIAL_DOCS,
): string[] {
  const words = new Set(query.toLowerCase().match(/[a-z][a-z0-9.+#-]*/g) ?? []);
  const out = new Set<string>();
  for (const [word, domains] of Object.entries(docs)) {
    if (words.has(word)) for (const d of domains) out.add(d);
  }
  return [...out];
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /\S+@\S+\.\S+/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
// Rutas de archivo, refs de evidencia (repo@sha:path:line) y nombres con barra.
const PATHY =
  /\S*[/\\]\S*|\S+@[0-9a-f]{6,}\S*|\S+\.(?:py|ts|tsx|js|jsx|go|rs|java|rb|sql|ya?ml|json)\b/gi;

/**
 * La consulta sale a un tercero: se le quita lo que sólo existe dentro del workspace
 * (nombres de servicios y repos del catálogo, rutas, ids, correos, URLs). Queda el tema
 * técnico y los nombres públicos de librerías. Devuelve null si no queda nada que buscar.
 */
export function scrubQuery(query: string, privateNames: Iterable<string> = []): string | null {
  let q = query.replace(URL_RE, ' ').replace(EMAIL, ' ').replace(UUID, ' ').replace(PATHY, ' ');
  // Los nombres más largos primero: "saleor-api" antes que "saleor".
  const names = [...privateNames].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    q = q.replace(new RegExp(`(^|[^A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'gi'), '$1 ');
  }
  q = q.replace(/\s+/g, ' ').trim();
  return q.length >= 3 && /[a-z]{3,}/i.test(q) ? q : null;
}

const LOCALE =
  /\/(?:ar|bg|cs|da|de|el|es|fa|fi|fr|he|hi|hu|id|it|ja|ko|nl|no|pl|pt|pt-br|ro|ru|sk|sv|th|tr|uk|vi|zh|zh-cn|zh-hans|zh-hant|zh-tw)\//i;
// Código fuente renderizado, descargas y volcados: no explican nada.
const NOISE_PATH = /\/(?:_modules|_sources|_downloads|_\/downloads|_static)\/|\.(?:pdf|zip|epub)$/i;
// Notas de versión: pueden servir, pero nunca antes que la referencia.
const HISTORY_PATH =
  /\/(?:releases?|whatsnew|history|changelog|changes|news)\b|changelog|what-?s-?new/i;
const VERSION = /\/(?:en\/)?(v?\d+(?:\.\d+)*|stable|latest|main|master|current)(?=\/|$)/i;

function versionOf(url: string): { label: string; major: number | null; rest: string } | null {
  const m = VERSION.exec(url);
  if (!m) return null;
  const label = (m[1] as string).toLowerCase();
  const num = /^v?(\d+)/.exec(label);
  return {
    label,
    major: num ? Number(num[1]) : null,
    rest: url.slice((m.index ?? 0) + m[0].length),
  };
}

/**
 * Limpia lo que Tavily devuelve DENTRO de un dominio oficial: sin traducciones ni código
 * fuente renderizado, sin la misma página repetida por #ancla, y con las versiones viejas y las
 * notas de versión detrás de la referencia vigente. Nada se inventa: sólo se descarta y se reordena.
 */
export function cleanPages(pages: readonly WebPage[]): WebPage[] {
  const byUrl = new Map<string, WebPage>();
  for (const p of pages) {
    const url = p.url.split('#')[0] as string;
    if (LOCALE.test(url) || NOISE_PATH.test(url)) continue;
    const prior = byUrl.get(url);
    if (!prior || p.content.length > prior.content.length) byUrl.set(url, { ...p, url });
  }
  const kept = [...byUrl.values()];
  // La versión más alta que aparece por host: lo que quede más de una mayor por debajo es viejo.
  const maxMajor = new Map<string, number>();
  for (const p of kept) {
    const v = versionOf(p.url);
    if (v?.major == null) continue;
    const host = new URL(p.url).hostname;
    maxMajor.set(host, Math.max(maxMajor.get(host) ?? 0, v.major));
  }
  const stale = (p: WebPage): boolean => {
    const v = versionOf(p.url);
    if (v?.major == null) return false;
    return v.major < (maxMajor.get(new URL(p.url).hostname) ?? 0) - 1;
  };
  // La misma página en dos versiones: se queda con la vigente (stable/latest/main o la mayor).
  const rank = (p: WebPage): number => {
    const v = versionOf(p.url);
    if (!v) return 0;
    return v.major == null ? 1e9 : v.major;
  };
  const byPage = new Map<string, WebPage>();
  for (const p of kept) {
    const v = versionOf(p.url);
    const key = v ? `${new URL(p.url).hostname}\u0000${v.rest}` : p.url;
    const prior = byPage.get(key);
    if (!prior || rank(p) > rank(prior)) byPage.set(key, p);
  }
  const demoted = (p: WebPage): number => Number(stale(p)) * 2 + Number(HISTORY_PATH.test(p.url));
  return [...byPage.values()].sort(
    (a, b) =>
      Number(b.official) - Number(a.official) || demoted(a) - demoted(b) || b.score - a.score,
  );
}

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
}

export interface TavilyConfig {
  apiKey: string;
  baseUrl?: string;
  /** La lista de documentación oficial del workspace (por defecto, la de siembra). */
  officialDocs?: OfficialDocs;
  /** El transporte: los tests inyectan uno; en producción es `fetch`. */
  fetch?: typeof fetch;
}

/** Cliente de Tavily /search. Falla con un error claro; nunca devuelve "nada" en silencio. */
export function createTavilySearch(cfg: TavilyConfig): WebSearch {
  const doFetch = cfg.fetch ?? fetch;
  const url = cfg.baseUrl ?? TAVILY_URL;
  return async (query, opts = {}) => {
    const domains = opts.domains ?? [];
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, 8);
    const body = {
      query,
      // Dentro de un dominio oficial 'advanced' encuentra la página que 'basic' no (la
      // referencia de QuerySet de Django); en la web abierta 'basic' basta. 2 créditos vs 1.
      search_depth: domains.length > 0 && opts.mode === 'restrict' ? 'advanced' : 'basic',
      // Se piden de más: la limpieza descarta traducciones, versiones viejas y duplicados.
      max_results: Math.min(limit * 2, 12),
      include_answer: false,
      include_raw_content: false,
      include_published_date: true,
      ...(domains.length > 0
        ? { include_domains: domains, include_domains_mode: opts.mode ?? 'prefer' }
        : {}),
    };
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { results?: TavilyResult[] };
    const pages: WebPage[] = [];
    for (const r of json.results ?? []) {
      if (typeof r.url !== 'string' || typeof r.content !== 'string' || r.content.trim() === '')
        continue;
      const title = typeof r.title === 'string' && r.title.trim() !== '' ? r.title.trim() : r.url;
      pages.push({
        title: title.slice(0, 200),
        url: r.url,
        content: r.content.trim().slice(0, MAX_CONTENT_CHARS),
        score: typeof r.score === 'number' ? r.score : 0,
        publishedDate: typeof r.published_date === 'string' ? r.published_date : null,
        official: isOfficial(r.url, cfg.officialDocs),
      });
    }
    return cleanPages(pages).slice(0, limit);
  };
}
