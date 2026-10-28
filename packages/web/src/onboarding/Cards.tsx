import type * as React from 'react';
import { type BriefingDto, useBriefing } from '../api/hooks.js';

// Capítulos 1 y 2: sin modelo. Todo sale del mismo grafo que dibuja el mapa.

const Loading = (): React.ReactElement => <p className="text-xs text-muted">Reading the map…</p>;

function useBrief(workspaceId: string) {
  const q = useBriefing(workspaceId);
  const b = q.data?.briefing ?? null;
  const unavailable =
    q.data && !b
      ? q.data.meta.source === 'unconfigured'
        ? 'This workspace has no LAIN server configured, so there is no map to describe.'
        : `The map is unavailable (${q.data.meta.error ?? q.data.meta.source}).`
      : q.isError
        ? 'Could not load the orientation.'
        : null;
  return { pending: q.isPending, b, unavailable };
}

export function OrientCard({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const { pending, b, unavailable } = useBrief(workspaceId);
  if (pending) return <Loading />;
  if (unavailable || !b) return <p className="text-xs text-muted">{unavailable}</p>;
  return (
    <div className="space-y-2 text-xs" data-testid="orient-card">
      <p>
        <b>{b.totals.repos} repositories</b>, <b>{b.totals.services} services</b>,{' '}
        <b>{b.totals.contracts} contracts</b> (the interfaces they publish), and{' '}
        <b>{b.totals.relations} service-to-service relations</b> the engine found.
      </p>
      <ul className="space-y-1.5">
        {b.repos.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className="font-semibold hover:text-accent hover:underline"
            >
              {r.name}
            </button>
            {r.services.map((s) => (
              <span key={s.id} className="block text-muted">
                {s.name}: {s.contracts} contract{s.contracts === 1 ? '' : 's'}
                {s.groups[0]
                  ? ` — mostly ${s.groups[0].label.toLowerCase()} (${s.groups[0].count})`
                  : ''}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {b.hubs[0] && (
        <p>
          Everything leans on <b>{b.hubs[0].service}</b>
          {b.hubs[0].repo ? ` (${b.hubs[0].repo})` : ''}: {b.hubs[0].consumerServices} service
          {b.hubs[0].consumerServices === 1 ? '' : 's'} call it, {b.hubs[0].uses} uses in total.
        </p>
      )}
      {b.gaps.map((g) => (
        <p key={g.repo} className="text-warning" data-testid="orient-gap">
          Not fully visible: {g.repo}: {g.reason}.
        </p>
      ))}
    </div>
  );
}

export function DoorsCard({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const { pending, b, unavailable } = useBrief(workspaceId);
  if (pending) return <Loading />;
  if (unavailable || !b) return <p className="text-xs text-muted">{unavailable}</p>;
  const published = b.repos.flatMap((r) => r.services).filter((s) => s.contracts > 0);
  return (
    <div className="space-y-3 text-xs" data-testid="doors-card">
      <section>
        <h5 className="mb-1 font-semibold">What each service exposes</h5>
        <ul className="space-y-1.5">
          {published.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="font-medium hover:text-accent hover:underline"
              >
                {s.name}
              </button>
              <span className="block text-muted">
                {s.groups.map((g) => `${g.count} ${g.label.toLowerCase()}`).join(' · ')}
              </span>
              {s.groups.some((g) => g.note) && (
                <span className="block text-[11px] text-muted">
                  (“{s.groups.find((g) => g.note)?.label}” are route-like strings nobody calls, not
                  real routes.)
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h5 className="mb-1 font-semibold">Who uses what</h5>
        <ul className="space-y-1">
          {b.relations.map((r) => (
            <li key={`${r.from}>${r.to}`}>
              <b>{r.from}</b> → <b>{r.to}</b>: {r.uses} use{r.uses === 1 ? '' : 's'} across{' '}
              {r.contractsUsed} contract{r.contractsUsed === 1 ? '' : 's'}
              {r.inferred > 0 && (
                <span className="text-warning">
                  {' '}
                  ({r.inferred} only inferred{r.deterministic === 0 ? ': check it' : ''})
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {b.topOperations.length > 0 && (
        <section>
          <h5 className="mb-1 font-semibold">The busiest operations</h5>
          <ul className="space-y-0.5">
            {b.topOperations.map((o) => (
              <li key={`${o.service}|${o.key}`} className="font-mono text-[11px]">
                {o.key.replace(/^[a-z]+:/, '')}{' '}
                <span className="font-sans text-muted">
                  · {o.uses} use{o.uses === 1 ? '' : 's'}, {o.consumers} consumer
                  {o.consumers === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
