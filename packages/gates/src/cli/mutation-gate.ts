import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AllowlistEntry,
  findStaleEntries,
  gateDecision,
  parseAllowlistFile,
  parseMutationReport,
  partitionRunnable,
  validateAllowlist,
} from '../mutation-gate.js';

const base = process.env.GATE_BASE ?? 'origin/main';
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function changedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
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

// Archivos mutados: sólo los src/*.ts tocados por el diff, agrupados por paquete.
const changedSrc = changedFiles().filter((f) => /^packages\/[^/]+\/src\/.*\.ts$/.test(f));
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

let failed = false;
for (const [pkg, files] of runnable) {
  const args = [
    'exec',
    'stryker',
    'run',
    '--incremental',
    '--incrementalFile',
    '.stryker-tmp/incremental.json',
  ];
  for (const f of files) args.push('--mutate', f);
  execFileSync('pnpm', ['--filter', `@parallax/${pkg}`, ...args], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, TMPDIR: process.env.TMPDIR },
  });
  const reportPath = join(repoRoot, 'packages', pkg, 'reports/mutation/mutation.json');
  const mutants = parseMutationReport(JSON.parse(readFileSync(reportPath, 'utf8')));
  const relevant = mutants.filter((m) => files.includes(m.file));
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
