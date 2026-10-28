// Lo que el usuario dejó en el mapa de cada workspace: filtros/foco/selección
// (la query de la URL) y los nodos abiertos. Volver al mapa desde otra sección
// lo restaura; sin esto, cada salida lo deja en blanco.

import { readStored, writeStored } from './storage.js';

const searchKey = (org: string) => `parallax.map.search.${org}`;
const expandedKey = (org: string) => `parallax.map.expanded.${org}`;
const convKey = (org: string) => `parallax.conv.${org}`;

/** La query que se restaura al volver al mapa ("" si no hay). `token` nunca se guarda. */
export function readMapSearch(org: string): string {
  return readStored('session', searchKey(org)) ?? '';
}

export function writeMapSearch(org: string, params: URLSearchParams): void {
  const next = new URLSearchParams(params);
  next.delete('token');
  const text = next.toString();
  writeStored('session', searchKey(org), text === '' ? null : text);
}

/** Nodos abiertos, o null si el usuario nunca los tocó (para poder abrir los repos al entrar). */
export function readExpanded(org: string): string[] | null {
  const raw = readStored('session', expandedKey(org));
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function writeExpanded(org: string, ids: Iterable<string>): void {
  writeStored('session', expandedKey(org), JSON.stringify([...ids]));
}

/** Conversación abierta del asistente en este workspace. */
export function readConv(org: string): string | null {
  return readStored('session', convKey(org));
}

export function writeConv(org: string, id: string | null): void {
  writeStored('session', convKey(org), id);
}
