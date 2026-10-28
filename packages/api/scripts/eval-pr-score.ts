// Puntuación MECÁNICA de una explicación de PR contra lo que el motor reportó.
// Sin modelo juez: todo son comprobaciones sobre engine_json y sobre el texto.

export interface EngineChange {
  kind?: string;
  endpoint?: { key?: string; service?: string };
  impact?: { class?: string };
  affected?: Array<{ service?: string; class?: string }>;
}

export interface ScoreInput {
  changes: EngineChange[];
  narrative: string;
  status: string;
  /** Claves "MÉTODO /ruta" que existen en la vista base o head (contratos). */
  knownRoutes: ReadonlySet<string>;
  coverageIncomplete: boolean;
  classConflicts: number;
  toolCalls: number;
  /**
   * Modo PR: por cada cambio (mismo orden que `changes`), si el modelo lo explicó.
   * Si se da, sustituye a la búsqueda de menciones: la narrativa compuesta por el
   * backend nombra todos los hallazgos aunque el modelo se saltara alguno.
   */
  explained?: readonly boolean[];
}

export interface Score {
  pass: boolean;
  status: string;
  findings: number;
  addressed: number;
  missing: string[];
  invented: string[];
  verifiedConsumerNamed: boolean | null;
  coverageGapStated: boolean | null;
  classConflicts: number;
  toolCalls: number;
}

// Los nombres de parámetro no son parte del contrato: {order_id} == {}. El
// modelo además escribe guiones y llaves tipográficos.
export function normalizeText(text: string): string {
  return text.replace(/[‐-―−]/g, '-').replace(/\{[^}]*\}/g, '{}');
}

export function routeOf(key: string): { method: string; path: string } | null {
  const m = key.match(/^http:([A-Z]+)\s+(\S+)$/);
  return m ? { method: m[1] as string, path: normalizeText(m[2] as string) } : null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "/orders" no cuenta como mención de "/orders/bulk": la ruta debe terminar ahí.
export function mentionsRoute(narrative: string, path: string): boolean {
  return new RegExp(`${escapeRe(path)}(?![\\w/{}-])`).test(normalizeText(narrative));
}

export function routesIn(narrative: string): string[] {
  const out = new Set<string>();
  for (const m of normalizeText(narrative).matchAll(
    /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/{}.-]*[\w/{}])/g,
  )) {
    out.add(`${m[1]} ${m[2]}`);
  }
  return [...out];
}

const GAP_WORDS =
  /(incomplete|not (fully )?(complete|covered|reviewed)|coverage|unreviewed|partial|cannot (be )?(confirm|verif)|could not (be )?(confirm|verif)|unknown|heuristic|unresolved)/i;

export function scoreExplanation(input: ScoreInput): Score {
  const findings = input.changes.filter((c) => c.endpoint?.key && routeOf(c.endpoint.key));
  const missing: string[] = [];
  if (input.explained) {
    input.changes.forEach((c, i) => {
      if (input.explained?.[i] !== true) missing.push(`${c.kind ?? 'change'} ${c.endpoint?.key ?? '?'}`);
    });
  } else {
    for (const c of findings) {
      const route = routeOf(c.endpoint?.key as string);
      if (route && !mentionsRoute(input.narrative, route.path)) {
        missing.push(`${c.kind ?? 'change'} ${c.endpoint?.key}`);
      }
    }
  }
  const invented = routesIn(input.narrative).filter((r) => !input.knownRoutes.has(r));

  const verified = input.changes.filter((c) => c.impact?.class === 'Verified');
  const verifiedServices = [
    ...new Set(verified.flatMap((c) => (c.affected ?? []).map((a) => a.service ?? ''))),
  ].filter(Boolean);
  const verifiedConsumerNamed =
    verified.length === 0
      ? null
      : verifiedServices.some((s) => input.narrative.toLowerCase().includes(s.toLowerCase()));

  const coverageGapStated = input.coverageIncomplete ? GAP_WORDS.test(input.narrative) : null;

  const pass =
    input.status === 'available' &&
    missing.length === 0 &&
    invented.length === 0 &&
    input.classConflicts === 0 &&
    verifiedConsumerNamed !== false &&
    coverageGapStated !== false;

  return {
    pass,
    status: input.status,
    findings: input.explained ? input.changes.length : findings.length,
    addressed: (input.explained ? input.changes.length : findings.length) - missing.length,
    missing,
    invented,
    verifiedConsumerNamed,
    coverageGapStated,
    classConflicts: input.classConflicts,
    toolCalls: input.toolCalls,
  };
}
