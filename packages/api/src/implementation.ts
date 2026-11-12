// "¿Qué código implementa este endpoint?" Un contrato GraphQL sólo tiene como
// proveedor su SDL (`schema.graphql`): el código que lo resuelve no está en el
// contrato. Se busca por NOMBRE en el índice de código de LAIN (find_symbol) y se
// pregunta a get_cross_runtime_callers dónde se registra. El hallazgo del
// símbolo (archivo:línea) es del motor; que ese símbolo sea la implementación es
// una COINCIDENCIA DE NOMBRE: se rotula así y no se presenta como un vínculo.

import type { LainAdapter } from './lain-adapter/types.js';

export interface ImplementationCandidate {
  id: string;
  type: string;
  name: string;
  path: string;
  line: number;
}

export interface Registration {
  name: string;
  path: string;
}

export interface ImplementationResult {
  key: string;
  repo: string;
  /** Nombres que se probaron, en orden (el motor no conoce la convención del framework). */
  tried: string[];
  candidates: ImplementationCandidate[];
  /** Dónde se registra el primer candidato (resolvers/schema que lo usan). */
  registeredIn: Registration[];
  /** Siempre "name_match": el vínculo endpoint → símbolo es heurístico. */
  basis: 'name_match';
  error?: string;
}

/** `checkoutShippingAddressUpdate` → PascalCase, snake_case y el nombre tal cual. */
export function nameVariants(key: string): string[] {
  const parts = key.split(':');
  const raw = (parts[parts.length - 1] ?? '').trim();
  if (!raw || /[\s/{}]/.test(raw)) return [];
  const pascal = raw.charAt(0).toUpperCase() + raw.slice(1);
  const snake = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return [...new Set([pascal, raw, snake])];
}

const NON_CODE = /\.(graphql|gql|json|ya?ml|md|lock)$/i;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|e2e|e2e-legacy|fixtures|__mocks__)(\/|$)|\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$/i;
const CODE_TYPES = new Set(['class', 'function', 'method', 'interface', 'struct']);

/** Líneas numeradas de find_symbol: "1. `<uuid>` class ruta:46 anchor=0.00". */
export function parseSymbols(text: string): ImplementationCandidate[] {
  const out: ImplementationCandidate[] = [];
  for (const m of text.matchAll(/^\s*\d+\.\s+`([0-9a-f-]{36})`\s+(\w+)\s+(\S+?):(\d+)/gm)) {
    out.push({
      id: m[1] as string,
      type: (m[2] as string).toLowerCase(),
      name: '',
      path: m[3] as string,
      line: Number(m[4]),
    });
  }
  return out;
}

/** "### GraphQL Resolvers" → `- **Nombre** (ruta)`. */
export function parseRegistrations(text: string): Registration[] {
  const section = /###\s+GraphQL Resolvers\s*\n([\s\S]*?)(?=\n###|$)/.exec(text)?.[1] ?? '';
  return [...section.matchAll(/^\s*-\s+\*\*(.+?)\*\*\s+\((.+?)\)/gm)].map((m) => ({
    name: m[1] as string,
    path: m[2] as string,
  }));
}

export async function findImplementation(
  adapter: LainAdapter,
  opts: { key: string; repo: string },
): Promise<ImplementationResult> {
  const tried = nameVariants(opts.key);
  const base: ImplementationResult = {
    key: opts.key,
    repo: opts.repo,
    tried,
    candidates: [],
    registeredIn: [],
    basis: 'name_match',
  };
  if (tried.length === 0) return { ...base, error: 'no searchable name in this contract key' };

  const seen = new Set<string>();
  try {
    for (const name of tried) {
      const res = await adapter.codeTool('find_symbol', { name, repo_id: opts.repo });
      for (const c of parseSymbols(res.text)) {
        if (seen.has(c.id) || !CODE_TYPES.has(c.type)) continue;
        if (NON_CODE.test(c.path) || TEST_PATH.test(c.path)) continue;
        seen.add(c.id);
        base.candidates.push({ ...c, name });
      }
      if (base.candidates.length >= 3) break;
    }
    base.candidates = base.candidates.slice(0, 3);
    const first = base.candidates[0];
    if (first) {
      const res = await adapter.codeTool('get_cross_runtime_callers', {
        node_id: first.id,
        repo_id: opts.repo,
      });
      base.registeredIn = parseRegistrations(res.text).slice(0, 6);
    }
    return base;
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}
