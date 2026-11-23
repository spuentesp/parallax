import type * as React from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type CoverageClassId,
  type LooseEndDto,
  useCheckBinding,
  useCoverageBreakdown,
  useCoverageLedger,
  useLooseEnds,
  useRepoStatus,
} from '../api/hooks.js';
import { IndexHealth } from '../components/IndexHealth.js';

// Cobertura y cabos sueltos (referencia "Coverage and loose ends"): lo que el
// motor no pudo resolver. Una afirmación de "sin impacto" sólo vale si esta
// lista no contiene un candidato que pudiera coincidir. Todo sale de los mismos
// datos que el panel del mapa (loose-ends y estado de los repos); lo que la
// referencia ilustra sin motor detrás (zonas ciegas, escribir un enlace
// confirmado) no se inventa aquí.
const HEALTH_LABEL = {
  indexed: 'ready',
  unreviewed: 'not reviewed',
  not_in_lain: 'not in the engine',
} as const;

export function Coverage(): React.ReactElement {
  const { orgId } = useParams<{ orgId: string }>();
  const loose = useLooseEnds(orgId);
  const status = useRepoStatus(orgId);
  const [reason, setReason] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [klass, setKlass] = useState<CoverageClassId | null>(null);
  const breakdown = useCoverageBreakdown(orgId);
  const ledger = useCoverageLedger(orgId).data;
  const byKey = breakdown.data?.byKey ?? {};

  const report = loose.data;
  const items = report?.source === 'lain' ? report.items : [];
  const unresolved = items.filter((i) => i.kind === 'unresolved');
  const inferred = items.filter((i) => i.kind === 'inferred');
  // El motor marca lo ambiguo con su propia razón; tener varios candidatos no lo es
  // (un topic dinámico puede casar con 80 y no por eso es ambiguo).
  const ambiguous = items.filter((i) => i.reason === 'ambiguous');
  // Los filtros se componen: las cuentas de las razones son las de la clase elegida.
  const inClass = unresolved.filter((i) => klass === null || byKey[i.key] === klass);
  const reasons = new Map<string, number>();
  for (const i of inClass) reasons.set(i.reason, (reasons.get(i.reason) ?? 0) + 1);
  const rows = inClass.filter((i) => reason === null || i.reason === reason);

  const selected = unresolved.find((i) => i.key === selectedKey) ?? null;
  const repos = status.data?.repos ?? [];
  const ready = repos.filter((r) => r.state === 'indexed').length;
  const ask = encodeURIComponent('What could the engine not resolve, and what does that hide?');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6 pb-24" data-testid="coverage-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold">Coverage and loose ends</h1>
          <p className="mt-1 text-sm text-muted">
            What the engine could not resolve. A claim of &quot;no impact&quot; is only valid when
            this list does not contain a candidate that could match.
          </p>
        </div>
        <Link
          to={`/orgs/${orgId}?ask=${ask}`}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-accent hover:bg-accent-soft"
        >
          Ask about coverage
        </Link>
      </div>

      {report && report.source !== 'lain' && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          {report.source === 'unconfigured'
            ? 'This workspace has no LAIN server configured, so there is nothing to measure yet.'
            : `LAIN error: ${report.error ?? 'unreachable'}.`}
        </p>
      )}
      {loose.isError && <p className="text-sm text-error">Could not load loose ends.</p>}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          value={status.data ? `${ready} of ${repos.length}` : '…'}
          label="repos indexed and ready"
        />
        <Stat value={report ? String(unresolved.length) : '…'} label="unresolved consumers" />
        <Stat value={report ? String(ambiguous.length) : '…'} label="ambiguous, never auto-bound" />
        <Stat value={report ? String(inferred.length) : '…'} label="bound only by heuristic" />
      </dl>

      <Breakdown
        data={breakdown.data}
        loading={breakdown.isPending}
        selected={klass}
        onSelect={(c) => setKlass(c === klass ? null : c)}
      />

      <IndexHealth ledger={ledger} />

      <Accounted ledger={ledger} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Loose ends" className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <h2 className="mr-2 text-sm font-semibold">Unresolved consumers</h2>
            <fieldset
              className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
              aria-label="Filter by reason"
            >
              <Chip on={reason === null} onClick={() => setReason(null)}>
                All {inClass.length}
              </Chip>
              {[...reasons].map(([r, n]) => (
                <Chip key={r} on={reason === r} onClick={() => setReason(reason === r ? null : r)}>
                  {r} {n}
                </Chip>
              ))}
            </fieldset>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Call site
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Repo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Could match
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr
                    key={i.key}
                    className={`border-t border-border ${i.key === selectedKey ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <button
                        type="button"
                        aria-pressed={i.key === selectedKey}
                        onClick={() => setSelectedKey(i.key === selectedKey ? null : i.key)}
                        title="Propose a binding for this call site"
                        className="text-left hover:text-accent"
                      >
                        {i.path}
                        {i.line ? `:${i.line}` : ''}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{i.repo}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                        {i.reason}
                      </span>
                    </td>
                    <td
                      className="max-w-[22rem] px-3 py-2 font-mono text-xs text-muted"
                      title={i.candidates.join('\n')}
                    >
                      {i.candidates.length > 0 ? (
                        <span className="block truncate">{i.candidates[0]}</span>
                      ) : (
                        '—'
                      )}
                      {i.candidateCount > 1 && (
                        <span className="text-[11px]">+{i.candidateCount - 1} more candidates</span>
                      )}
                    </td>
                  </tr>
                ))}
                {report?.source === 'lain' && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-sm text-muted">
                      The engine reports no unresolved consumers.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <ResolvePanel key={selected?.key ?? 'none'} orgId={orgId} item={selected} />
      </div>

      {inferred.length > 0 && (
        <section
          aria-label="Bound only by heuristic"
          className="rounded-xl border border-border bg-surface"
        >
          <h2 className="border-b border-border p-3 text-sm font-semibold">
            Bound only by heuristic{' '}
            <span className="font-normal text-muted">({inferred.length})</span>
          </h2>
          <p className="border-b border-border px-3 py-2 text-xs text-muted">
            The engine linked these by a heuristic, with a confidence score. They are shown as
            inferred on the map, never as proven.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Call site
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Repo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Bound to
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {inferred.map((i) => (
                  <tr key={i.key} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">
                      {i.path}
                      {i.line ? `:${i.line}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{i.repo}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {[i.detail.targetService, i.detail.endpoint].filter(Boolean).join(' · ') ||
                        '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-warning">
                      {i.detail.confidence !== undefined ? i.detail.confidence.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section
        aria-label="Repository index health"
        className="rounded-xl border border-border bg-surface"
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
                  Indexed commit
                </th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.state === 'indexed'
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {HEALTH_LABEL[r.state]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">
                    {r.commit ? r.commit.slice(0, 8) : '—'}
                    {r.dirty ? ' · dirty' : ''}
                  </td>
                </tr>
              ))}
              {status.data && repos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-sm text-muted">
                    No repositories in this workspace yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs ${
        on
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border-strong text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

const REASON_TEXT: Record<string, string> = {
  same_service: 'the call site and the endpoint are in the same service',
  catch_all_route:
    'the endpoint is a catch-all route (such as "/") or an external target, which does not show a real dependency',
  template_mismatch: 'the URL template of the call does not match this endpoint',
  field_mismatch: 'the fields the call uses do not match this endpoint',
};

// "Resolve this call site" (referencia): se elige a qué endpoint llama, el motor
// valida el vínculo (check_binding, puro) y, si lo acepta, da la entrada de
// repos.yaml#bindings que lo confirmaría. Parallax no escribe esa entrada: es un
// cambio en la configuración del repo y lo hace quien la mantiene.
function ResolvePanel({
  orgId,
  item,
}: {
  orgId: string | undefined;
  item: LooseEndDto | null;
}): React.ReactElement {
  const check = useCheckBinding(orgId);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const refs = item?.candidateRefs ?? [];
  const shown = refs.filter((r) => r.key.toLowerCase().includes(filter.trim().toLowerCase()));
  const result = check.data;

  const pick = (ref: { key: string; service: string }) => {
    if (!item?.consumerId) return;
    setPicked(`${ref.service}|${ref.key}`);
    setCopied(false);
    check.mutate({ consumer: item.consumerId, endpoint: { key: ref.key, service: ref.service } });
  };

  return (
    <aside
      aria-label="Propose a binding"
      className="h-fit rounded-xl border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-semibold">Resolve this call site</h2>
      {!item ? (
        <p className="mt-2 text-xs text-muted">
          Pick a row to see the endpoints the engine considered, and ask it whether a link would
          hold.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="font-mono text-xs">
            {item.path}
            {item.line ? `:${item.line}` : ''} · {item.repo}
          </div>
          {!item.consumerId || refs.length === 0 ? (
            <p className="text-xs text-muted">
              The engine offered no candidate endpoints for this call site, so there is nothing to
              propose. It may be a call to something outside the workspace.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                Pick the endpoint it calls. The engine checks the link; nothing is written.
              </p>
              {refs.length > 8 && (
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter candidates"
                  placeholder={`Filter ${refs.length} candidates`}
                  className="h-8 w-full rounded-lg border border-border-strong bg-surface-2 px-2 text-xs outline-none focus:border-accent"
                />
              )}
              <div
                role="radiogroup"
                aria-label="Candidate endpoints"
                className="max-h-56 space-y-1 overflow-y-auto"
              >
                {shown.map((r) => {
                  const id = `${r.service}|${r.key}`;
                  return (
                    <label
                      key={id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 font-mono text-xs ${
                        picked === id ? 'border-accent bg-accent-soft' : 'border-border-strong'
                      }`}
                    >
                      <input
                        type="radio"
                        name="candidate"
                        checked={picked === id}
                        onChange={() => pick(r)}
                      />
                      <span className="truncate" title={r.key}>
                        {r.key}
                      </span>
                    </label>
                  );
                })}
                {shown.length === 0 && <p className="text-xs text-muted">No candidate matches.</p>}
              </div>
              {item.candidateCount > refs.length && (
                <p className="text-[11px] text-muted">
                  Showing {refs.length} of {item.candidateCount} candidates.
                </p>
              )}
            </>
          )}

          {check.isPending && <p className="text-xs text-muted">Asking the engine…</p>}
          {check.isError && <p className="text-xs text-error">Could not reach the engine.</p>}
          {result && result.source !== 'lain' && (
            <p className="text-xs text-muted">
              {result.source === 'unconfigured'
                ? 'This workspace has no LAIN server configured.'
                : `LAIN error: ${result.error ?? 'unreachable'}.`}
            </p>
          )}
          {result?.source === 'lain' && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-xs ${
                result.valid ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10'
              }`}
              data-testid="binding-result"
            >
              <b className={result.valid ? 'text-success' : 'text-warning'}>
                {result.valid ? 'The engine accepts this link' : 'The engine rejects this link'}
              </b>
              {result.valid && (
                <span className="text-muted"> · template {result.templateMatch}</span>
              )}
              {result.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted">
                  {result.reasons.map((r) => (
                    <li key={r}>{REASON_TEXT[r] ?? r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result?.valid && result.bindingsEntry && (
            <div>
              <div className="mb-1 text-[11px] text-muted">
                Entry for <span className="font-mono">repos.yaml</span> under{' '}
                <span className="font-mono">bindings</span>
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-[11px]">
                {result.bindingsEntry}
              </pre>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.bindingsEntry ?? '');
                  setCopied(true);
                }}
                className="mt-2 rounded-lg border border-border-strong px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
              >
                {copied ? 'Copied' : 'Copy YAML'}
              </button>
              <p className="mt-2 text-[11px] text-muted">
                Parallax does not write this: it is a change to the repo configuration. The next
                index with it shows the link as confirmed.
              </p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

const BAR: Record<CoverageClassId, string> = {
  fixable: 'bg-success',
  rejected: 'bg-warning',
  no_candidate: 'bg-warning/70',
  dynamic: 'bg-warning/50',
  internal: 'bg-border-strong',
  outside: 'bg-border-strong/70',
  test_or_tooling: 'bg-border',
  heuristic: 'bg-inferred/60',
  unexamined: 'bg-border/60',
};

// "Qué son": el titular de sin resolver mezcla cosas distintas. Cada clase sale del
// veredicto del motor o de la categoría del sitio, y dice si hay algo que hacer.
function Breakdown({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: ReturnType<typeof useCoverageBreakdown>['data'];
  loading: boolean;
  selected: CoverageClassId | null;
  onSelect: (c: CoverageClassId) => void;
}): React.ReactElement | null {
  if (loading) return <p className="text-xs text-muted">Classifying the loose ends…</p>;
  if (data?.source !== 'lain' || data.total === 0) return null;
  return (
    <section
      aria-label="What the loose ends are"
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="coverage-breakdown"
    >
      <h2 className="text-sm font-semibold">
        {data.gaps} of {data.total} loose ends are real gaps in product code
      </h2>
      <p className="mt-1 text-xs text-muted">
        The rest are tests, tooling, calls inside one service and the like: the engine reports them
        too, but they do not hide who depends on whom.
      </p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg" aria-hidden="true">
        {data.classes.map((c) => (
          <div
            key={c.id}
            className={BAR[c.id]}
            style={{ width: `${(c.count / data.total) * 100}%` }}
            title={`${c.count} · ${c.label}`}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {data.classes.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={selected === c.id}
              disabled={c.id === 'heuristic'}
              onClick={() => onSelect(c.id)}
              title={c.hint}
              className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-default ${
                selected === c.id
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${BAR[c.id]}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block">
                  <b className="tabular-nums">{c.count}</b> {c.label}
                  {c.gap && <span className="ml-1.5 text-[10px] text-warning">gap</span>}
                </span>
                <span className="block text-[11px] text-muted">{c.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Lo que el motor YA contabiliza y no necesita resolverse: las llamadas a hosts externos
// (fuera de la federación) no cuentan como sin resolver, y se muestran para que se vea
// qué se dio por externo. Los endpoints sin esquema son un límite aparte: de ellos no se
// puede mostrar qué campos lee cada consumidor.
function Accounted({
  ledger,
}: {
  ledger: ReturnType<typeof useCoverageLedger>['data'];
}): React.ReactElement | null {
  if (ledger?.source !== 'lain') return null;
  if (ledger.external.length === 0 && ledger.schemalessEndpoints === 0) return null;
  return (
    <section
      aria-label="Already accounted for"
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="coverage-accounted"
    >
      <h2 className="text-sm font-semibold">What the engine already accounts for</h2>
      {ledger.external.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">
            Calls to these hosts are classified as external (outside the workspace), so they are not
            counted as unresolved. A host held in a variable is resolved when it has a literal
            default; a base URL read only from the environment is not seen as external and stays
            unresolved.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ledger.external.map((e) => (
              <li
                key={e.host}
                className="rounded-full border border-border-strong px-2.5 py-0.5 font-mono text-xs"
              >
                {e.host} <span className="text-muted">· {e.calls}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ledger.schemalessEndpoints > 0 && (
        <p className="mt-3 text-xs text-muted">
          <b className="tabular-nums text-fg">{ledger.schemalessEndpoints}</b> endpoint
          {ledger.schemalessEndpoints === 1 ? ' has' : 's have'} no schema, so which fields their
          consumers read cannot be shown for them.
        </p>
      )}
    </section>
  );
}
