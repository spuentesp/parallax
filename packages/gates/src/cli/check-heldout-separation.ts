import { execFileSync } from 'node:child_process';
import { evaluateDiff } from '../heldout-separation.js';

const base = process.env.GATE_BASE ?? 'origin/main';

function changedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const report = evaluateDiff(changedFiles());
if (report.violation) {
  console.error('HELDOUT SEPARATION VIOLATION: un changeset toca implementación y test-heldout.');
  console.error(`  implementación: ${report.implFiles.join(', ')}`);
  console.error(`  held-out: ${report.heldoutFiles.join(', ')}`);
  console.error(
    '  El oráculo de aceptación sólo cambia en changesets red-team (docs/testing/red-team-protocol.md).',
  );
  process.exit(1);
}
console.log(
  `heldout-separation ok (${report.implFiles.length} impl, ${report.heldoutFiles.length} held-out)`,
);
