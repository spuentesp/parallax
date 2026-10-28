// Escáner de señales del checkout (§4 del contrato). Lee el filesystem
// directo y NO respeta .gitignore: el trabajo del advisor es ver los puntos
// ciegos del walker de LAIN (p. ej. el codegen gitignored del storefront).
//
// Excepción deliberada: node_modules y .git se saltan siempre — no son
// "ciegos del motor", son ruido garantizado.

import { readdirSync, readFileSync, type Stats, statSync } from 'node:fs';
import { posix, sep } from 'node:path';
import type { AdvisorRepoInput, AdvisorSignal } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const GRAPHQL_EXT = new Set(['.graphql', '.gql']);
const SCRIPT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx']);

// ---- máscara de GraphQL ------------------------------------------------------
// Reemplaza comentarios y literales por espacios conservando longitud y
// saltos de línea, para que un `query` dentro de un string o una descripción
// no se confunda con una operación y los offsets sigan mapeando a líneas.

export function maskGraphqlSource(text: string): string {
  const out = text.split('');
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '#') {
      while (i < n && text[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
    } else if (c === '"' && text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end === -1 ? n : end + 3;
      for (let j = i; j < stop; j++) {
        if (out[j] !== '\n') out[j] = ' ';
      }
      i = stop;
    } else if (c === '"' || c === "'") {
      const quote = c;
      out[i] = ' ';
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          out[i] = ' ';
          i++;
          if (i < n && out[i] !== '\n') out[i] = ' ';
          i++;
          continue;
        }
        if (out[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        i++;
      }
    } else {
      i++;
    }
  }
  return out.join('');
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOfIndex(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export interface ParsedOperation {
  readonly operationType: string;
  readonly operationName?: string;
  readonly rootField: string;
  readonly line: number;
}

export interface ParsedGraphqlDocument {
  readonly operations: readonly ParsedOperation[];
  readonly fragments: readonly string[];
  readonly isSdl: boolean;
}

function skipWs(mask: string, i: number): number {
  while (i < mask.length && /\s/.test(mask[i] ?? '')) i++;
  return i;
}

function skipBalanced(mask: string, i: number, open: string, close: string): number {
  let depth = 0;
  while (i < mask.length) {
    const c = mask[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * Parsea un documento GraphQL lo suficiente para derivar llaves
 * `graphql:<op>:<root field>`: operaciones (con su primer campo raíz),
 * fragmentos y si el documento es en realidad SDL (schema/type/directive).
 */
export function parseGraphqlDocument(text: string): ParsedGraphqlDocument {
  const mask = maskGraphqlSource(text);
  const starts = lineStarts(text);
  const operations: ParsedOperation[] = [];

  for (const m of mask.matchAll(/\b(query|mutation|subscription)\b/g)) {
    const keywordAt = m.index ?? 0;
    let i = skipWs(mask, keywordAt + m[0].length);
    let operationName: string | undefined;
    IDENT.lastIndex = i;
    const nameMatch = IDENT.exec(mask);
    if (nameMatch && nameMatch[0] !== 'on') {
      operationName = nameMatch[0];
      i = skipWs(mask, IDENT.lastIndex);
    }
    if (mask[i] === '(') i = skipWs(mask, skipBalanced(mask, i, '(', ')'));
    while (mask[i] === '@') {
      i = skipWs(mask, i + 1);
      IDENT.lastIndex = i;
      const dirMatch = IDENT.exec(mask);
      if (!dirMatch) break;
      i = skipWs(mask, IDENT.lastIndex);
      if (mask[i] === '(') i = skipWs(mask, skipBalanced(mask, i, '(', ')'));
    }
    if (mask[i] !== '{') continue;
    // Primer campo del selection set: `alias: field` cuenta como `field`.
    const j = skipWs(mask, i + 1);
    IDENT.lastIndex = j;
    const fieldMatch = IDENT.exec(mask);
    if (!fieldMatch) continue;
    let rootField = fieldMatch[0];
    const after = skipWs(mask, IDENT.lastIndex);
    if (mask[after] === ':') {
      IDENT.lastIndex = skipWs(mask, after + 1);
      const realField = IDENT.exec(mask);
      if (realField) rootField = realField[0];
    }
    operations.push({
      operationType: m[1] ?? 'query',
      ...(operationName !== undefined ? { operationName } : {}),
      rootField,
      line: lineOfStarts(starts, keywordAt),
    });
  }

  const fragments: string[] = [];
  for (const m of mask.matchAll(/\bfragment\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    fragments.push(m[1] ?? '');
  }

  const isSdl =
    operations.length === 0 &&
    (/^\s*schema\s*\{/m.test(mask) ||
      /^\s*type\s+Query\b/m.test(mask) ||
      /^\s*directive\s+@/m.test(mask) ||
      /^\s*(scalar|enum|interface|union|input)\s+[A-Za-z_]/m.test(mask));

  return { operations, fragments, isSdl };
}

function lineOfStarts(starts: readonly number[], index: number): number {
  return lineOfIndex(starts, index);
}

// ---- señales -----------------------------------------------------------------

const ENV_NAME = /(?:API_URL|BASE_URL|_URL|ENDPOINT|HOST|ORIGIN)/;
const FETCHER_NAME = /fetch/i;
const CODEGEN_FILE = /^(codegen[.-]|graphql\.config\.|\.graphqlrc)/i;
const GENERATED_DIR = /(generated|__generated__|^gql$|^gql\/|^dist$|^build$|^out$)/i;

function toPosix(rel: string): string {
  return rel.split(sep).join('/');
}

function relativeTo(root: string, file: string): string {
  return toPosix(file.slice(root.length + 1));
}

function readTextIfSmall(file: string): string | null {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function scanGraphqlFile(repo: string, rel: string, text: string, out: AdvisorSignal[]): void {
  const parsed = parseGraphqlDocument(text);
  const starts = lineStarts(text);
  if (parsed.operations.length > 0) {
    for (const op of parsed.operations) {
      out.push({
        kind: 'graphql_operations',
        repo,
        file: rel,
        line: op.line,
        derivedKey: `graphql:${op.operationType}:${op.rootField}`,
        operationType: op.operationType,
        ...(op.operationName !== undefined ? { operationName: op.operationName } : {}),
        rootField: op.rootField,
      });
    }
  } else if (parsed.fragments.length > 0 && !parsed.isSdl) {
    // Documento de sólo fragmentos: LAIN no emite nada para él — consumidor
    // invisible. Se reporta como hallazgo, no como hueco de configuración.
    out.push({
      kind: 'fragment_only_document',
      repo,
      file: rel,
      line: 1,
      detail: `fragmentos: ${parsed.fragments.join(', ')}`,
      fragments: parsed.fragments,
    });
  } else if (parsed.isSdl) {
    // Copia de SDL en un repo que no es el provider: envenena el espacio de
    // llaves del provider y dispara graphql_no_op en los consumidores.
    out.push({
      kind: 'sdl_copy',
      repo,
      file: rel,
      line: lineOfStarts(starts, 0),
      detail: parsed.operations.length === 0 ? 'sin operaciones; define tipos/schema' : 'SDL',
    });
  }
}

function scanScriptFile(repo: string, rel: string, text: string, out: AdvisorSignal[]): void {
  const lines = text.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? '';
    for (const m of line.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) {
      const varName = m[1] ?? '';
      if (!ENV_NAME.test(varName)) continue;
      // El var sólo importa si el archivo realmente consume red/graphql.
      if (!/fetch\(|graphql|axios|url/i.test(text)) continue;
      out.push({
        kind: 'env_base_url',
        repo,
        file: rel,
        line: idx + 1,
        envVar: varName,
        detail: `process.env.${varName} como base URL`,
      });
    }
  }
  // Fetcher envuelto: una función cuyo nombre nombra el fetch y que en su
  // cuerpo llama a fetch. Corrobora consumo HTTP aunque el motor no lo vea
  // por la forma de la llamada.
  for (const m of text.matchAll(
    /(?:function\s+|const\s+|let\s+|export\s+function\s+)([A-Za-z_$][\w$]*)/g,
  )) {
    const name = m[1] ?? '';
    if (!FETCHER_NAME.test(name)) continue;
    const at = m.index ?? 0;
    const window_ = text.slice(at, at + 2000);
    if (!/\bfetch\s*\(/.test(window_)) continue;
    const line = text.slice(0, at).split('\n').length;
    out.push({
      kind: 'wrapped_fetcher',
      repo,
      file: rel,
      line,
      detail: `${name} envuelve fetch`,
    });
  }
}

function parseGitignoreDirs(text: string): string[] {
  const dirs: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    // Sólo patrones de directorio con forma de salida generada; el resto
    // (.env, coverage, .next) no es un ciego de código que valga reportar.
    const cleaned = line.replace(/^\//, '').replace(/\/\*$/, '/').replace(/\/$/, '');
    const base = cleaned.split('/').pop() ?? '';
    if (!cleaned.includes('/') && !line.endsWith('/')) continue;
    if (!GENERATED_DIR.test(base) && !GENERATED_DIR.test(cleaned)) continue;
    dirs.push(cleaned);
  }
  return dirs;
}

/**
 * Escanea un checkout completo y devuelve las señales del §4. Recorre todo el
 * árbol (incluidos los gitignored) saltando sólo node_modules y .git.
 */
export function scanRepo(repo: AdvisorRepoInput): AdvisorSignal[] {
  const out: AdvisorSignal[] = [];
  const root = repo.root.replace(/[\\/]+$/, '');

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = posix.join(dir, entry);
      let st: Stats;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relativeTo(root, full);
      const dot = entry.lastIndexOf('.');
      const ext = dot === -1 ? '' : entry.slice(dot).toLowerCase();

      if (entry === '.gitignore') {
        const text = readTextIfSmall(full);
        if (text) {
          for (const dir of parseGitignoreDirs(text)) {
            out.push({
              kind: 'gitignored_generated',
              repo: repo.id,
              file: rel,
              detail: `patrón .gitignore '${dir}/' — el walker de LAIN lo omite; el advisor lo escanea igual${dirExists(full.slice(0, -'.gitignore'.length) + dir) ? '' : ' (ausente en el disco)'}`,
            });
          }
        }
        continue;
      }
      if (CODEGEN_FILE.test(entry)) {
        out.push({
          kind: 'codegen_config',
          repo: repo.id,
          file: rel,
          detail: 'liga operaciones ↔ esquema: el SDL del repo es input, no superficie',
        });
      }
      if (GRAPHQL_EXT.has(ext)) {
        const text = readTextIfSmall(full);
        if (text !== null) scanGraphqlFile(repo.id, rel, text, out);
      } else if (SCRIPT_EXT.has(ext)) {
        const text = readTextIfSmall(full);
        if (text !== null) scanScriptFile(repo.id, rel, text, out);
      }
    }
  };

  walk(root);
  return out;
}

function dirExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
