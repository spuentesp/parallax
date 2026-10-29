// GitHubAdapter — SOLO LECTURA, dry run permanente.
//
// El objetivo es poder decir "esto es lo que se comentaría", no comentarlo.
// Por eso esta clase no tiene ni un método de escritura: no publica, no
// comenta, no crea PRs. Quien necesite enviar algo a GitHub escribe otra
// pieza aparte, y eso nunca será este adapter.
//
// Lee la API pública de GitHub, sin token: una URL de PR se resuelve a
// repositorio, base, head y alcance antes de iniciar nada (§2).

export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface PrSummary {
  readonly ref: PrRef;
  readonly url: string;
  readonly title: string;
  readonly author: string | null;
  readonly state: string;
  readonly baseRef: string;
  readonly headRef: string;
  /** SHAs resueltos: son la identidad persistente (§5). Un nombre de rama no sirve. */
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergedAt: string | null;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly files: PrFile[];
}

export interface PrFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

export class PrUrlError extends Error {
  readonly code: 'invalid_url' | 'not_found' | 'http_error' | 'rate_limited';
  constructor(code: PrUrlError['code'], message: string) {
    super(message);
    this.name = 'PrUrlError';
    this.code = code;
  }
}

const PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** Parsea una URL de PR de GitHub. No hace red. */
export function parsePrUrl(url: string): PrRef {
  const m = PR_URL.exec(url.trim());
  if (!m) {
    throw new PrUrlError(
      'invalid_url',
      `expected https://github.com/<owner>/<repo>/pull/<n>, got: ${url}`,
    );
  }
  return {
    owner: m[1] ?? '',
    repo: (m[2] ?? '').replace(/\.git$/, ''),
    number: Number(m[3]),
  };
}

/**
 * Owner y repo de una URI de repo de GitHub (`https://github.com/o/r[.git]`,
 * `github.com/o/r`). Cualquier otra cosa (rutas locales, otros hosts) devuelve
 * null: no hay PRs que listar. No hace red.
 */
export function parseGithubRepoUri(uri: string): { owner: string; repo: string } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/.exec(
    uri.trim(),
  );
  if (!m) return null;
  return { owner: m[1] ?? '', repo: m[2] ?? '' };
}

/** Un PR abierto, tal como lo muestra el selector. Los SHAs son la identidad (§5). */
export interface OpenPrItem {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly author: string | null;
  readonly draft: boolean;
  readonly baseRef: string;
  readonly headRef: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly updatedAt: string;
}

export interface GitHubReadConfig {
  readonly apiBase?: string;
  readonly timeoutMs?: number;
  /** Opcional: sólo sube el límite de peticiones. Nunca se usa para escribir. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

interface GhFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

interface GhPr {
  number?: number;
  html_url?: string;
  title?: string;
  state?: string;
  draft?: boolean;
  updated_at?: string;
  merged_at?: string | null;
  user?: { login?: string };
  base?: { ref?: string; sha?: string };
  head?: { ref?: string; sha?: string };
}

/**
 * Lector de PRs. Todas las operaciones son GET: no hay forma de escribir a
 * GitHub desde esta clase.
 */
export class GitHubReader {
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: GitHubReadConfig = {}) {
    this.apiBase = (cfg.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.token = cfg.token;
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async get<T>(path: string): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'parallax-dry-run',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        signal: ctl.signal,
      });
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new PrUrlError('rate_limited', `GitHub API rate limit exceeded on ${path}`);
      }
      if (res.status === 404) throw new PrUrlError('not_found', `not found: ${path}`);
      if (!res.ok) {
        throw new PrUrlError('http_error', `GitHub returned HTTP ${res.status} for ${path}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resuelve una URL de PR a su identidad persistente y su alcance. Solo lectura. */
  async fetchPr(url: string): Promise<PrSummary> {
    const ref = parsePrUrl(url);
    const pr = await this.get<GhPr>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
    const files = await this.get<GhFile[]>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
    );

    const baseSha = pr.base?.sha ?? '';
    const headSha = pr.head?.sha ?? '';
    if (!baseSha || !headSha) {
      throw new PrUrlError(
        'http_error',
        'GitHub returned the PR without base/head SHAs; a branch name is not an identity (§5)',
      );
    }

    return {
      ref,
      url: pr.html_url ?? url,
      title: pr.title ?? '',
      author: pr.user?.login ?? null,
      state: pr.state ?? 'unknown',
      baseRef: pr.base?.ref ?? '',
      headRef: pr.head?.ref ?? '',
      baseSha,
      headSha,
      mergedAt: pr.merged_at ?? null,
      changedFiles: files.length,
      additions: files.reduce((a, f) => a + (f.additions ?? 0), 0),
      deletions: files.reduce((a, f) => a + (f.deletions ?? 0), 0),
      files: files.map((f) => ({
        path: f.filename ?? '',
        status: f.status ?? 'modified',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })),
    };
  }

  /**
   * PRs abiertos de un repo, más recientes primero. Una página (100): el selector
   * no pagina, y un repo con más de 100 PRs abiertos lo declara en vez de
   * truncarlo en silencio. Sólo lectura.
   */
  async listOpenPrs(
    owner: string,
    repo: string,
  ): Promise<{ items: OpenPrItem[]; truncated: boolean }> {
    const prs = await this.get<GhPr[]>(
      `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    );
    const truncated = prs.length === 100;
    const items: OpenPrItem[] = [];
    for (const pr of prs) {
      const baseSha = pr.base?.sha ?? '';
      const headSha = pr.head?.sha ?? '';
      // Un PR sin SHAs no tiene identidad: se omite antes que inventarla.
      if (!pr.number || !baseSha || !headSha) continue;
      items.push({
        number: pr.number,
        url: pr.html_url ?? `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        title: pr.title ?? '',
        author: pr.user?.login ?? null,
        draft: pr.draft ?? false,
        baseRef: pr.base?.ref ?? '',
        headRef: pr.head?.ref ?? '',
        baseSha,
        headSha,
        updatedAt: pr.updated_at ?? '',
      });
    }
    return { items, truncated };
  }
}

/**
 * EL lector de PRs de la aplicación: toda ruta que lea de GitHub lo crea aquí, con la misma
 * base de API y el mismo token de lectura. Antes el selector usaba el token y la evaluación
 * no, así que un PR privado aparecía en el selector y fallaba con 404 al evaluarlo.
 */
export function githubReaderFor(cfg: {
  githubApiBase?: string | undefined;
  githubReadToken?: string | undefined;
}): GitHubReader {
  return new GitHubReader({
    ...(cfg.githubApiBase ? { apiBase: cfg.githubApiBase } : {}),
    ...(cfg.githubReadToken ? { token: cfg.githubReadToken } : {}),
  });
}
