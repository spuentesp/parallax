import type { ApplyContractContextArgs } from '@parallax/shared/lain';

export type BindingDecl = NonNullable<ApplyContractContextArgs['bindings']>[number];

/**
 * Una declaración que el motor aceptaría y que arreglaría un cabo suelto.
 * `basis` dice QUIÉN lo respalda: el motor (check_binding / list_service_refs).
 * El modelo nunca valida: sólo explica (`rationale`) y, entre candidatos que el
 * motor YA aceptó, ayuda a elegir. Un texto del modelo va rotulado como tal.
 */
export interface Recommendation {
  id: string;
  kind: 'binding';
  title: string;
  site: { repo: string; path: string; line: number | null } | null;
  declaration: BindingDecl;
  basis: 'engine_verified';
  basisDetail: string;
  /**
   * Una advertencia sobre la propuesta aun cuando el motor la acepta (p. ej. una ruta
   * comodín que casa con casi cualquier llamada). Con advertencia no se preselecciona.
   */
  caution: string | null;
  /** Otros candidatos que el motor también acepta para el mismo sitio (sólo bindings). */
  alternatives: Array<{ key: string; service: string }>;
  /** Lectura del modelo sobre el código: un juicio, no un hecho del motor. */
  rationale: string | null;
  /** El modelo eligió esta entre varias que el motor aceptaba. */
  modelPicked: boolean;
}

export interface RecommendationsDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  recommendations: Recommendation[];
  /** Lo que se miró y no produjo recomendación, y por qué. */
  skipped: Array<{ reason: string; count: number }>;
  model: { used: boolean; name: string | null; note: string | null };
}
