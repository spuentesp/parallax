import type * as React from 'react';
import { useState } from 'react';
import { type DocEntryDto, type DocKindDto, useBriefing, useDocs } from '../api/hooks.js';

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

// Capítulo 5: lo que el equipo dejó escrito. Sin modelo: lista leída del motor (título y primer
// párrafo de cada archivo); "Explain" pide al asistente que LEA ese archivo y lo relacione con la tarea.

const KIND_LABEL: Record<DocKindDto, string> = {
  conventions: 'Conventions for working here',
  decision: 'Decisions (ADRs)',
  domain: 'Domain vocabulary',
  guide: 'Guides',
  readme: 'Readme',
  security: 'Security',
};
const KIND_ORDER: DocKindDto[] = [
  'conventions',
  'decision',
  'domain',
  'guide',
  'readme',
  'security',
];
const SHOWN = 4;

export function DocsCard({
  workspaceId,
  onExplain,
}: {
  workspaceId: string;
  onExplain: (doc: DocEntryDto) => void;
}): React.ReactElement {
  const q = useDocs(workspaceId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (q.isPending)
    return <p className="text-xs text-muted">Reading the repositories’ own documentation…</p>;
  if (q.isError || !q.data || q.data.source !== 'lain') {
    return (
      <p className="text-xs text-muted">
        {q.data?.source === 'unconfigured'
          ? 'This workspace has no LAIN server configured, so there is no documentation to list.'
          : 'Could not read the documentation.'}
      </p>
    );
  }
  const docs = q.data.docs;
  if (docs.length === 0) {
    return (
      <p className="text-xs text-muted" data-testid="docs-card">
        No documentation files were found in the indexed repositories. That is itself worth knowing:
        what the team decided lives only in people’s heads or in the code.
      </p>
    );
  }
  const repos = [...new Set(docs.map((d) => d.repo))];
  return (
    <div className="space-y-3 text-xs" data-testid="docs-card">
      <p>
        <b>{docs.length} documents</b> the team wrote, read from the repositories. Pick one and I
        will read it and tell you what matters for your task.
      </p>
      {repos.map((repo) => (
        <section key={repo}>
          <h5 className="mb-1 font-semibold">{repo}</h5>
          {KIND_ORDER.map((kind) => {
            const list = docs.filter((d) => d.repo === repo && d.kind === kind);
            if (list.length === 0) return null;
            const key = `${repo}:${kind}`;
            const all = open.has(key);
            return (
              <div key={kind} className="mb-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">
                  {KIND_LABEL[kind]} · {list.length}
                </p>
                <ul className="space-y-1.5">
                  {(all ? list : list.slice(0, SHOWN)).map((d) => (
                    <li key={d.path} data-testid={`doc-${d.path}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium break-words">{d.title || d.path}</span>
                          <span className="block break-all font-mono text-[10px] text-muted">
                            {d.path}
                          </span>
                          {d.summary && <span className="block text-muted">{d.summary}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => onExplain(d)}
                          className="shrink-0 rounded-full border border-border px-2 py-0.5 hover:border-accent hover:text-accent"
                        >
                          Explain
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {list.length > SHOWN && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (all) n.delete(key);
                        else n.add(key);
                        return n;
                      })
                    }
                    className="mt-1 text-accent hover:underline"
                  >
                    {all ? 'Show fewer' : `Show all ${list.length}`}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
