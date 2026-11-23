// Lo que el propio motor ya contabiliza al medir la cobertura (`get_coverage`): hosts
// que clasificó como EXTERNOS (llamadas a algo fuera de la federación; no cuentan
// como sin resolver) y contratos sin esquema. Se normaliza aquí lo que el motor
// devuelve (una forma abierta) a lo que la interfaz muestra; lo que falte o venga con
// otra forma se omite, no se inventa.

export interface CoverageLedgerDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  /** El motor da la cobertura por completa. */
  complete: boolean | null;
  /** Hosts que el motor decidió que son externos, con cuántas llamadas. */
  external: Array<{ host: string; calls: number }>;
  /** Endpoints sin esquema: de ellos no se pueden mostrar los campos que se leen. */
  schemalessEndpoints: number;
  staleBindings: number;
  /** Por repo: lo que corrió y lo que el motor no pudo ver (get_coverage vivo, Lain >= 0.16). */
  repos: RepoLedger[];
  /** Por qué el motor no da la cobertura por completa: sólo cuentas que trae él mismo. */
  gaps: LedgerGaps;
}

export interface BlindSpot {
  /** Razón del motor, p. ej. OrmDynamicQuery o FrontendValueUnclassified. */
  reason: string;
  count: number;
  /** Directorios con más casos (si el motor los agrupa). */
  directories: Array<{ path: string; count: number }>;
}

export interface RepoLedger {
  repo: string;
  state: string;
  /** Texto de error del motor para este repo, si lo hay. */
  error: string | null;
  commit: string | null;
  languages: string[];
  /** Sensores que produjeron algo, con cuántos hallazgos (más primero). */
  sensors: Array<{ name: string; count: number }>;
  /** Archivos que el motor se saltó, por razón. */
  skips: Array<{ reason: string; count: number; samplePaths: string[] }>;
  blindSpots: BlindSpot[];
}

export interface LedgerGaps {
  unresolvedConsumers: number;
  ambiguous: number;
  unresolvedRefs: number;
  /** Llamadas cuya URL sale de una variable de entorno con valor por defecto. */
  urlDefaults: number;
  /** Total de sitios ciegos por razón, sumando todos los repos. */
  blindSpotSites: number;
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function topDirectories(v: unknown): Array<{ path: string; count: number }> {
  return Object.entries(obj(v))
    .flatMap(([path, count]) => (typeof count === 'number' ? [{ path, count }] : []))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 5);
}

function normalizeRepo(raw: unknown): RepoLedger[] {
  const o = obj(raw);
  const repo = str(o.repo);
  if (!repo) return [];
  const sensors = Object.entries(obj(o.sensors)).flatMap(([name, count]) =>
    typeof count === 'number' ? [{ name, count }] : [],
  );
  sensors.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const skips = arr(o.skips).flatMap((x) => {
    const e = obj(x);
    const reason = str(e.reason);
    return reason
      ? [
          {
            reason,
            count: num(e.count),
            samplePaths: arr(e.sample_paths)
              .filter((p): p is string => typeof p === 'string')
              .slice(0, 3),
          },
        ]
      : [];
  });
  const blindSpots = arr(o.unresolved).flatMap((x) => {
    const e = obj(x);
    const reason = str(e.reason);
    return reason
      ? [{ reason, count: num(e.count), directories: topDirectories(obj(e.locations).directories) }]
      : [];
  });
  blindSpots.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return [
    {
      repo,
      state: str(o.state) ?? 'unknown',
      error: str(o.error),
      commit: str(o.commit),
      languages: arr(o.languages).filter((l): l is string => typeof l === 'string'),
      sensors,
      skips,
      blindSpots,
    },
  ];
}

export function normalizeLedger(raw: unknown): Omit<CoverageLedgerDto, 'source' | 'error'> {
  const r = obj(raw);
  const repos = arr(r.repos).flatMap(normalizeRepo);
  const external = (Array.isArray(r.external) ? r.external : []).flatMap((e) => {
    const o = obj(e);
    return typeof o.host === 'string' && typeof o.calls === 'number'
      ? [{ host: o.host, calls: o.calls }]
      : [];
  });
  external.sort((a, b) => b.calls - a.calls || a.host.localeCompare(b.host));
  return {
    complete: typeof r.complete === 'boolean' ? r.complete : null,
    external,
    schemalessEndpoints: Array.isArray(r.schemaless_endpoints) ? r.schemaless_endpoints.length : 0,
    staleBindings: typeof r.stale_bindings === 'number' ? r.stale_bindings : 0,
    repos,
    gaps: {
      unresolvedConsumers: arr(r.unresolved_consumers).length,
      ambiguous: arr(r.ambiguous).length,
      unresolvedRefs: arr(r.unresolved_refs).length,
      urlDefaults: arr(r.url_defaults).length,
      blindSpotSites: repos.reduce((n, x) => n + x.blindSpots.reduce((m, b) => m + b.count, 0), 0),
    },
  };
}
