// La lista de documentación oficial de cada workspace, en la base de datos. Se siembra con
// DEFAULT_OFFICIAL_DOCS la primera vez que se lee; a partir de ahí es del workspace.

import type Database from 'better-sqlite3';
import { DEFAULT_OFFICIAL_DOCS, type OfficialDocs } from '../agent/web-search.js';

export const WORD = /^[a-z][a-z0-9.+#-]{1,39}$/;
// Un nombre de host: sin esquema, ruta, puerto ni comodines.
export const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export interface OfficialDocEntry {
  word: string;
  domain: string;
}

export interface OfficialDocsStore {
  /** La lista del workspace como mapa palabra → dominios (siembra si hace falta). */
  forWorkspace(workspaceId: string): OfficialDocs;
  list(workspaceId: string): OfficialDocEntry[];
  /** Añade dominios a una palabra; devuelve cuántos eran nuevos. */
  add(workspaceId: string, word: string, domains: readonly string[]): number;
  /** Quita un dominio de una palabra, o la palabra entera sin `domain`; devuelve cuántas filas. */
  remove(workspaceId: string, word: string, domain?: string): number;
  /** Vuelve a los valores por defecto (descarta lo que el workspace había cambiado). */
  reset(workspaceId: string): void;
}

export class InvalidOfficialDoc extends Error {}

export function createOfficialDocsStore(sqlite: Database.Database): OfficialDocsStore {
  const seeded = sqlite.prepare('SELECT 1 FROM official_doc_seeded WHERE workspace_id = ?');
  const ins = sqlite.prepare(
    'INSERT OR IGNORE INTO official_doc (workspace_id, word, domain, created_at) VALUES (?, ?, ?, ?)',
  );

  const seed = (ws: string): void => {
    if (seeded.get(ws) !== undefined) return;
    sqlite.transaction(() => {
      const now = Date.now();
      for (const [word, domains] of Object.entries(DEFAULT_OFFICIAL_DOCS))
        for (const d of domains) ins.run(ws, word, d, now);
      sqlite
        .prepare(
          'INSERT OR IGNORE INTO official_doc_seeded (workspace_id, seeded_at) VALUES (?, ?)',
        )
        .run(ws, now);
    })();
  };

  const list = (ws: string): OfficialDocEntry[] => {
    seed(ws);
    return sqlite
      .prepare<unknown[], OfficialDocEntry>(
        'SELECT word, domain FROM official_doc WHERE workspace_id = ? ORDER BY word, domain',
      )
      .all(ws);
  };

  return {
    list,
    forWorkspace(ws) {
      const out: Record<string, string[]> = {};
      for (const { word, domain } of list(ws)) {
        const domains = out[word] ?? [];
        domains.push(domain);
        out[word] = domains;
      }
      return out;
    },
    add(ws, word, domains) {
      const w = word.trim().toLowerCase();
      if (!WORD.test(w)) throw new InvalidOfficialDoc(`"${word}" is not a library keyword`);
      const ds = domains.map((d) => d.trim().toLowerCase());
      const bad = ds.find((d) => !DOMAIN.test(d));
      if (bad !== undefined) throw new InvalidOfficialDoc(`"${bad}" is not a host name`);
      if (ds.length === 0) throw new InvalidOfficialDoc('at least one domain is required');
      seed(ws);
      return sqlite.transaction(() => {
        const now = Date.now();
        return ds.reduce((n, d) => n + ins.run(ws, w, d, now).changes, 0);
      })();
    },
    remove(ws, word, domain) {
      seed(ws);
      const w = word.trim().toLowerCase();
      return domain === undefined
        ? sqlite.prepare('DELETE FROM official_doc WHERE workspace_id = ? AND word = ?').run(ws, w)
            .changes
        : sqlite
            .prepare('DELETE FROM official_doc WHERE workspace_id = ? AND word = ? AND domain = ?')
            .run(ws, w, domain.trim().toLowerCase()).changes;
    },
    reset(ws) {
      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM official_doc WHERE workspace_id = ?').run(ws);
        sqlite.prepare('DELETE FROM official_doc_seeded WHERE workspace_id = ?').run(ws);
      })();
      seed(ws);
    },
  };
}
