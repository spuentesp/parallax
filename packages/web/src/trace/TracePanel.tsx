import type * as React from 'react';
import { useEffect, useRef } from 'react';
import {
  type ProgressEventDto,
  type TraceHopDto,
  type TraceLane,
  type TraceLinkDto,
  type TraceResultDto,
  useTrace,
} from '../api/hooks.js';

// El recorrido de un valor, del dato a donde termina, como una línea vertical. Cada
// salto es un lugar del código que el motor LEYÓ; cada enlace se dibuja según quién lo
// respalda: trazo continuo = hecho del motor; discontinuo = lo afirma el modelo; punteado
// = el motor buscó y no encontró camino (su grafo no ve el despacho dinámico).

const LANE_LABEL: Record<TraceLane, string> = {
  data: 'Data',
  data_access: 'Data access',
  domain: 'Domain logic',
  api_handler: 'API handler',
  contract: 'Contract',
  client_call: 'Client call',
  client_logic: 'Client logic',
  sink: 'Where it ends',
};

const REPO_COLORS = [
  'var(--color-repo)',
  'var(--color-service)',
  'var(--color-endpoint)',
  'var(--color-group)',
  'var(--color-file)',
  'var(--color-symbol)',
];
const repoColor = (repo: string, order: string[]): string =>
  REPO_COLORS[Math.max(0, order.indexOf(repo)) % REPO_COLORS.length] ?? 'var(--color-repo)';

const BASIS: Record<TraceLinkDto['basis'], { label: string; line: string; tone: string }> = {
  engine: { label: 'engine fact', line: 'border-solid', tone: 'text-success' },
  asserted: { label: 'asserted by the model', line: 'border-dashed', tone: 'text-muted' },
  not_found: { label: 'engine found no call path', line: 'border-dotted', tone: 'text-warning' },
};

function Running({ progress }: { progress: ProgressEventDto[] }): React.ReactElement {
  const tools = progress.filter(
    (e): e is Extract<ProgressEventDto, { type: 'tool' }> => e.type === 'tool',
  );
  const last = progress[progress.length - 1];
  return (
    <div className="space-y-1 p-4 text-sm text-muted" data-testid="trace-running">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {last?.type === 'verify'
          ? 'Reading every hop back from the code…'
          : last?.type === 'wrapup'
            ? 'Asking the model to fix hops the engine could not find…'
            : 'Following the value through the code…'}
      </div>
      <ul className="space-y-0.5 pl-4 text-[11px]">
        {tools.slice(-6).map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: la lista sólo crece por el final
          <li key={i} className={t.ok ? '' : 'text-warning'}>
            <span aria-hidden="true">{t.ok ? '✓' : '·'}</span>{' '}
            <span className="font-mono">{t.tool}</span>
            {t.summary ? <span> · {t.summary}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hop({
  hop,
  color,
  onRepo,
}: {
  hop: TraceHopDto;
  color: string;
  onRepo: (repo: string) => void;
}): React.ReactElement {
  const ok = hop.status === 'verified';
  return (
    <div className="flex gap-3" data-testid={`hop-${hop.id}`}>
      <div className="flex w-3 flex-col items-center pt-1.5">
        <span
          className="h-3 w-3 rounded-full border-2"
          style={{ borderColor: color, background: ok ? color : 'transparent' }}
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
          <span>{LANE_LABEL[hop.lane]}</span>
          <span
            className={`rounded px-1 normal-case ${ok ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
            title={hop.reason}
          >
            {ok ? (hop.origin === 'engine' ? 'engine record' : 'read in the code') : hop.status}
          </span>
        </div>
        <p className="mt-0.5 text-sm font-medium break-words">{hop.label}</p>
        <button
          type="button"
          onClick={() => onRepo(hop.repo)}
          title="Show this repository on the map"
          className="mt-0.5 block max-w-full break-all text-left font-mono text-[11px] text-muted hover:text-accent"
        >
          <span style={{ color }}>{hop.repo}</span>:{hop.path}:{hop.line}
        </button>
        {!ok && <p className="mt-1 text-[11px] text-warning">{hop.reason}</p>}
      </div>
    </div>
  );
}

function Link({ link }: { link?: TraceLinkDto | undefined }): React.ReactElement {
  const b = link ? BASIS[link.basis] : undefined;
  return (
    <div className="flex gap-3" data-testid="trace-link">
      <div className="flex w-3 justify-center">
        <div
          className={`h-full min-h-7 w-0 border-l-2 ${b ? b.line : 'border-dotted'} border-border`}
        />
      </div>
      <div className="py-0.5 text-[11px]">
        {link ? (
          <span title={link.because}>
            <span className="font-medium">{link.relation}</span>
            {link.note ? <span className="text-muted"> · {link.note}</span> : null}{' '}
            <span className={b?.tone}>· {b?.label}</span>
          </span>
        ) : (
          <span className="text-muted">no link recorded between these two</span>
        )}
      </div>
    </div>
  );
}

export function TraceView({
  trace,
  onSelect,
}: {
  trace: TraceResultDto;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const repos = [...new Set(trace.hops.map((h) => h.repo))];
  const linkBetween = (a: string, b: string) =>
    trace.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  const engineLinks = trace.links.filter((l) => l.basis === 'engine').length;
  const asserted = trace.links.filter((l) => l.basis === 'asserted').length;
  const notFound = trace.links.filter((l) => l.basis === 'not_found').length;
  const gapAfter = (id: string) => trace.gaps.filter((g) => g.after === id);

  return (
    <div className="space-y-3 p-4" data-testid="trace-view">
      <p className="text-sm">{trace.summary}</p>
      <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="trace-tally">
        <span className="rounded-full bg-bg px-2 py-0.5">{trace.hops.length} hops read</span>
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">
          {engineLinks} links are engine facts
        </span>
        <span className="rounded-full bg-bg px-2 py-0.5 text-muted">
          {asserted} asserted by the model
        </span>
        {notFound > 0 && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
            {notFound} the engine found no path for
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 ${trace.complete ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
        >
          {trace.complete ? `reaches its end: ${trace.sink?.kind}` : 'does not reach its end'}
        </span>
      </div>
      <p className="text-[11px] text-muted">
        Solid line: a fact the engine recorded or confirmed. Dashed: asserted by the model after
        reading the code (the location is checked; the link is not). Dotted: the engine looked and
        found no call path; its graph cannot see dynamic dispatch, so that is not a contradiction.
      </p>

      <div>
        {trace.hops.map((h, i) => {
          const next = trace.hops[i + 1];
          return (
            <div key={h.id}>
              <Hop hop={h} color={repoColor(h.repo, repos)} onRepo={(r) => onSelect(`repo:${r}`)} />
              {gapAfter(h.id).map((g) => (
                <div
                  key={g.reason}
                  className="my-1 ml-6 rounded-lg border border-dashed border-warning px-3 py-1.5 text-[11px] text-warning"
                  data-testid="trace-gap"
                >
                  Trail lost: {g.reason}
                </div>
              ))}
              {next && <Link link={linkBetween(h.id, next.id)} />}
            </div>
          );
        })}
      </div>

      {trace.sink ? (
        <div
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          data-testid="trace-sink"
        >
          <span className="text-[10px] uppercase tracking-wide text-muted">Where it ends</span>
          <p className="font-medium">{trace.sink.kind}</p>
          {trace.sink.note && <p className="text-[11px] text-muted">{trace.sink.note}</p>}
        </div>
      ) : (
        <div
          className="rounded-lg border border-dashed border-warning px-3 py-2 text-[11px] text-warning"
          data-testid="trace-no-sink"
        >
          The trace did not reach where the value ends: nothing here says whether it is stored,
          rendered, sent on or discarded.
        </div>
      )}

      {trace.rejected.length > 0 && (
        <details className="text-[11px]" data-testid="trace-rejected">
          <summary className="cursor-pointer text-muted hover:text-fg">
            {trace.rejected.length} proposed by the model, not found in the code
          </summary>
          <ul className="mt-1 space-y-1">
            {trace.rejected.map((h) => (
              <li key={h.id}>
                <span className="font-medium">{h.label}</span>{' '}
                <span className="font-mono text-muted">
                  {h.repo}:{h.path}:{h.line}
                </span>
                <div className="text-warning">{h.reason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-muted" data-testid="trace-usage">
        {trace.usage.modelCalls} model calls · {trace.usage.toolCalls} engine reads ·{' '}
        {Math.round(trace.usage.ms / 1000)} s
      </p>
    </div>
  );
}

export function TracePanel({
  workspaceId,
  contract,
  onSelect,
  onClose,
}: {
  workspaceId: string;
  contract: { key: string; service: string | null };
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const t = useTrace(workspaceId);
  const started = useRef<string | null>(null);
  // Una traza por contrato abierto: se lanza al abrir y no se repite al volver a renderizar.
  const key = `${contract.service ?? ''}|${contract.key}`;
  const { mutate } = t;
  useEffect(() => {
    if (started.current === key) return;
    started.current = key;
    mutate({ key: contract.key, service: contract.service });
  }, [key, contract.key, contract.service, mutate]);

  const err = t.error as { status?: number; body?: { detail?: string; code?: string } } | null;
  return (
    <div className="flex h-full flex-col" data-testid="trace-panel">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">End-to-end trace</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={contract.key}>
            {contract.key}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trace"
          className="h-6 w-6 shrink-0 rounded-md text-xs text-muted hover:bg-bg hover:text-fg"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {t.isPending && <Running progress={t.progress} />}
        {t.isError && (
          <div className="space-y-2 p-4 text-sm" role="alert">
            <p className="text-warning">
              {err?.status === 429
                ? 'Traces are limited per hour for this workspace. Try again later.'
                : err?.body?.detail
                  ? `Could not trace this contract: ${err.body.detail}.`
                  : 'Could not trace this contract.'}
            </p>
            <button
              type="button"
              onClick={() => mutate({ key: contract.key, service: contract.service })}
              className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-bg"
            >
              Try again
            </button>
          </div>
        )}
        {t.data && t.data.status !== 'available' && (
          <div
            className="space-y-1 p-4 text-sm text-warning"
            role="alert"
            data-testid="trace-failed"
          >
            <p>
              The trace could not be completed (
              {t.data.status.replace('failed:', '').replace(/_/g, ' ')}).
            </p>
            {t.data.errors[0] && <p className="text-[11px]">{t.data.errors[0]}</p>}
          </div>
        )}
        {t.data && t.data.status === 'available' && (
          <TraceView trace={t.data} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
