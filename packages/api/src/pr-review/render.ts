// Cómo se cuenta el impacto de código en GitHub: una frase para el estado del commit y una
// sección de markdown para el comentario (y su vista previa local). Un solo sitio, para que el
// comentario, el estado y la vista previa no digan cosas distintas.

import type { CodeImpact, CodeRisk } from '@parallax/shared/domain';

const RISK_ORDER: Record<CodeRisk, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

/** "Code: 2 symbols, highest risk high." — para el final de la descripción de un estado. */
export function codeImpactSummary(impact: CodeImpact | null | undefined): string | null {
  if (!impact) return null;
  const n = impact.symbols.length;
  if (n === 0) return 'Code: no changed symbols found.';
  const unknown = impact.symbols.filter((s) => s.risk === 'unknown').length;
  const risk =
    impact.highestRisk && impact.highestRisk !== 'unknown' ? impact.highestRisk : 'unknown';
  return `Code: ${String(n)} symbol${n === 1 ? '' : 's'}, highest risk ${risk}${unknown > 0 && risk !== 'unknown' ? ` (${String(unknown)} unmeasured)` : ''}.`;
}

const cell = (text: string): string => text.replace(/\|/g, '\\|');

/** La sección del comentario. Vacía si el PR no tuvo revisión de código. */
export function codeImpactMarkdown(impact: CodeImpact | null | undefined): string[] {
  if (!impact) return [];
  const lines: string[] = ['### Code impact', ''];
  const at = impact.index.commit
    ? ` against the code index at \`${impact.index.commit.slice(0, 7)}\``
    : '';
  if (impact.symbols.length === 0) {
    lines.push(
      `_No changed symbols found in the ${String(impact.filesAnalyzed)} file(s) analyzed${at}._`,
      '',
    );
  } else {
    const risk = impact.highestRisk ?? 'unknown';
    lines.push(
      `${String(impact.symbols.length)} changed symbol(s) measured · highest risk **${risk}**${at}`,
      '',
      '| Symbol | Direct | Transitive | Tests | Risk |',
      '|---|---|---|---|---|',
    );
    const rows = [...impact.symbols].sort(
      (a, b) =>
        RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || (b.transitive ?? -1) - (a.transitive ?? -1),
    );
    for (const s of rows) {
      const symbol = `\`${cell(s.name)}\` \`${cell(s.path)}:${String(s.line)}\`${s.change === 'removed' ? ' (removed)' : ''}`;
      if (s.note) {
        // Sin medida: se dice por qué, no se rellena con números.
        lines.push(`| ${symbol} | — | — | — | _${s.risk}: ${cell(s.note)}_ |`);
        continue;
      }
      const tests = s.untested === null ? '—' : s.untested ? 'untested' : 'tested';
      lines.push(
        `| ${symbol} | ${String(s.direct ?? '—')} | ${String(s.transitive ?? '—')} | ${tests} | **${s.risk}** |`,
      );
    }
    lines.push('');
    for (const s of rows) {
      if (s.crossRepoNote) lines.push(`- Cross-repo impact for \`${s.name}\`: ${s.crossRepoNote}.`);
      if (s.crossRepo) {
        const repos = s.crossRepo.repositories;
        const summary = repos.length
          ? repos.map((r) => `\`${r.repo}\` (${String(r.leaves.length)} leaf path(s))`).join(', ')
          : 'no indexed leaves in other repositories';
        lines.push(
          `- Cross-repo impact for \`${s.name}\`: ${summary}${s.crossRepo.truncated ? ' (truncated)' : ''}.`,
        );
      }
    }
    if (rows.some((s) => s.crossRepo))
      lines.push(
        '- Cross-repo results are indexed traversal leaves at depth 4, not a count of all callers.',
      );
  }
  if (impact.newDefinitions > 0) {
    lines.push(
      `- ${String(impact.newDefinitions)} definition(s) added by this PR are not in the code index yet, so they have no dependents to measure.`,
    );
  }
  if (impact.moduleScopeFiles.length > 0) {
    lines.push(
      `- Changes outside any definition (imports, constants) in: ${impact.moduleScopeFiles.map((f) => `\`${f}\``).join(', ')}.`,
    );
  }
  const sk = impact.skipped;
  const skipped = [
    sk.tests > 0 ? `${String(sk.tests)} test file(s)` : '',
    sk.nonCode > 0 ? `${String(sk.nonCode)} non-code file(s)` : '',
    sk.addedFiles > 0 ? `${String(sk.addedFiles)} new file(s)` : '',
    sk.noDiff > 0 ? `${String(sk.noDiff)} file(s) without a diff` : '',
    sk.overFileLimit > 0 ? `${String(sk.overFileLimit)} file(s) over the read limit` : '',
  ].filter(Boolean);
  if (skipped.length > 0) lines.push(`- Not analyzed: ${skipped.join(', ')}.`);
  for (const g of impact.gaps) lines.push(`- ${g}`);
  lines.push('');
  return lines;
}
