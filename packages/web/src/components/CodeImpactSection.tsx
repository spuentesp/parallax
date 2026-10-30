import type { CodeImpact, CodeRisk } from '@parallax/shared/domain';
import type * as React from 'react';

// Impacto de CÓDIGO del PR: qué símbolos toca y a cuánto alcanzan según el índice de código del
// motor. Va junto a los hallazgos de contrato, no dentro: son otra medida. Lo que no se pudo
// medir se dice (nota por símbolo y lista de límites), nunca se rellena.

const RISK_STYLE: Record<CodeRisk, string> = {
  high: 'bg-error/15 text-error',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-success/15 text-success',
  unknown: 'bg-bg text-muted',
};
const RISK_ORDER: Record<CodeRisk, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

export function CodeImpactSection({ impact }: { impact: CodeImpact }): React.ReactElement {
  const symbols = impact.symbols ?? [];
  const rows = [...symbols].sort(
    (a, b) =>
      RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || (b.transitive ?? -1) - (a.transitive ?? -1),
  );
  const sk = impact.skipped ?? { tests: 0, nonCode: 0, addedFiles: 0, noDiff: 0, overFileLimit: 0 };
  const skipped = [
    sk.tests > 0 ? `${String(sk.tests)} test file(s)` : '',
    sk.nonCode > 0 ? `${String(sk.nonCode)} non-code file(s)` : '',
    sk.addedFiles > 0 ? `${String(sk.addedFiles)} new file(s)` : '',
    sk.noDiff > 0 ? `${String(sk.noDiff)} file(s) without a diff` : '',
    sk.overFileLimit > 0 ? `${String(sk.overFileLimit)} file(s) over the read limit` : '',
  ].filter(Boolean);

  return (
    <section data-testid="code-impact">
      <h2 className="font-semibold mb-2">
        Code impact <span className="text-muted font-normal">({symbols.length})</span>
      </h2>
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {impact.highestRisk && (
            <span className={`px-2 py-0.5 rounded-full ${RISK_STYLE[impact.highestRisk]}`}>
              highest risk: {impact.highestRisk}
            </span>
          )}
          <span>
            {impact.filesAnalyzed} of {impact.filesChanged} changed file(s) analyzed
            {impact.index.commit ? ` · code index at ${impact.index.commit.slice(0, 7)}` : ''}
          </span>
          {impact.index.matchesBase === false && (
            <span className="px-2 py-0.5 rounded-full bg-warning/15 text-warning">
              index is not at the PR base
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted">No changed symbols were found in the files analyzed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1 pr-3 font-medium">Symbol</th>
                  <th className="py-1 pr-3 font-medium">Direct</th>
                  <th className="py-1 pr-3 font-medium">Transitive</th>
                  <th className="py-1 pr-3 font-medium">Tests</th>
                  <th className="py-1 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={`${s.path}:${s.line}:${s.name}`}
                    className="border-t border-border align-top"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs">
                        {s.name}
                        {s.change === 'removed' ? (
                          <span className="ml-1 text-error">(removed)</span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[11px] text-muted">
                        {s.path}:{s.line}
                      </div>
                      {s.dependents.length > 0 && (
                        <div className="text-[11px] text-muted mt-0.5">
                          called by {s.dependents.map((d) => d.name).join(', ')}
                        </div>
                      )}
                      {s.crossRepoNote && (
                        <div className="text-[11px] text-muted mt-0.5">
                          Cross-repo: {s.crossRepoNote}
                        </div>
                      )}
                      {s.crossRepo && (
                        <div className="text-[11px] text-muted mt-0.5">
                          Cross-repo leaves:{' '}
                          {s.crossRepo.repositories.length
                            ? s.crossRepo.repositories
                                .map((r) => `${r.repo} (${r.leaves.length})`)
                                .join(', ')
                            : 'none indexed'}
                          {s.crossRepo.truncated ? ' (truncated)' : ''} · traversal depth 4
                        </div>
                      )}
                    </td>
                    {s.note ? (
                      <td colSpan={3} className="py-2 pr-3 text-xs text-muted italic">
                        {s.note}
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-3 tabular-nums">{s.direct ?? '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">{s.transitive ?? '—'}</td>
                        <td className="py-2 pr-3 text-xs">
                          {s.untested === null ? '—' : s.untested ? 'untested' : 'tested'}
                        </td>
                      </>
                    )}
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${RISK_STYLE[s.risk]}`}>
                        {s.risk}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul className="text-xs text-muted space-y-0.5 list-disc pl-4">
          {impact.newDefinitions > 0 && (
            <li>
              {impact.newDefinitions} definition(s) added by this PR are not in the code index yet,
              so there are no dependents to measure.
            </li>
          )}
          {(impact.moduleScopeFiles ?? []).length > 0 && (
            <li>
              Changes outside any definition (imports, constants) in{' '}
              <span className="font-mono">{impact.moduleScopeFiles.join(', ')}</span>.
            </li>
          )}
          {skipped.length > 0 && <li>Not analyzed: {skipped.join(', ')}.</li>}
          {(impact.gaps ?? []).map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
