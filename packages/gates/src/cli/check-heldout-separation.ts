import { execFileSync } from 'node:child_process';
import { evaluateCommitSeries, type CommitChange } from '../heldout-separation.js';

const base = process.env.GATE_BASE ?? 'origin/main';

// Un commit por entrada: asunto + archivos. El bootstrap de la suite held-out
// es legal sólo si implementación y oráculo viajan en commits separados y los
// commits de oráculo declaran `red-team` en el asunto.
function changedCommits(): CommitChange[] {
  const out = execFileSync('git', ['log', '--reverse', '--format=%x00%s', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out
    .split('\u0000')
    .map((chunk) => chunk.split('\n').map((l) => l.trim()).filter((l) => l.length > 0))
    .filter((lines) => lines.length > 0)
    .map((lines) => ({ subject: lines[0] ?? '', files: lines.slice(1) }));
}

const report = evaluateCommitSeries(changedCommits());
if (report.violation) {
  console.error('HELDOUT SEPARATION VIOLATION:');
  for (const reason of report.reasons) console.error(`  - ${reason}`);
  console.error(
    '  El oráculo de aceptación sólo cambia en commits red-team (docs/testing/red-team-protocol.md).',
  );
  process.exit(1);
}
console.log(
  `heldout-separation ok (${report.implFiles.length} impl, ${report.heldoutFiles.length} held-out)`,
);
