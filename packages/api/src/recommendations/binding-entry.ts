import type { BindingDecl } from './types.js';

const CONSUMER_KEYS = new Set(['repo', 'path', 'symbol', 'key', 'site']);
const PROVIDER_KEYS = new Set(['service', 'key']);

function unquote(v: string): string | null {
  const q = v[0];
  if (q !== "'" && q !== '"') return v;
  if (v.length < 2 || v[v.length - 1] !== q) return null;
  const inner = v.slice(1, -1);
  return q === "'" ? inner.replaceAll("''", "'") : inner;
}

/**
 * La entrada `bindings` que emite `check_binding`:
 *
 *   - consumer:
 *       repo: …  path: …  symbol: …  key: …  site: …
 *     provider:
 *       service: …  key: …
 *
 * Forma fija de dos bloques, así que no hace falta un parser YAML; pero tampoco se
 * adivina: cualquier línea, clave o comilla inesperada devuelve null y la
 * recomendación se descarta (mejor nada que una declaración mal leída).
 */
export function parseBindingEntry(yaml: string): BindingDecl | null {
  const consumer: Record<string, string> = {};
  const provider: Record<string, string> = {};
  let section: 'consumer' | 'provider' | null = null;
  for (const raw of yaml.split('\n')) {
    if (raw.trim() === '') continue;
    const m = /^\s*(?:- )?([a-z_]+):\s?(.*)$/.exec(raw);
    if (!m) return null;
    const key = m[1] as string;
    const value = unquote((m[2] ?? '').trim());
    if (value === null) return null;
    if ((key === 'consumer' || key === 'provider') && value === '') {
      section = key;
      continue;
    }
    if (section === null) return null;
    const allowed = section === 'consumer' ? CONSUMER_KEYS : PROVIDER_KEYS;
    if (!allowed.has(key) || value === '') return null;
    (section === 'consumer' ? consumer : provider)[key] = value;
  }
  const { repo, path, symbol, key, site } = consumer;
  if (!repo || !path || !symbol || !key || !provider.service || !provider.key) return null;
  return {
    consumer: { repo, path, symbol, key, ...(site ? { site } : {}) },
    provider: { service: provider.service, key: provider.key },
  };
}
