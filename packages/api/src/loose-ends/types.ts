// "Cabos sueltos": lo que el motor NO pudo atar (llamadas sin resolver) y lo que
// ató sólo por heurística (relaciones inferidas). Cada uno lleva el lugar exacto
// del código. El motor los declara; este módulo ayuda a entender QUÉ son.

export type LooseEndKind = 'unresolved' | 'inferred';

export interface LooseEnd {
  /** Estable entre ejecuciones: mismo sitio + misma causa = misma clave. */
  key: string;
  kind: LooseEndKind;
  repo: string;
  path: string;
  line: number | null;
  /** Por qué es un cabo suelto, tal como lo dice el motor (graphql_no_op, dynamic_topic, unbound_host…). */
  reason: string;
  detail: {
    method?: string;
    host?: string;
    template?: string;
    urlExpr?: string;
    /** A qué servicio se atribuyó (relaciones inferidas) o se intentó (sin resolver). */
    targetService?: string;
    endpoint?: string;
    confidence?: number;
  };
  /** Endpoints que el motor consideró (hasta 3) sin poder elegir. */
  candidates: string[];
  /** Cuántos candidatos había en total. */
  candidateCount: number;
}

/** Qué es un cabo suelto, según quién lo dice. */
export const CATEGORIES = [
  'test_or_tooling',
  'external_call',
  'dynamic_target',
  'likely_real_link',
  'not_a_call',
  'unclear',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  test_or_tooling: 'Test or tooling code',
  external_call: 'Call to something outside the workspace',
  dynamic_target: 'Target built at runtime',
  likely_real_link: 'Probably a real link the engine missed',
  not_a_call: 'Not a call (false positive)',
  unclear: 'Unclear',
};

export interface Assessment {
  category: Category;
  reason: string;
  /** `ruta:línea` en la que se apoya el veredicto. */
  evidence: string | null;
  /** rule = regla exacta (la ruta o el motivo del motor lo deciden; sin modelo); model = juicio de Nemotron leyendo el código. */
  source: 'rule' | 'model';
  model?: string | null;
  /** El modelo no dio un veredicto utilizable (no respondió, formato roto, citó otro sitio): no se guarda, se reintenta. */
  invalid?: boolean;
}
