import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { classify, type DocKind } from './discover.js';

// Índice local de la documentación: checkout del repo → archivos .md/.mdx → secciones por título
// → FTS5 en la misma base SQLite. Lo que se cita sale de lo LEÍDO en el checkout (con su SHA),
// no de una suposición del modelo.

const run = promisify(execFile);
const SKIP_DIR = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.venv',
  'venv',
  'plugins',
]);
const SKIP_FILE = /^(changelog|license|code_of_conduct|history)/i;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 300_000;
const MAX_SECTION_CHARS = 1800;
const MAX_EXCERPT_CHARS = 2500;
const CLONE_HOSTS = new Set(['github.com', 'gitlab.com']);

export interface Section {
  heading: string;
  body: string;
  lineStart: number;
}

export interface IndexedFile {
  path: string;
  kind: DocKind;
  title: string;
  summary: string;
  sections: Section[];
}

export interface DocHit {
  repo: string;
  path: string;
  heading: string;
  line: number;
  snippet: string;
  /** Texto de la sección que casó (recortado): lo que se le da al modelo, ya leído. */
  text: string;
  kind: DocKind;
  title: string;
}

/** Parte un markdown por títulos (# a ####); lo que hay dentro de un bloque ``` no cuenta. */
export function chunkMarkdown(text: string): { title: string; sections: Section[] } {
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const sections: Section[] = [];
  const trail: string[] = [];
  let heading = '';
  let buf: string[] = [];
  let start = 1;
  let fence = false;
  let title = '';
  const flush = (): void => {
    const body = buf.join('\n').trim();
    if (body === '' && heading === '') return;
    // Una sección larga se corta por párrafos para que cada trozo sea citable.
    let part: string[] = [];
    let size = 0;
    const emit = (): void => {
      if (part.length > 0 || sections.at(-1)?.heading !== heading)
        sections.push({ heading, body: part.join('\n\n'), lineStart: start });
      part = [];
      size = 0;
    };
    for (const para of body.split(/\n\s*\n/)) {
      if (size + para.length > MAX_SECTION_CHARS && part.length > 0) emit();
      part.push(para);
      size += para.length;
    }
    emit();
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flush();
      buf = [];
      const depth = (m[1] as string).length;
      trail.length = depth - 1;
      trail[depth - 1] = (m[2] as string).trim();
      heading = trail.filter(Boolean).join(' › ');
      if (title === '') title = (m[2] as string).trim();
      start = i + 1;
      return;
    }
    buf.push(line);
  });
  flush();
  return { title, sections };
}

function firstParagraph(text: string): string {
  const para: string[] = [];
  for (const l of text.split('\n')) {
    const t = l.trim();
    if (t === '') {
      if (para.length > 0) break;
      continue;
    }
    if (para.length === 0 && /^(\*\*Tags|\*\*Status|#|[|>`\-![]|<|---)/.test(t)) continue;
    para.push(t);
  }
  return para.join(' ').replace(/\s+/g, ' ').slice(0, 220);
}

export function readDocs(dir: string): IndexedFile[] {
  const out: IndexedFile[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(full);
        continue;
      }
      if (!/\.mdx?$/i.test(e.name) || SKIP_FILE.test(e.name)) continue;
      if (!e.isFile() || statSync(full).size > MAX_FILE_BYTES) continue;
      const path = relative(dir, full).split('\\').join('/');
      const text = readFileSync(full, 'utf8');
      const { title, sections } = chunkMarkdown(text);
      out.push({
        path,
        kind: classify(path),
        title: title || basename(path),
        summary: firstParagraph(sections.map((s) => s.body).join('\n\n')),
        sections,
      });
    }
  };
  walk(dir);
  return out;
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', dir, ...args], {
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

export interface CheckoutOpts {
  roots: string[];
  cacheDir: string;
}

/**
 * Dónde está el código del repo: la ruta `local` si existe, un checkout hermano en alguna raíz
 * configurada o un clon superficial de una URL https de un host conocido. Nunca ejecuta nada
 * del repo; sólo lee archivos.
 */
export async function resolveCheckout(
  repo: { uri: string; local?: string | null },
  name: string,
  opts: CheckoutOpts,
): Promise<{ dir: string; sha: string | null } | null> {
  const candidates = [
    ...(repo.local ? [resolve(repo.local)] : []),
    ...opts.roots.map((r) => join(resolve(r), name)),
    join(resolve(opts.cacheDir), name),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const sha = await git(dir, ['rev-parse', 'HEAD']).catch(() => null);
    return { dir, sha };
  }
  let url: URL;
  try {
    url = new URL(repo.uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !CLONE_HOSTS.has(url.hostname) || url.username || url.password)
    return null;
  const dir = join(resolve(opts.cacheDir), name);
  try {
    await run('git', ['clone', '--depth', '1', '--', url.toString(), dir], {
      timeout: 300_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return null;
  }
  return { dir, sha: await git(dir, ['rev-parse', 'HEAD']).catch(() => null) };
}

export function indexRepo(
  db: Database.Database,
  workspaceId: string,
  repo: string,
  files: IndexedFile[],
  sha: string | null,
): number {
  const delFiles = db.prepare('DELETE FROM doc_file WHERE workspace_id = ? AND repo = ?');
  const delFts = db.prepare('DELETE FROM doc_section_fts WHERE workspace_id = ? AND repo = ?');
  const insFile = db.prepare(
    'INSERT INTO doc_file (workspace_id, repo, path, kind, title, summary, sha, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insSec = db.prepare(
    'INSERT INTO doc_section_fts (workspace_id, repo, path, heading, body, line_start) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    delFiles.run(workspaceId, repo);
    delFts.run(workspaceId, repo);
    for (const f of files) {
      insFile.run(workspaceId, repo, f.path, f.kind, f.title, f.summary, sha, Date.now());
      for (const s of f.sections)
        insSec.run(workspaceId, repo, f.path, s.heading, s.body, s.lineStart);
    }
  })();
  return files.length;
}

/** Una página web que el modelo vio: se indexa tal cual, con la URL como ruta. */
export interface WebDoc {
  url: string;
  title: string;
  content: string;
}

/**
 * Guarda las páginas que devolvió una búsqueda web en el MISMO índice que la documentación
 * de los repos (repo `web`, ruta = URL, una sección con el título como encabezado), para que
 * una cita se compruebe con el mismo verificador. Sólo toca las filas de esa URL: no borra
 * lo demás.
 */
export function indexWebPages(
  db: Database.Database,
  workspaceId: string,
  repo: string,
  pages: readonly WebDoc[],
): number {
  const delFile = db.prepare(
    'DELETE FROM doc_file WHERE workspace_id = ? AND repo = ? AND path = ?',
  );
  const delFts = db.prepare(
    'DELETE FROM doc_section_fts WHERE workspace_id = ? AND repo = ? AND path = ?',
  );
  const insFile = db.prepare(
    'INSERT INTO doc_file (workspace_id, repo, path, kind, title, summary, sha, indexed_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
  );
  const insSec = db.prepare(
    'INSERT INTO doc_section_fts (workspace_id, repo, path, heading, body, line_start) VALUES (?, ?, ?, ?, ?, 1)',
  );
  db.transaction(() => {
    for (const p of pages) {
      delFile.run(workspaceId, repo, p.url);
      delFts.run(workspaceId, repo, p.url);
      insFile.run(
        workspaceId,
        repo,
        p.url,
        'guide',
        p.title,
        firstParagraph(p.content),
        Date.now(),
      );
      insSec.run(workspaceId, repo, p.url, p.title, p.content);
    }
  })();
  return pages.length;
}

/** Palabras de la pregunta → consulta FTS5 (OR de prefijos); sin palabras útiles, null. */
export function ftsQuery(text: string, stop: ReadonlySet<string>): string | null {
  // Los identificadores del código no son el vocabulario de la documentación: se parten en
  // palabras (giftCardBalance → gift card balance, select_for_update → select for update).
  const spoken = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const words = [
    ...new Set(
      (spoken.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !stop.has(w)),
    ),
  ].slice(0, 8);
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' OR ');
}

/** El documento en orden, cada sección con la línea de su título (para citarla), recortado. */
function documentText(db: Database.Database, ws: string, repo: string, path: string): string {
  const rows = db
    .prepare<unknown[], { heading: string; body: string; line_start: number }>(
      'SELECT heading, body, line_start FROM doc_section_fts WHERE workspace_id = ? AND repo = ? AND path = ? ORDER BY rowid',
    )
    .all(ws, repo, path);
  const out = rows.map((r) => `## ${r.heading} (heading at line ${r.line_start})\n${r.body}`);
  return out.join('\n\n').slice(0, MAX_EXCERPT_CHARS);
}

export function searchDocs(
  db: Database.Database,
  workspaceId: string,
  query: string,
  stop: ReadonlySet<string>,
  opts: { repo?: string; limit?: number } = {},
): DocHit[] {
  const q = ftsQuery(query, stop);
  if (!q) return [];
  // Un mismo archivo puede casar con varias secciones: se queda con la mejor de cada uno.
  const rows = db
    .prepare<
      unknown[],
      {
        repo: string;
        path: string;
        heading: string;
        line_start: number;
        snip: string;
        body: string;
      }
    >(
      `SELECT repo, path, heading, line_start, body,
              snippet(doc_section_fts, 4, '', '', ' … ', 28) AS snip
         FROM doc_section_fts
        WHERE doc_section_fts MATCH ? AND workspace_id = ? ${opts.repo ? 'AND repo = ?' : ''}
        ORDER BY bm25(doc_section_fts, 0, 0, 3.0, 5.0, 1.0, 0)
        LIMIT ?`,
    )
    .all(q, workspaceId, ...(opts.repo ? [opts.repo] : []), (opts.limit ?? 6) * 4);
  const meta = db.prepare<unknown[], { kind: DocKind; title: string }>(
    'SELECT kind, title FROM doc_file WHERE workspace_id = ? AND repo = ? AND path = ?',
  );
  const seen = new Set<string>();
  const hits: DocHit[] = [];
  for (const r of rows) {
    const key = `${r.repo}\u0000${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = meta.get(workspaceId, r.repo, r.path);
    hits.push({
      repo: r.repo,
      path: r.path,
      heading: r.heading,
      line: r.line_start,
      snippet: r.snip.replace(/\s+/g, ' ').trim(),
      text: documentText(db, workspaceId, r.repo, r.path),
      kind: m?.kind ?? 'guide',
      title: m?.title ?? r.path,
    });
    if (hits.length >= (opts.limit ?? 6)) break;
  }
  return hits;
}

/** Una sección del índice, con el texto tal cual está en el checkout. */
export interface DocSection {
  heading: string;
  body: string;
  lineStart: number;
}

/**
 * Lo que hay de un archivo en el índice: si el archivo existe, qué secciones
 * tiene y cuáles casan con el título pedido. Sirve para distinguir "este
 * archivo no está" de "esta sección no está" — dos veredictos distintos.
 */
export interface DocSectionHit {
  /** El archivo está en el índice (aunque la sección pedida no exista). */
  fileFound: boolean;
  /** Las secciones cuyo título coincide con el pedido. */
  sections: DocSection[];
  /** Todos los títulos del archivo, para decir qué hay. */
  headings: string[];
}

/**
 * Las secciones de un archivo por su título. El título se compara sin espacios
 * sobrantes y sin distinguir mayúsculas: el modelo lo copia de la pista y a
 * veces le cambia el caso, pero no debe eso volverse un veredicto en contra.
 */
export function findDocSections(
  db: Database.Database,
  workspaceId: string,
  repo: string,
  path: string,
  heading: string,
): DocSectionHit {
  const file = db
    .prepare('SELECT 1 FROM doc_file WHERE workspace_id = ? AND repo = ? AND path = ? LIMIT 1')
    .get(workspaceId, repo, path);
  const rows = db
    .prepare<unknown[], { heading: string; body: string; line_start: number }>(
      'SELECT heading, body, line_start FROM doc_section_fts WHERE workspace_id = ? AND repo = ? AND path = ? ORDER BY rowid',
    )
    .all(workspaceId, repo, path);
  const wanted = heading.trim().toLowerCase();
  return {
    fileFound: file !== undefined,
    headings: rows.map((r) => r.heading),
    sections: rows
      .filter((r) => r.heading.trim().toLowerCase() === wanted)
      .map((r) => ({ heading: r.heading, body: r.body, lineStart: r.line_start })),
  };
}

export function listIndexed(
  db: Database.Database,
  workspaceId: string,
): Array<{
  repo: string;
  path: string;
  kind: DocKind;
  title: string;
  summary: string;
  sha: string | null;
}> {
  return db
    .prepare<
      unknown[],
      {
        repo: string;
        path: string;
        kind: DocKind;
        title: string;
        summary: string;
        sha: string | null;
      }
    >(
      'SELECT repo, path, kind, title, summary, sha FROM doc_file WHERE workspace_id = ? ORDER BY repo, path',
    )
    .all(workspaceId);
}
