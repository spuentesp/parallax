import type { LainAdapter } from '../lain-adapter/types.js';

// La documentación que los propios repos traen (ADRs, AGENTS.md, README, docs/): el motor ya
// la tiene indexada, pero sólo da NOMBRES de archivo al listar. Aquí se localiza la ruta
// probando los sitios habituales y se LEE cada candidato (título y primer párrafo), de modo
// que nada se lista sin haberse visto.

export type DocKind = 'decision' | 'conventions' | 'domain' | 'guide' | 'readme' | 'security';

export interface DocEntry {
  repo: string;
  path: string;
  kind: DocKind;
  title: string;
  /** Primer párrafo, recortado: lo que el archivo dice, no lo que alguien supone. */
  summary: string;
}

const KIND_ORDER: DocKind[] = ['conventions', 'decision', 'domain', 'guide', 'readme', 'security'];
const SKIP = /^(changelog|license|code_of_conduct)/i;
const MAX_DOCS_PER_REPO = 40;
const CONCURRENCY = 6;

export function classify(path: string): DocKind {
  const file = path.split('/').pop() ?? path;
  if (/^(agents|claude|contributing)\./i.test(file)) return 'conventions';
  if (/(^|\/)adr(\/|$)/i.test(path) || /^\d{3,4}-/.test(file)) return 'decision';
  if (/^(context|domain|glossary)/i.test(file)) return 'domain';
  if (/^security\./i.test(file)) return 'security';
  if (/^readme\./i.test(file)) return 'readme';
  return 'guide';
}

/** Dónde puede estar un archivo del que sólo se sabe el nombre. */
export function candidatePaths(name: string): string[] {
  if (/^\d{3,4}-/.test(name)) return [`docs/adr/${name}`];
  if (/^(agents|claude|contributing|readme|security|context)\./i.test(name)) return [name];
  if (/^(domain|issue-tracker)\./i.test(name)) return [`docs/agents/${name}`, `docs/${name}`];
  return [`docs/${name}`];
}

/** Título y primer párrafo de lo que devolvió get_code_snippet; null si no es un archivo. */
export function parseDoc(text: string): { title: string; summary: string } | null {
  if (!/^File: /m.test(text)) return null;
  const lines = text
    .split('\n')
    .map((l) => /^\s*\d+: ?(.*)$/.exec(l)?.[1])
    .filter((l): l is string => l !== undefined);
  const heading = lines.find((l) => /^#{1,3}\s+\S/.test(l));
  const title = heading?.replace(/^#+\s+/, '').trim() ?? '';
  const afterHeading = heading ? lines.slice(lines.indexOf(heading) + 1) : lines;
  const para: string[] = [];
  for (const l of afterHeading) {
    const t = l.trim();
    if (t === '') {
      if (para.length > 0) break;
      continue;
    }
    // Etiquetas, tablas y bloques de código no son el primer párrafo.
    if (/^(\*\*Tags|\*\*Status|#|[|>`\-![]|<)/.test(t) && para.length === 0) continue;
    para.push(t);
  }
  const summary = para.join(' ').replace(/\s+/g, ' ').slice(0, 220);
  return { title, summary };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k] as T);
      }
    }),
  );
  return out;
}

export async function discoverDocs(lain: LainAdapter, repo: string): Promise<DocEntry[]> {
  let names: string[] = [];
  try {
    const res = await lain.queryGraph({
      repo_id: repo,
      query: {
        ops: [
          { op: 'find', type: 'File', name: { glob: '*.md' } },
          { op: 'limit', count: 400 },
        ],
      },
    } as never);
    names = [...new Set(res.nodes.map((n) => n.name))].filter((n) => !SKIP.test(n));
  } catch {
    return [];
  }

  // Candidatos: nombre → rutas probables. Los README/AGENTS genéricos se piden por la raíz;
  // los anidados (carpeta/AGENTS.md) se encuentran con la búsqueda del propio motor.
  const candidates = new Set<string>();
  for (const n of names) for (const p of candidatePaths(n)) candidates.add(p);
  try {
    const found = (await lain.codeTool('search_code', {
      query: 'AGENTS',
      repo_id: repo,
      limit: 25,
    })) as { text?: string };
    for (const m of (found.text ?? '').matchAll(/ file (\S*(?:AGENTS|CLAUDE)\.md)\b/g)) {
      if (m[1] && !m[1].startsWith('.')) candidates.add(m[1]);
    }
  } catch {
    // sin nested: seguimos con lo conocido
  }

  const list = [...candidates].slice(0, MAX_DOCS_PER_REPO * 2);
  const read = await pool(list, CONCURRENCY, async (path) => {
    try {
      const snip = await lain.getCodeSnippet({
        repo_id: repo,
        path,
        line: 1,
        context_lines: 12,
      } as never);
      const doc = parseDoc(snip.text);
      return doc ? ({ repo, path, kind: classify(path), ...doc } as DocEntry) : null;
    } catch {
      return null;
    }
  });
  return read
    .filter((d): d is DocEntry => d !== null && !d.path.startsWith('.'))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.path.localeCompare(b.path),
    )
    .slice(0, MAX_DOCS_PER_REPO);
}
