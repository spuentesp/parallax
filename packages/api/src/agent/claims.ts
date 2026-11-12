// Afirmaciones verificables del investigador (docs/superpowers/specs/
// 2026-10-26-verifiable-claims-design.md). El modelo cierra con `submit_answer`:
// prosa para humanos + afirmaciones tipadas. El MOTOR adjudica las relaciones
// entre servicios; el modelo no decide ningún hecho (P INV 2). Una afirmación
// contradicha no invalida la respuesta: se señala (verdict + lo que dice el motor).

import { z } from 'zod';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { ToolSpec } from './nemotron.js';

export const SUBMIT_TOOL = 'submit_answer';

const RelationClaim = z
  .object({
    kind: z.literal('relation'),
    /** Servicio que consume (nombre del servicio o de su repo). */
    consumer: z.string().min(1),
    /** Servicio consumido. */
    provider: z.string().min(1),
    polarity: z.enum(['present', 'absent']),
    /** Opcional: el motor adjudica la relación con o sin ella. */
    evidence: z.array(z.string()).optional(),
  })
  .strict();

const NoteClaim = z
  .object({
    kind: z.literal('note'),
    text: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  })
  .strict();

/**
 * "Esto vive aquí": un lugar del código. El motor lee esas líneas y comprueba que
 * lo que se dice que hay ahí (`contains`) esté de verdad. Es lo que permite
 * verificar una respuesta sobre código, que no tiene ids de evidencia de contrato.
 */
const LocationClaim = z
  .object({
    kind: z.literal('location'),
    repo: z.string().min(1),
    path: z.string().min(1),
    line: z.number().int().min(1),
    /** Texto exacto (un símbolo, una operación) que debe aparecer en esa línea o muy cerca. */
    contains: z.string().min(1).max(200),
    /** Lo que la respuesta afirma que hay ahí, en una frase. */
    text: z.string().min(1),
    /** Ids de evidencia que el motor entregó para este lugar (p. ej. el ancla de una llamada GraphQL). */
    evidence: z.array(z.string()).optional(),
  })
  .strict();

/**
 * "Esto está escrito aquí": una frase literal de la documentación del repo.
 * El motor la comprueba contra la SECCIÓN indexada del checkout: la frase tiene
 * que aparecer literalmente en esa sección. Es más estricto que un lugar: un
 * `location` basta con que el texto esté a unas líneas; aquí tiene que estar en
 * la sección que la respuesta dice citar.
 */
const DocQuoteClaim = z
  .object({
    kind: z.literal('doc_quote'),
    repo: z.string().min(1),
    path: z.string().min(1),
    /** El título de la sección, tal como lo dio la pista ("Architecture › Decision"). */
    section: z.string().min(1).max(200),
    /** La frase literal copiada de esa sección. */
    quote: z.string().min(1).max(400),
    /** Lo que la respuesta afirma. */
    text: z.string().min(1),
  })
  .strict();

export const Claim = z.discriminatedUnion('kind', [
  RelationClaim,
  NoteClaim,
  LocationClaim,
  DocQuoteClaim,
]);
export type Claim = z.infer<typeof Claim>;

export const SubmitAnswerArgs = z
  .object({
    answer: z.string().min(1),
    claims: z.array(Claim).max(20).optional(),
  })
  .strict();
export type SubmitAnswerArgs = z.infer<typeof SubmitAnswerArgs>;

export const SUBMIT_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: SUBMIT_TOOL,
    description:
      'Finish the investigation. `answer` is the explanation for a human (markdown, cite evidence ids as [ev:<id>]). `claims` are the checkable statements behind it: a `relation` claim says a service consumes (polarity "present") or does not consume ("absent") another service and the engine will verify it; a `location` claim says WHERE code lives (repo, path, line, and `contains`: the exact symbol or text that must appear on or within a few lines of that line): the engine reads the lines back and verifies it, so use one for every file:line you state; a `doc_quote` claim says what the DOCUMENTATION says (repo, path, the `section` heading as it was given to you, and the `quote`: a phrase copied literally from that section): the engine checks the phrase against the indexed section of the checkout, so use it for every quote from a doc (a web_search result is cited the same way, with repo "web", path = its URL and section = its title); a `note` claim is any other statement and needs at least one evidence id. Only claim relations between services of the workspace map.',
    parameters: z.toJSONSchema(SubmitAnswerArgs) as Record<string, unknown>,
  },
};

export type ClaimVerdict =
  | 'verified'
  | 'contradicted'
  | 'unverifiable'
  | 'supported'
  | 'unsupported';

export interface ClaimEvidence {
  accepted: string[];
  /** Recibos de consulta (q:N) citados que existen en esta investigación. */
  receipts: string[];
  rejected: Array<{ ref: string; reason: string }>;
}

export interface ClaimResult {
  claim: Claim;
  verdict: ClaimVerdict;
  reason: string;
  /** Lo que el motor dice de la relación (sólo para `relation`). */
  engine?: { uses: number; endpoints: string[]; complete: boolean };
  /** Servicios del catálogo a los que se resolvieron consumer y provider (sólo `relation`). */
  resolved?: { consumer: string; provider: string };
  /**
   * Lo que el motor leyó DE VERDAD donde la afirmación no se sostiene (el texto
   * del archivo, la sección del doc). Es lo que se le devuelve al modelo para
   * que lo corrija en vez de repetirlo.
   */
  readback?: string;
  evidence: ClaimEvidence;
}

export interface ClaimsSummary {
  total: number;
  verified: number;
  contradicted: number;
  unverifiable: number;
  supported: number;
  unsupported: number;
}

export function summarizeClaims(results: readonly ClaimResult[]): ClaimsSummary {
  const count = (v: ClaimVerdict): number => results.filter((r) => r.verdict === v).length;
  return {
    total: results.length,
    verified: count('verified'),
    contradicted: count('contradicted'),
    unverifiable: count('unverifiable'),
    supported: count('supported'),
    unsupported: count('unsupported'),
  };
}

export interface ClaimVerifierDeps {
  lain: LainAdapter;
  view: string;
  /** Resuelve un nombre de servicio (o el de su repo) al servicio del catálogo. */
  resolveService: (name: string) => Promise<{ service: string; repo: string } | null>;
  /** Valida refs de evidencia contra lo que el backend entregó (INV 1). */
  validateRefs: (refs: string[]) => Promise<ClaimEvidence>;
  /** ¿Es un repo de la vista analizada? (un lugar fuera de ella no se juzga). */
  hasRepo?: (name: string) => Promise<boolean>;
  /**
   * Las secciones de un documento del índice local, por su título. Sin esto no
   * hay índice de documentación y una cita de un doc no se puede comprobar.
   */
  docSection?: (
    repo: string,
    path: string,
    section: string,
  ) => {
    fileFound: boolean;
    sections: Array<{ heading: string; body: string; lineStart: number }>;
    headings: string[];
  } | null;
}

const NO_EVIDENCE: ClaimEvidence = { accepted: [], receipts: [], rejected: [] };

function unreviewedRepos(scope: unknown): string[] {
  const list = (scope as { unreviewed?: unknown } | undefined)?.unreviewed;
  if (!Array.isArray(list)) return [];
  return list.map((entry) =>
    typeof entry === 'string' ? entry : String((entry as { repo?: unknown })?.repo ?? ''),
  );
}

async function verifyRelation(
  claim: Extract<Claim, { kind: 'relation' }>,
  deps: ClaimVerifierDeps,
  evidence: ClaimEvidence,
): Promise<ClaimResult> {
  const consumer = await deps.resolveService(claim.consumer);
  const provider = await deps.resolveService(claim.provider);
  const missing = [
    consumer ? null : `consumer "${claim.consumer}"`,
    provider ? null : `provider "${claim.provider}"`,
  ].filter((m): m is string => m !== null);
  if (!consumer || !provider) {
    return {
      claim,
      verdict: 'unverifiable',
      reason: `${missing.join(' and ')} not in the analyzed view; the engine cannot adjudicate it`,
      evidence,
    };
  }

  const resolved = { consumer: consumer.service, provider: provider.service };
  let svc: Awaited<ReturnType<LainAdapter['getService']>>;
  try {
    svc = await deps.lain.getService({ snapshot: deps.view as never, service: provider.service });
  } catch (e) {
    return {
      claim,
      verdict: 'unverifiable',
      reason: `engine lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      resolved,
      evidence,
    };
  }

  const uses =
    svc.consumers
      .find((c) => c.service === consumer.service)
      ?.uses.filter((u) => u.endpoint?.key) ?? [];
  const unreviewed = unreviewedRepos((svc as { scope?: unknown }).scope);
  const providerReviewed = (svc as { provider_reviewed?: unknown }).provider_reviewed !== false;
  const complete =
    providerReviewed && !unreviewed.includes(consumer.repo) && !unreviewed.includes(provider.repo);
  const engine = {
    uses: uses.length,
    endpoints: [...new Set(uses.map((u) => u.endpoint?.key as string))].slice(0, 3),
    complete,
  };
  const edge = uses.length > 0;
  const subject = `${consumer.service} → ${provider.service}`;

  if (claim.polarity === 'present') {
    if (edge) {
      return {
        claim,
        verdict: 'verified',
        reason: `engine records ${uses.length} use(s) of ${provider.service} by ${consumer.service}`,
        engine,
        resolved,
        evidence,
      };
    }
    return complete
      ? {
          claim,
          verdict: 'contradicted',
          reason: `engine records no use of ${provider.service} by ${consumer.service} over a complete scope (${subject})`,
          engine,
          resolved,
          evidence,
        }
      : {
          claim,
          verdict: 'unverifiable',
          reason: `engine records no ${subject} edge, but the scope is incomplete (unreviewed: ${unreviewed.join(', ') || 'provider not reviewed'})`,
          engine,
          resolved,
          evidence,
        };
  }

  if (edge) {
    return {
      claim,
      verdict: 'contradicted',
      reason: `engine records ${uses.length} use(s) of ${provider.service} by ${consumer.service} (e.g. ${engine.endpoints.join(', ')})`,
      engine,
      evidence,
    };
  }
  return complete
    ? {
        claim,
        verdict: 'verified',
        reason: `engine records no ${subject} edge over a complete scope`,
        engine,
        resolved,
        evidence,
      }
    : {
        claim,
        verdict: 'unverifiable',
        reason: `no ${subject} edge found, but absence cannot be confirmed: scope incomplete (unreviewed: ${unreviewed.join(', ') || 'provider not reviewed'})`,
        engine,
        resolved,
        evidence,
      };
}

/** Líneas ± alrededor de la citada donde se busca `contains`. */
const LOCATION_WINDOW = 5;

/** `repo:Tipo:ruta:nombre:línea` → ruta y línea del ancla (el nombre puede llevar ':'). */
export function parseAnchorId(id: string): { path: string; line: number } | null {
  const m = /^[^:]+:[^:]+:([^:]+):.*:(\d+)$/.exec(id);
  return m ? { path: m[1] as string, line: Number(m[2]) } : null;
}

const samePath = (a: string, b: string): boolean =>
  a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

async function verifyLocation(
  claim: Extract<Claim, { kind: 'location' }>,
  deps: ClaimVerifierDeps,
  evidence: ClaimEvidence,
): Promise<ClaimResult> {
  const where = `${claim.repo}:${claim.path}:${claim.line}`;
  const base = { claim, evidence };
  // Un ancla que el motor entregó y que resuelve a ESTE archivo y línea lo respalda,
  // aunque el "texto" sea el nombre sintético del nodo (graphql-call:…) y no esté
  // literalmente en el código.
  const anchor = evidence.accepted
    .map(parseAnchorId)
    .find((a) => a !== null && a.line === claim.line && samePath(a.path, claim.path));
  if (anchor) {
    return {
      ...base,
      verdict: 'verified',
      reason: `an anchor the engine delivered resolves to ${where}`,
    };
  }
  if (deps.hasRepo && !(await deps.hasRepo(claim.repo))) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: `repo "${claim.repo}" is not in the analyzed view; the engine cannot read it`,
    };
  }
  // La ruta es relativa al repo. Los modelos a veces la escriben con el nombre del
  // repo delante ("saleor-dashboard/src/…") o sin la carpeta que se llama igual que
  // él: se prueban ambas formas antes de dar el sitio por inexistente.
  const paths = [claim.path];
  // Y al revés: a veces la carpeta de primer nivel del repo se llama como el repo
  // (saleor/saleor/checkout/…) y el modelo la quita.
  if (claim.path.startsWith(`${claim.repo}/`)) paths.push(claim.path.slice(claim.repo.length + 1));
  else paths.push(`${claim.repo}/${claim.path}`);
  let text = '';
  let usedPath = claim.path;
  try {
    for (const path of paths) {
      text = (
        await deps.lain.getCodeSnippet({
          path,
          repo_id: claim.repo,
          line: claim.line,
          context_lines: LOCATION_WINDOW,
        })
      ).text;
      usedPath = path;
      if (!/^Error: Not found/i.test(text)) break;
    }
  } catch (e) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: `engine could not read ${where}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // El motor contesta "Error: Not found…" como texto: el sitio no existe (se contradice).
  if (/^Error: Not found/i.test(text)) {
    return {
      ...base,
      verdict: 'contradicted',
      reason: `${where} does not exist in the index: ${text
        .replace(/^Error: Not found:\s*/i, '')
        .split('\n')[0]
        ?.slice(0, 160)}`,
      readback: text.slice(0, 800),
    };
  }
  if (/^(Config error|Error):/i.test(text)) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: `engine could not read ${where}: ${text.split('\n')[0]?.slice(0, 160)}`,
      readback: text.slice(0, 800),
    };
  }
  if (text.toLowerCase().includes(claim.contains.toLowerCase())) {
    return {
      ...base,
      verdict: 'verified',
      reason: `the engine read ${claim.repo}:${usedPath}:${claim.line} (±${LOCATION_WINDOW} lines) and "${claim.contains}" is there`,
    };
  }
  return {
    ...base,
    verdict: 'contradicted',
    reason: `the engine read ${where} (±${LOCATION_WINDOW} lines) and "${claim.contains}" is not there`,
    readback: text.slice(0, 800),
  };
}

/**
 * Normaliza espacios y saltos de línea para comparar frases: el modelo copia
 * del texto que leyó y a veces parte la frase en dos líneas. Lo que NO se
 * perdona es cambiar las palabras.
 */
const normSpace = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Un trozo del texto alrededor de donde CASARÍA la frase (o el principio). */
function excerptAround(text: string, needle: string, max = 700): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return `${flat.slice(0, max)}…`;
  const from = Math.max(0, at - Math.floor(max / 3));
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + max)}…`;
}

/**
 * Una cita de la documentación: la frase tiene que estar LITERALMENTE en la
 * sección indexada del checkout. Si el archivo no está en el índice, la cita se
 * contradice; si el archivo está pero la sección no, no se puede juzgar (el
 * modelo pudo copiar mal el título) y se dicen cuáles hay.
 */
async function verifyDocQuote(
  claim: Extract<Claim, { kind: 'doc_quote' }>,
  deps: ClaimVerifierDeps,
  evidence: ClaimEvidence,
): Promise<ClaimResult> {
  const where = `${claim.repo}:${claim.path}`;
  const base = { claim, evidence };
  if (!deps.docSection) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason:
        'this workspace has no documentation index, so the quoted section cannot be read back',
    };
  }
  const hit = deps.docSection(claim.repo, claim.path, claim.section);
  if (!hit?.fileFound) {
    return {
      ...base,
      verdict: 'contradicted',
      reason: `${where} is not a documentation file in the indexed checkout`,
    };
  }
  if (hit.sections.length === 0) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: `${where} has no section "${claim.section}"; its sections are: ${
        hit.headings.slice(0, 8).join(' | ') || '(none)'
      }`,
    };
  }
  const needle = normSpace(claim.quote);
  const body = hit.sections.map((s) => s.body).join('\n\n');
  for (const s of hit.sections) {
    if (normSpace(s.body).includes(needle)) {
      return {
        ...base,
        verdict: 'verified',
        reason: `the indexed section "${s.heading}" of ${where} contains the quoted phrase`,
        readback: excerptAround(s.body, needle),
      };
    }
  }
  return {
    ...base,
    verdict: 'contradicted',
    reason: `the indexed section "${hit.sections[0]?.heading}" of ${where} does not contain the quoted phrase`,
    readback: excerptAround(body, needle),
  };
}

export async function verifyClaims(
  claims: readonly Claim[],
  deps: ClaimVerifierDeps,
): Promise<ClaimResult[]> {
  const out: ClaimResult[] = [];
  for (const claim of claims) {
    // Una cita de un documento se comprueba contra el índice: no lleva ids.
    const refs = 'evidence' in claim ? claim.evidence : undefined;
    const evidence = refs?.length ? await deps.validateRefs(refs) : NO_EVIDENCE;
    if (claim.kind === 'location') {
      out.push(await verifyLocation(claim, deps, evidence));
      continue;
    }
    if (claim.kind === 'doc_quote') {
      out.push(await verifyDocQuote(claim, deps, evidence));
      continue;
    }
    if (claim.kind === 'relation') {
      out.push(await verifyRelation(claim, deps, evidence));
      continue;
    }
    const supported = evidence.accepted.length + evidence.receipts.length > 0;
    out.push({
      claim,
      verdict: supported ? 'supported' : 'unsupported',
      reason: supported
        ? `${evidence.accepted.length + evidence.receipts.length} citation(s) resolved`
        : 'no cited evidence id was delivered by the backend and resolved in the view',
      evidence,
    });
  }
  return out;
}

/**
 * El texto del rebote: qué afirmación se contradice y qué leyó el motor de
 * verdad. Sin esto el modelo recibe un "no" y no tiene con qué corregirlo.
 */
export function describeContradictions(results: readonly ClaimResult[]): string | null {
  const wrong = results.filter((r) => r.verdict === 'contradicted');
  if (wrong.length === 0) return null;
  return wrong
    .map((r) => {
      const c = r.claim;
      const what =
        c.kind === 'location'
          ? `${c.repo}:${c.path}:${c.line} (contains "${c.contains}")`
          : c.kind === 'doc_quote'
            ? `${c.repo}:${c.path} section "${c.section}" (quote "${c.quote}")`
            : c.kind === 'relation'
              ? `${c.consumer} -> ${c.provider} (${c.polarity})`
              : c.text;
      const read = r.readback ? `\nWhat the engine actually read:\n${r.readback}` : '';
      return `CONTRADICTED ${what}: ${r.reason}${read}`;
    })
    .join('\n\n');
}

const FILE_EXT = 'py|ts|tsx|js|jsx|mjs|cjs|graphql|gql|go|rs|java|kt|rb|php|cs|swift|sql';

/**
 * `ruta/archivo.ext:línea` que una respuesta afirma. Es lo que el motor puede
 * leer de vuelta: si hay alguno y el modelo no mandó afirmaciones de lugar, se le
 * devuelve la entrega una vez.
 */
export function extractFileLines(text: string): string[] {
  const re = new RegExp(
    `(?<![\\w/.-])((?:[\\w.-]+/)+[\\w.-]+\\.(?:${FILE_EXT})):(\\d{1,6})\\b`,
    'g',
  );
  return [...new Set([...text.matchAll(re)].map((m) => `${m[1]}:${m[2]}`))];
}
