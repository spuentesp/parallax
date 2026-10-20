import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AllowlistEntry,
  batchCacheKey,
  chunk,
  findStaleEntries,
  gateDecision,
  isMutableSourceFile,
  type MutantSummary,
  parseAllowlistFile,
  parseMutationReport,
  partitionRunnable,
  validateAllowlist,
} from '../mutation-gate.js';

const base = process.env.GATE_BASE ?? 'origin/main';
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function changedFiles(): string[] {
  // `d` excluye los archivos borrados: no hay nada que mutar en ellos.
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const allowlistPath = join(repoRoot, 'mutation-allowlist.json');
let allowlist: AllowlistEntry[] = [];
if (existsSync(allowlistPath)) {
  const parsed = parseAllowlistFile(readFileSync(allowlistPath, 'utf8'));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  allowlist = parsed.entries;
}
const problems = validateAllowlist(allowlist);
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

// Archivos mutados: sólo las fuentes de producción (.ts/.tsx) tocadas por el
// diff, agrupadas por paquete.
const changedSrc = changedFiles().filter(isMutableSourceFile);
const byPackage = new Map<string, string[]>();
for (const f of changedSrc) {
  const pkg = f.split('/')[1] ?? '';
  const rel = f.slice(`packages/${pkg}/`.length);
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg)?.push(rel);
}

if (byPackage.size === 0) {
  console.log('mutation-gate: no changed src files — nothing to mutate');
  process.exit(0);
}

// Sólo se mutan paquetes con stryker.config.json; el resto se salta con aviso
// (antes el gate reventaba en cuanto un PR tocaba gates/mcp/web).
const configured = new Set(
  [...byPackage.keys()].filter((pkg) =>
    existsSync(join(repoRoot, 'packages', pkg, 'stryker.config.json')),
  ),
);
const { runnable, skipped } = partitionRunnable(byPackage, configured);
for (const pkg of skipped) {
  console.warn(`mutation-gate: skipping @parallax/${pkg} — no stryker.config.json`);
}
if (runnable.size === 0) {
  console.log(
    'mutation-gate: no changed src files in mutation-tested packages — nothing to mutate',
  );
  process.exit(0);
}

// Lotes: mutar todos los archivos en un solo proceso de Stryker agotó la memoria.
// Cada lote es un proceso aparte, así que la memoria se libera entre lotes.
// Un `--mutate` por archivo no acumula (Stryker conserva sólo el último), por eso
// cada lote va en una sola lista separada por comas.
const BATCH_SIZE = Number(process.env.MUTATION_BATCH_SIZE ?? 6);
const cacheDir = join(repoRoot, 'node_modules', '.cache', 'mutation-gate');

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot }).trim();
}

/**
 * Clave de caché del lote, o null si el paquete o sus lockfiles tienen cambios
 * sin commitear: en ese caso el resultado no corresponde a ningún commit y no
 * se reutiliza nada.
 */
function cacheKeyFor(pkg: string, batch: string[]): string | null {
  const dirty = git(
    'status',
    '--porcelain',
    '--',
    `packages/${pkg}`,
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  );
  if (dirty.length > 0) return null;
  return batchCacheKey({
    packageTree: git('rev-parse', `HEAD:packages/${pkg}`),
    lockfiles: `${git('rev-parse', 'HEAD:pnpm-lock.yaml')} ${git('rev-parse', 'HEAD:pnpm-workspace.yaml')}`,
    files: batch,
  });
}

/** Reporte JSON del lote: desde caché si las entradas son idénticas, si no corriendo Stryker. */
function reportForBatch(pkg: string, batch: string[]): string {
  const key = cacheKeyFor(pkg, batch);
  const cached = key ? join(cacheDir, `${key}.json`) : null;
  if (cached && existsSync(cached)) {
    console.log(`  cache hit @parallax/${pkg}: ${batch.length} file(s)`);
    return readFileSync(cached, 'utf8');
  }
  execFileSync(
    'pnpm',
    ['--filter', `@parallax/${pkg}`, 'exec', 'stryker', 'run', '--mutate', batch.join(',')],
    { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, TMPDIR: process.env.TMPDIR } },
  );
  const text = readFileSync(
    join(repoRoot, 'packages', pkg, 'reports/mutation/mutation.json'),
    'utf8',
  );
  if (cached) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, text);
  }
  return text;
}

let failed = false;
for (const [pkg, files] of runnable) {
  const relevant: MutantSummary[] = [];
  for (const batch of chunk(files, BATCH_SIZE)) {
    const mutants = parseMutationReport(JSON.parse(reportForBatch(pkg, batch)));
    relevant.push(...mutants.filter((m) => batch.includes(m.file)));
  }
  // Un archivo cambiado sin ningún mutante se sale del alcance del gate sin que
  // nadie lo note (antes pasaba con los archivos sin tests relacionados). Un
  // barrel de re-exportaciones no tiene mutantes y es legítimo: sólo se avisa.
  const mutatedFiles = new Set(relevant.map((m) => m.file));
  for (const f of files.filter((f) => !mutatedFiles.has(f))) {
    console.warn(`  warning: ${f} produced no mutants — verify it has nothing to mutate`);
  }
  const decision = gateDecision(relevant, allowlist, `@parallax/${pkg}`);
  console.log(
    `mutation-gate ${pkg}: ${relevant.length} mutants, ${decision.allowlisted.length} allowlisted, ${decision.blocked.length} blocked`,
  );
  for (const m of decision.allowlisted) {
    console.log(`  allowlisted ${m.file}:${m.line} ${m.mutator} (${m.status})`);
  }
  for (const stale of findStaleEntries(allowlist, relevant, `@parallax/${pkg}`)) {
    console.warn(
      `  warning: stale allowlist entry ${stale.file} ${stale.mutator} — matched no mutant; remove or rewrite it`,
    );
  }
  for (const m of decision.blocked) {
    console.error(`  BLOCKED ${m.file}:${m.line} ${m.mutator} (${m.status}) ${m.description}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
