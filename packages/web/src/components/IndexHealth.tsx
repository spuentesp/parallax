import type { CoverageLedgerDto, RepoLedgerDto } from '../api/hooks.js';

// Lo que el motor dice de su propio índice: por repo, los sensores que corrieron, los
// archivos que se saltó y los sitios que no puede ver. Todo viene de `get_coverage`
// (vista viva, Lain >= 0.16); aquí no se calcula ni se estima nada.

const BLIND_SPOT_HINT: Record<string, string> = {
  OrmDynamicQuery: 'ORM queries built at runtime: the table they touch is not visible.',
  DynamicSql: 'SQL assembled at runtime.',
  FrontendValueUnclassified: 'Frontend values the engine could not classify.',
};

const n = (v: number): string => v.toLocaleString('en-US');

export function IndexHealth({
  ledger,
}: {
  ledger: CoverageLedgerDto | undefined;
}): React.ReactElement | null {
  if (ledger?.source !== 'lain' || ledger.repos.length === 0) return null;
  const spots = blindSpotTotals(ledger.repos);
  return (
    <>
      <NotComplete ledger={ledger} />
      <section
        aria-label="Index health by repo"
        className="rounded-xl border border-border bg-surface"
        data-testid="index-health"
      >
        <h2 className="border-b border-border p-3 text-sm font-semibold">Index health by repo</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Repo
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Health
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Sensors that ran
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Skipped files
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.repos.map((r) => (
                <RepoRow key={r.repo} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {spots.length > 0 && (
        <section
          aria-label="Known blind spots"
          className="rounded-xl border border-border bg-surface p-4"
          data-testid="blind-spots"
        >
          <h2 className="text-sm font-semibold">Known blind spots</h2>
          <p className="mt-1 text-xs text-muted">
            Places where the static graph cannot see the target. Empty results here are not evidence
            of safety.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {spots.map((s) => (
              <li key={`${s.repo}|${s.reason}`} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="font-mono text-xs">{s.reason}</b>
                  <span className="tabular-nums">{n(s.count)}</span>
                  <span className="text-xs text-muted">in {s.repo}</span>
                </div>
                {BLIND_SPOT_HINT[s.reason] && (
                  <p className="text-xs text-muted">{BLIND_SPOT_HINT[s.reason]}</p>
                )}
                {s.directories.length > 0 && (
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    Mostly in {s.directories.map((d) => `${d.path} (${n(d.count)})`).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function blindSpotTotals(repos: RepoLedgerDto[]) {
  return repos
    .flatMap((r) => r.blindSpots.map((b) => ({ repo: r.repo, ...b })))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// `complete: false` is the engine declining to claim full coverage; say why, with its own counts.
function NotComplete({ ledger }: { ledger: CoverageLedgerDto }): React.ReactElement | null {
  if (ledger.complete !== false) return null;
  const g = ledger.gaps;
  const parts = [
    g.unresolvedConsumers > 0 &&
      `${n(g.unresolvedConsumers)} unresolved consumer${g.unresolvedConsumers === 1 ? '' : 's'}`,
    g.ambiguous > 0 && `${n(g.ambiguous)} ambiguous`,
    g.blindSpotSites > 0 && `${n(g.blindSpotSites)} sites the analysis cannot see into`,
    g.urlDefaults > 0 &&
      `${n(g.urlDefaults)} URL${g.urlDefaults === 1 ? '' : 's'} taken from an environment default`,
  ].filter(Boolean);
  return (
    <p
      className="rounded-lg border border-border bg-surface p-4 text-sm text-muted"
      data-testid="not-complete"
    >
      <b className="text-fg">The engine does not claim complete coverage</b>
      {parts.length > 0 ? `: ${parts.join(', ')}.` : '.'} Every repo can be fully indexed and still
      leave these open, so a claim of &quot;no impact&quot; holds only within what was analyzed.
    </p>
  );
}

function RepoRow({ r }: { r: RepoLedgerDto }): React.ReactElement {
  const skipped = r.skips.reduce((total, s) => total + s.count, 0);
  const ok = r.state === 'indexed';
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{r.repo}</div>
        {r.languages.length > 0 && (
          <div className="text-xs text-muted">{r.languages.join(', ')}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${ok ? 'bg-accent-soft text-accent' : 'bg-error/10 text-error'}`}
        >
          {r.state}
        </span>
        {r.error && <div className="mt-1 text-xs text-error">{r.error}</div>}
      </td>
      <td className="px-3 py-2">
        <ul className="flex flex-wrap gap-1">
          {r.sensors.map((s) => (
            <li
              key={s.name}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-xs"
            >
              {s.name} <span className="text-muted">{n(s.count)}</span>
            </li>
          ))}
          {r.sensors.length === 0 && <li className="text-xs text-muted">none reported</li>}
        </ul>
      </td>
      <td className="px-3 py-2 text-xs">
        {skipped === 0 ? (
          <span className="text-muted">0</span>
        ) : (
          <ul>
            {r.skips.map((s) => (
              <li key={s.reason}>
                <span className="tabular-nums">{n(s.count)}</span> {s.reason}
                {s.samplePaths[0] && <span className="text-muted"> · e.g. {s.samplePaths[0]}</span>}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
