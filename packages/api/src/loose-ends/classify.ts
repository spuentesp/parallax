import type { LooseEnd } from './types.js';
import { type Assessment, CATEGORIES, type Category } from './types.js';

/**
 * Regla por ruta, SIN modelo: un archivo de pruebas, de e2e, de scripts o de
 * historias no es producto. Es exacta y gratis; sólo reconoce lo que la ruta dice.
 */
const TOOLING_DIR =
  /(^|\/)(tests?|__tests__|e2e|e2e-legacy|spec|specs|scripts|tools|fixtures|__mocks__|storybook|\.storybook|testUtils|storybookUtils)(\/|$)/i;
const TOOLING_FILE =
  /(\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(conftest|test_[^/]*)\.py$|_test\.py$)/i;

export function classifyByPath(e: Pick<LooseEnd, 'path'>): Assessment | null {
  const dir = TOOLING_DIR.exec(e.path);
  if (dir) {
    return {
      category: 'test_or_tooling',
      reason: `the file is under "${dir[2]}/"`,
      evidence: null,
      source: 'rule',
    };
  }
  if (TOOLING_FILE.test(e.path)) {
    return {
      category: 'test_or_tooling',
      reason: 'the file name marks it as a test or story',
      evidence: null,
      source: 'rule',
    };
  }
  return null;
}

/**
 * Reglas exactas: lo que la RUTA o el MOTIVO del propio motor ya deciden, sin
 * pedírselo al modelo. "dynamic_topic" es, por definición, un nombre de tema que
 * el motor no pudo resolver estáticamente: un destino construido en ejecución.
 */
export function classifyByRule(e: Pick<LooseEnd, 'path' | 'kind' | 'reason'>): Assessment | null {
  const byPath = classifyByPath(e);
  if (byPath) return byPath;
  if (e.kind === 'unresolved' && e.reason === 'dynamic_topic') {
    return {
      category: 'dynamic_target',
      reason:
        'the engine could not resolve the topic or queue name statically: it is built at runtime',
      evidence: null,
      source: 'rule',
    };
  }
  return null;
}

/** Casos distintos que comparten motivo y archivo se juzgan UNA vez. */
export function groupKey(e: LooseEnd): string {
  return `${e.kind}|${e.repo}|${e.path}|${e.reason}`;
}

export interface Case {
  /** groupKey del grupo; el veredicto vale para todos sus miembros. */
  id: string;
  repo: string;
  path: string;
  line: number | null;
  kind: LooseEnd['kind'];
  reason: string;
  members: number;
  detail: LooseEnd['detail'];
  candidates: string[];
  snippet: string;
}

export const SYSTEM_PROMPT = `You classify "loose ends" in a code-analysis graph. A static-analysis engine could not bind a call to a known endpoint (kind "unresolved"), or bound it only by a weak heuristic (kind "inferred"). For each case you get the engine's reason, the call site and a code snippet around it.

Categories (choose exactly one):
- test_or_tooling: the code is a test, fixture, build script, CI or developer tooling. Product code that merely sits near tests is NOT this. A Celery/queue task definition or decorator is product code, never tooling.
- external_call: an HTTP call to something outside the analysed repos (a third-party API, a CDN, localhost, a URL from user configuration or an environment variable).
- dynamic_target: the target is decided at runtime: a variable or computed topic/queue/URL, a function parameter, a task name taken from settings. Engine reason "dynamic_topic" usually means this.
- likely_real_link: a real call to a service of this workspace that the engine failed to bind. Typical: the snippet calls a fixed route of the app's own server (for example fetch("/api/auth/login") from a web app that serves that route) or a clearly named workspace API.
- not_a_call: nothing is being called: an introspection query or a GraphQL document that is only defined, a comment, a type, an event name, a string that looks like a route.
- unclear: the snippet does not let you decide. Prefer this over guessing.

Hints by engine reason: "graphql_no_op" is usually an operation document that was defined or an introspection query (not_a_call), unless it is clearly executed against the workspace API. "no_match" with a relative path starting with "/" in web code is usually likely_real_link. "unbound_host" means the host is unknown: scripts and e2e are test_or_tooling, other code is external_call unless the snippet shows the workspace API.

Rules: judge only from the snippet and the engine's fields. Never invent endpoints. Fill "observation" first with what the code at the site actually does, in under 20 words; then decide. "reason" is one sentence under 25 words. "evidence" must be the case's own "path:line" as given.
Reply with ONLY a JSON array, one object per case, in the same order: [{"id": "...", "observation": "...", "category": "...", "reason": "...", "evidence": "path:line"}]`;

export function buildUserPrompt(cases: readonly Case[]): string {
  return cases
    .map((c, i) => {
      const d = c.detail;
      const facts = [
        `kind: ${c.kind}`,
        `engine reason: ${c.reason}`,
        d.method ? `method: ${d.method}` : null,
        d.host ? `host: ${d.host}` : null,
        d.template ? `template: ${d.template}` : null,
        d.urlExpr ? `expression: ${d.urlExpr}` : null,
        d.targetService ? `attributed to service: ${d.targetService}` : null,
        d.endpoint ? `matched endpoint: ${d.endpoint}` : null,
        d.confidence !== undefined ? `confidence: ${d.confidence.toFixed(2)}` : null,
        c.candidates.length > 0 ? `engine candidates: ${c.candidates.join(', ')}` : null,
        c.members > 1 ? `(${c.members} similar sites in this file)` : null,
      ].filter(Boolean);
      return `### Case ${i + 1}\nid: ${c.id}\nsite: ${c.repo}:${c.path}:${c.line ?? '?'}\n${facts.join('\n')}\nsnippet:\n${c.snippet || '(unavailable)'}`;
    })
    .join('\n\n');
}

const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

/** Los objetos `{...}` que se puedan leer de una respuesta, aunque el array llegue cortado. */
function readObjects(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // se recupera objeto a objeto
    }
  }
  const out: unknown[] = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0]));
    } catch {
      // un objeto roto no tira los demás
    }
  }
  return out;
}

/**
 * Lee la respuesta del modelo y la valida contra los casos enviados. Un veredicto
 * que no cita el sitio del caso, no es una categoría o falta, NO se acepta: queda
 * "unclear" y dice por qué. El modelo no puede asignar nada a un caso ajeno.
 * Con `fillMissing: false` los casos sin respuesta se OMITEN (para reintentarlos).
 */
export function parseVerdicts(
  text: string,
  cases: readonly Case[],
  model: string | null,
  opts: { fillMissing?: boolean } = {},
): Map<string, Assessment> {
  const out = new Map<string, Assessment>();
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const raw of readObjects(text)) {
    const v = (raw ?? {}) as {
      id?: unknown;
      category?: unknown;
      reason?: unknown;
      evidence?: unknown;
    };
    const c = typeof v.id === 'string' ? byId.get(v.id) : undefined;
    if (!c || out.has(c.id)) continue;
    const reason = typeof v.reason === 'string' ? v.reason.trim().slice(0, 240) : '';
    const site = `${c.path}:${c.line ?? ''}`;
    const cited = typeof v.evidence === 'string' ? v.evidence.trim() : '';
    // El aviso muestra el sitio como `repo:ruta:línea`: citarlo así también vale.
    const evidenceOk =
      cited === site ||
      cited === `${c.repo}:${site}` ||
      (c.line === null && cited.startsWith(`${c.path}:`));
    if (!isCategory(v.category) || reason === '') {
      out.set(c.id, unclear('the model reply for this case was not valid', model));
    } else if (!evidenceOk) {
      out.set(c.id, unclear("the model did not cite this case's own code location", model));
    } else {
      out.set(c.id, { category: v.category, reason, evidence: site, source: 'model', model });
    }
  }
  if (opts.fillMissing !== false) {
    for (const c of cases) {
      if (!out.has(c.id)) out.set(c.id, unclear('the model did not answer this case', model));
    }
  }
  return out;
}

/** Un veredicto no utilizable: se muestra tal cual en la respuesta, pero no se guarda (`invalid`). */
const unclear = (reason: string, model: string | null): Assessment => ({
  category: 'unclear',
  reason,
  evidence: null,
  source: 'model',
  model,
  invalid: true,
});
