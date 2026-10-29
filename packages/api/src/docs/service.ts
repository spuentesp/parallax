import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { deriveLainRepoId } from '../code-graph.js';
import * as schema from '../db/schema.js';
import {
  type DocHit,
  indexRepo,
  listIndexed,
  readDocs,
  resolveCheckout,
  searchDocs,
} from './index.js';

export const DOC_STOPWORDS: ReadonlySet<string> = new Set(
  'task what which where when does must should would could about this that there their these those with from into have been being between across code repo repos repository repositories documentation document documents docs explain tell show please enforced enforce enforces why how who whom ours your mine the and for are you our can any'.split(
    ' ',
  ),
);

export interface IndexReport {
  repo: string;
  files: number;
  sha: string | null;
  /** Por qué no se pudo indexar este repo (sin checkout, ilegible…). */
  skipped?: string;
}

export interface DocsService {
  /** Indexa los repos del workspace que aún no lo estén (o todos con force). */
  ensure(workspaceId: string, force?: boolean): Promise<IndexReport[]>;
  search(workspaceId: string, query: string, opts?: { repo?: string; limit?: number }): DocHit[];
  list(workspaceId: string): ReturnType<typeof listIndexed>;
  /** Hay algo indexado para este workspace. */
  has(workspaceId: string): boolean;
}

export function createDocsService(deps: {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  roots: string[];
  cacheDir: string;
}): DocsService {
  const inflight = new Map<string, Promise<IndexReport[]>>();
  const indexed = (ws: string, repo: string): boolean =>
    deps.sqlite
      .prepare('SELECT 1 FROM doc_file WHERE workspace_id = ? AND repo = ? LIMIT 1')
      .get(ws, repo) !== undefined;

  async function run(workspaceId: string, force: boolean): Promise<IndexReport[]> {
    const repos = await deps.db
      .select()
      .from(schema.repo)
      .where(eq(schema.repo.workspaceId, workspaceId));
    const reports: IndexReport[] = [];
    for (const r of repos) {
      const name = deriveLainRepoId(r);
      if (!force && indexed(workspaceId, name)) continue;
      const co = await resolveCheckout(r, name, { roots: deps.roots, cacheDir: deps.cacheDir });
      if (!co) {
        reports.push({ repo: name, files: 0, sha: null, skipped: 'no checkout available' });
        continue;
      }
      try {
        const files = readDocs(co.dir);
        indexRepo(deps.sqlite, workspaceId, name, files, co.sha);
        reports.push({ repo: name, files: files.length, sha: co.sha });
      } catch (e) {
        reports.push({
          repo: name,
          files: 0,
          sha: co.sha,
          skipped: e instanceof Error ? e.message : 'unreadable',
        });
      }
    }
    return reports;
  }

  return {
    ensure(workspaceId, force = false) {
      const key = `${workspaceId}:${force}`;
      const hit = inflight.get(key);
      if (hit) return hit;
      const p = run(workspaceId, force).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    search: (workspaceId, query, opts) =>
      searchDocs(deps.sqlite, workspaceId, query, DOC_STOPWORDS, opts),
    list: (workspaceId) => listIndexed(deps.sqlite, workspaceId),
    has: (workspaceId) =>
      deps.sqlite
        .prepare('SELECT 1 FROM doc_file WHERE workspace_id = ? LIMIT 1')
        .get(workspaceId) !== undefined,
  };
}
