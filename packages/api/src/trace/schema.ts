// El trazado de punta a punta: cómo un valor viaja desde el dato hasta donde termina,
// cruzando repos. El modelo propone los SALTOS (hops: lugares del código) y cómo se
// ENLAZAN; el servidor comprueba cada lugar leyendo el código y decide, con hechos del
// motor, qué enlaces están confirmados. El modelo NO afirma qué está confirmado.

import { z } from 'zod';

/** Carril: en qué parte del recorrido está un salto. De izquierda a derecha en la vista. */
export const LANES = [
  'data',
  'data_access',
  'domain',
  'api_handler',
  'contract',
  'client_call',
  'client_logic',
  'sink',
] as const;
export type Lane = (typeof LANES)[number];

export const LANE_LABEL: Record<Lane, string> = {
  data: 'Data',
  data_access: 'Data access',
  domain: 'Domain logic',
  api_handler: 'API handler',
  contract: 'Contract',
  client_call: 'Client call',
  client_logic: 'Client logic',
  sink: 'Where it ends',
};

export const RELATIONS = [
  'reads',
  'writes',
  'calls',
  'returns',
  'serves',
  'consumes',
  'passes',
  'stores',
  'renders',
  'other',
] as const;
export type Relation = (typeof RELATIONS)[number];

export const SINK_KINDS = [
  'rendered',
  'stored',
  'sent',
  'discarded',
  'returned',
  'unknown',
] as const;

const Hop = z
  .object({
    /** Identificador corto propio de este trazado ("h1", "h2"…). */
    id: z.string().min(1).max(12),
    lane: z.enum(LANES),
    /** Qué es, en pocas palabras ("resolver de products", "hook useProductListQuery"). */
    label: z.string().min(1).max(90),
    repo: z.string().min(1),
    /** Ruta tal cual la imprimió la herramienta. */
    path: z.string().min(1),
    line: z.number().int().min(1),
    /** UN identificador (función, clase, variable) que está literalmente en o cerca de esa línea. */
    contains: z
      .string()
      .regex(
        /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/,
        'a single identifier: letters, digits, _ and dots; no spaces, quotes or call syntax',
      )
      .max(120),
    /** Ids de evidencia del motor para este lugar, si los hay. */
    evidence: z.array(z.string()).optional(),
  })
  .strict();

const Link = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    relation: z.enum(RELATIONS),
    /** Una frase: cómo se pasa el valor de uno a otro. */
    note: z.string().max(160).optional(),
  })
  .strict();

const Gap = z
  .object({
    /** Después de qué salto se pierde el rastro. */
    after: z.string().min(1),
    reason: z.string().min(1).max(200),
  })
  .strict();

const Sink = z
  .object({
    hop: z.string().min(1),
    kind: z.enum(SINK_KINDS),
    note: z.string().max(200).optional(),
  })
  .strict();

export const SubmitTraceArgs = z
  .object({
    summary: z.string().min(1).max(600),
    hops: z.array(Hop).min(1).max(16),
    links: z.array(Link).max(24),
    gaps: z.array(Gap).max(8).optional(),
    sink: Sink.optional(),
  })
  .strict();
export type SubmitTraceArgs = z.infer<typeof SubmitTraceArgs>;
export type TraceHop = z.infer<typeof Hop>;
export type TraceLink = z.infer<typeof Link>;

/** Cómo se sabe que algo es cierto. */
/** De dónde sale un salto: lo registró el motor, o lo propuso el modelo y se leyó. */
export type HopOrigin = 'engine' | 'model';

export type Basis =
  /** Un hecho del motor lo respalda (enlace de llamada, vínculo cliente → contrato). */
  | 'engine'
  /** Lo afirma el modelo tras leer el código; ningún hecho del motor lo confirma ni lo refuta. */
  | 'asserted'
  /** El motor buscó y no encontró el enlace (su grafo de llamadas no ve despacho dinámico). */
  | 'not_found';

export type HopStatus = 'verified' | 'contradicted' | 'unverifiable';

export interface VerifiedHop extends TraceHop {
  status: HopStatus;
  reason: string;
  origin: HopOrigin;
}

export interface VerifiedLink extends TraceLink {
  basis: Basis;
  /** Qué hecho del motor lo respalda (o por qué no se pudo confirmar). */
  because: string;
}

export interface TraceResult {
  seed: { key: string; service: string };
  summary: string;
  hops: VerifiedHop[];
  /** Saltos que propuso el modelo y el motor NO encontró en el código: no forman parte del recorrido. */
  rejected: VerifiedHop[];
  links: VerifiedLink[];
  gaps: Array<{ after: string; reason: string }>;
  sink: { hop: string; kind: (typeof SINK_KINDS)[number]; note?: string | undefined } | null;
  /** Un trazado cuyo final no se alcanzó dice por qué. */
  complete: boolean;
  status: 'available' | `failed:${string}`;
  usage: {
    modelCalls: number;
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    ms: number;
  };
  errors: string[];
}

export interface TraceSeed {
  key: string;
  service: string;
  repo: string | null;
  /** Dónde el motor dice que se define el contrato (p. ej. el SDL). */
  providers: Array<{ repo?: string; path?: string; line?: number }>;
  consumers: Array<{
    service: string;
    uses: number;
    provenance: 'deterministic' | 'inferred';
    fields: string[];
    sites: Array<{ repo?: string; path: string; line?: number }>;
  }>;
}

const IDENT = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/;
const cut = (v: unknown, n: number): unknown => (typeof v === 'string' ? v.trim().slice(0, n) : v);
const pick = <T extends Record<string, unknown>>(o: unknown, keys: readonly string[]): T =>
  Object.fromEntries(
    keys
      .filter((k) => (o as Record<string, unknown>)?.[k] !== undefined)
      .map((k) => [k, (o as Record<string, unknown>)[k]]),
  ) as T;

/**
 * Se es liberal con lo que se acepta y estricto con lo que se muestra: un trazado
 * bueno no se tira por un resumen de 640 caracteres o un `contains` con comillas.
 * Se recorta lo largo, se toma el primer identificador de `contains` y se descartan
 * claves desconocidas. Lo que sigue sin cumplir el esquema se rechaza igual.
 */
export function sanitizeTraceArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
  return {
    summary: cut(r.summary, 600),
    hops: arr(r.hops, 16).map((h) => {
      const o = pick<Record<string, unknown>>(h, [
        'id',
        'lane',
        'label',
        'repo',
        'path',
        'line',
        'contains',
        'evidence',
      ]);
      if (typeof o.contains === 'string') o.contains = IDENT.exec(o.contains)?.[0] ?? o.contains;
      if (typeof o.line === 'string' && /^\d+$/.test(o.line)) o.line = Number(o.line);
      o.label = cut(o.label, 90);
      o.id = cut(o.id, 12);
      return o;
    }),
    links: arr(r.links, 24).map((l) => {
      const o = pick<Record<string, unknown>>(l, ['from', 'to', 'relation', 'note']);
      if (o.note !== undefined) o.note = cut(o.note, 160);
      return o;
    }),
    ...(r.gaps !== undefined
      ? {
          gaps: arr(r.gaps, 8).map((g) => ({
            ...pick(g, ['after', 'reason']),
            reason: cut((g as { reason?: unknown })?.reason, 200),
          })),
        }
      : {}),
    ...(r.sink !== undefined && r.sink !== null
      ? {
          sink: {
            ...pick(r.sink, ['hop', 'kind', 'note']),
            note: cut((r.sink as { note?: unknown }).note, 200),
          },
        }
      : {}),
  };
}
