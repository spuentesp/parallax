import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AllowlistEntry,
  batchCacheKey,
  changedLineRanges,
  chunk,
  fileOfSpec,
  findStaleEntries,
  gateDecision,
  isMutableSourceFile,
  type LineRange,
  type MutantSummary,
  mutationRangeSpec,
  parseAllowlistFile,
  parseMutationReport,
  partitionRunnable,
  validateAllowlist,
} from '../mutation-gate.js';

const base = process.env.GATE_BASE ?? 'origin/main';
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// El diff de un cambio grande (lockfiles incluidos) supera el buffer por defecto
// de 1 MB de execFileSync: sin maxBuffer el gate revienta con ENOBUFS.
function git(...args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
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

// Sólo las líneas que el diff añade o modifica: el gate mide el cambio, no los
// archivos enteros (mutar archivos completos agotó la memoria y tardaba horas).
// `--diff-filter=d` excluye los borrados.
const diff = git('diff', '--unified=0', '--diff-filter=d', `${base}...HEAD`);
const rangesByFile = changedLineRanges(diff);

// Fuentes mutables del cambio, agrupadas por paquete (rutas relativas al paquete).
const byPackage = new Map<string, Map<string, LineRange[]>>();
for (const [f, ranges] of rangesByFile) {
  if (!isMutableSourceFile(f) || ranges.length === 0) continue;
  const pkg = f.split('/')[1] ?? '';
  const rel = f.slice(`packages/${pkg}/`.length);
  if (!byPackage.has(pkg)) byPackage.set(pkg, new Map());
  byPackage.get(pkg)?.set(rel, ranges);
}

if (byPackage.size === 0) {
  console.log('mutation-gate: no changed src lines — nothing to mutate');
  process.exit(0);
}

// Sólo se mutan paquetes con stryker.config.json; el resto se salta con aviso.
const configured = new Set(
  [...byPackage.keys()].filter((pkg) =>
    existsSync(join(repoRoot, 'packages', pkg, 'stryker.config.json')),
  ),
);
const { runnable, skipped } = partitionRunnable(
  new Map([...byPackage].map(([pkg, files]) => [pkg, [...files.keys()]])),
  configured,
);
for (const pkg of skipped) {
  console.warn(`mutation-gate: skipping @parallax/${pkg} — no stryker.config.json`);
}
if (runnable.size === 0) {
  console.log(
    'mutation-gate: no changed src lines in mutation-tested packages — nothing to mutate',
  );
  process.exit(0);
}

// Lotes de especificaciones `archivo:inicio-fin`. Cada lote es un proceso de
// Stryker aparte, así que la memoria se libera entre lotes. Un `--mutate` por
// rango no acumula (Stryker conserva sólo el último), por eso cada lote va en
// una sola lista separada por comas.
const BATCH_SIZE = Number(process.env.MUTATION_BATCH_SIZE ?? 6);
const cacheDir = join(repoRoot, 'node_modules', '.cache', 'mutation-gate');

/**
 * Clave de caché del lote, o null si el paquete o sus lockfiles tienen cambios
 * sin commitear: el resultado no corresponde a ningún commit y no se reutiliza.
 */
function cacheKeyFor(pkg: string, specs: string[]): string | null {
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
    files: specs,
  });
}

/** Reporte JSON del lote: desde caché si las entradas son idénticas, si no corriendo Stryker. */
function reportForBatch(pkg: string, specs: string[]): string {
  const key = cacheKeyFor(pkg, specs);
  const cached = key ? join(cacheDir, `${key}.json`) : null;
  if (cached && existsSync(cached)) {
    console.log(`  cache hit @parallax/${pkg}: ${specs.length} range(s)`);
    return readFileSync(cached, 'utf8');
  }
  execFileSync(
    'pnpm',
    ['--filter', `@parallax/${pkg}`, 'exec', 'stryker', 'run', '--mutate', specs.join(',')],
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
for (const [pkg, fileRanges] of byPackage) {
  if (!runnable.has(pkg)) continue;
  const specs = [...fileRanges].flatMap(([file, ranges]) =>
    ranges.map((r) => mutationRangeSpec(file, r)),
  );
  const files = [...fileRanges.keys()];

  const relevant: MutantSummary[] = [];
  for (const batch of chunk(specs, BATCH_SIZE)) {
    const batchFiles = new Set(batch.map(fileOfSpec));
    const mutants = parseMutationReport(JSON.parse(reportForBatch(pkg, batch)));
    relevant.push(...mutants.filter((m) => batchFiles.has(m.file)));
  }

  // Un archivo con líneas cambiadas que no produce mutantes puede salirse del
  // alcance sin que nadie lo note. Un barrel sin lógica es legítimo: sólo se avisa.
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
      `  warning: stale allowlist entry ${stale.file} ${stale.mutator} — matched no mutant in the changed lines; remove or rewrite it`,
    );
  }
  for (const m of decision.blocked) {
    console.error(`  BLOCKED ${m.file}:${m.line} ${m.mutator} (${m.status}) ${m.description}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
