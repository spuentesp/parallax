import type * as React from 'react';
import { useState } from 'react';
import {
  type LooseCategory,
  type LooseEndDto,
  useAssessLooseEnds,
  useLooseEnds,
  useWhoami,
} from '../api/hooks.js';

// "Cabos sueltos": lo que el motor no pudo atar y lo que ató sólo por heurística,
// con QUÉ es cada uno. Dos fuentes, siempre rotuladas: una REGLA exacta (la ruta
// o el motivo del propio motor) o la LECTURA de Nemotron sobre el código — un
// juicio, no un hecho del motor.

const LABEL: Record<LooseCategory, string> = {
  likely_real_link: 'Probably a real link the engine missed',
  external_call: 'Call to something outside the workspace',
  dynamic_target: 'Target built at runtime',
  not_a_call: 'Not a call (false positive)',
  test_or_tooling: 'Test or tooling code',
  unclear: 'Unclear',
};
// De lo que más conviene mirar a lo que menos.
const ORDER: LooseCategory[] = [
  'likely_real_link',
  'external_call',
  'dynamic_target',
  'not_a_call',
  'test_or_tooling',
  'unclear',
];

export function LooseEndsPanel({
  workspaceId,
  onSelect,
  onClose,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const q = useLooseEnds(workspaceId);
  const assess = useAssessLooseEnds(workspaceId);
  const readOnly = useWhoami().data?.readOnly === true;
  const [only, setOnly] = useState<LooseCategory | 'pending' | null>(null);
  const r = q.data;

  const rows = (r?.items ?? []).filter((i) =>
    only === null
      ? true
      : only === 'pending'
        ? i.assessment === null
        : i.assessment?.category === only,
  );
  const grouped = new Map<string, LooseEndDto[]>();
  for (const i of rows) {
    const k = i.assessment?.category ?? 'pending';
    grouped.set(k, [...(grouped.get(k) ?? []), i]);
  }
  const running = r?.run.state === 'running';

  return (
    <div className="flex h-full flex-col" data-testid="loose-ends">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div>
          <h3 className="text-sm font-semibold">Loose ends{r ? ` · ${r.summary.total}` : ''}</h3>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Calls the engine could not bind, and relations it bound only by a heuristic. <b>Rule</b>{' '}
            = exact (the file path or the engine&apos;s own reason). <b>Model</b> = Nemotron&apos;s
            reading of the code at that line, not an engine fact.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close loose ends"
          className="h-6 w-6 shrink-0 rounded-md text-xs text-muted hover:bg-bg hover:text-fg"
        >
          ✕
        </button>
      </div>

      {q.isPending && <p className="p-4 text-xs text-muted">Reading the engine…</p>}
      {q.isError && <p className="p-4 text-xs text-error">Could not load loose ends.</p>}
      {r && r.source !== 'lain' && (
        <p className="p-4 text-xs text-muted" data-testid="loose-unavailable">
          {r.source === 'unconfigured'
            ? 'This workspace has no LAIN server configured.'
            : `LAIN error: ${r.error ?? 'unreachable'}.`}
        </p>
      )}

      {r && r.source === 'lain' && (
        <>
          <div className="space-y-2 border-b border-border p-4">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
              {ORDER.filter((c) => r.summary.byCategory[c] > 0).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={only === c}
                  onClick={() => setOnly(only === c ? null : c)}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${only === c ? 'bg-accent text-accent-fg' : 'bg-bg text-muted hover:bg-border'}`}
                >
                  {r.summary.byCategory[c]} {LABEL[c]}
                </button>
              ))}
              {r.summary.pendingCases > 0 && (
                <button
                  type="button"
                  aria-pressed={only === 'pending'}
                  onClick={() => setOnly(only === 'pending' ? null : 'pending')}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${only === 'pending' ? 'bg-accent text-accent-fg' : 'bg-bg text-warning hover:bg-border'}`}
                >
                  {r.summary.pendingCases} not classified yet
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => assess.mutate()}
                disabled={running || assess.isPending || r.summary.pendingCases === 0}
                title="Nemotron reads the code at each unclassified site, a few at a time"
                className="rounded-lg bg-accent px-2.5 py-1 text-accent-fg disabled:opacity-50"
              >
                {running ? 'Classifying…' : `Classify ${r.summary.pendingCases} with Nemotron`}
              </button>
              {running && (
                <span className="tabular-nums text-muted" data-testid="loose-progress">
                  {r.run.done} of {r.run.total} cases
                </span>
              )}
              {!running && r.run.usage && r.run.usage.modelCalls > 0 && (
                <span className="text-muted" data-testid="loose-usage">
                  last run: {r.run.usage.modelCalls} model call
                  {r.run.usage.modelCalls === 1 ? '' : 's'} · {r.run.usage.completionTokens} tokens
                  · {Math.round(r.run.usage.ms / 1000)} s
                </span>
              )}
              {readOnly && <span className="text-muted">(uses the shared model budget)</span>}
            </div>
            {r.run.state === 'failed' && (
              <p className="text-[11px] text-warning" role="status">
                The last run stopped: {r.run.error ?? 'unknown error'}. Verdicts already stored are
                kept.
              </p>
            )}
            {assess.isError && (
              <p className="text-[11px] text-warning" role="status">
                Could not start the classification (
                {assess.error instanceof Error ? assess.error.message : 'error'}).
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {r.items.length === 0 && (
              <p className="p-4 text-xs text-muted">The engine reports no loose ends.</p>
            )}
            {[...ORDER, 'pending' as const]
              .filter((k) => grouped.has(k))
              .map((k) => (
                <section key={k} className="border-b border-border">
                  <h4 className="bg-bg px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {k === 'pending' ? 'Not classified yet' : LABEL[k]} · {grouped.get(k)?.length}
                  </h4>
                  <ul>
                    {grouped.get(k)?.map((i) => (
                      <li key={i.key}>
                        <button
                          type="button"
                          onClick={() => onSelect(`repo:${i.repo}`)}
                          className="block w-full px-4 py-2 text-left hover:bg-bg"
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="truncate font-mono text-[11px]"
                              title={`${i.repo}:${i.path}`}
                            >
                              {i.repo}:{i.path}
                              {i.line ? `:${i.line}` : ''}
                            </span>
                            <span className="shrink-0 rounded bg-bg px-1 text-[10px] text-muted border border-border">
                              {i.kind}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted">
                            engine: {i.reason}
                            {i.detail.endpoint ? ` → ${i.detail.endpoint}` : ''}
                            {i.detail.confidence !== undefined
                              ? ` (${i.detail.confidence.toFixed(2)})`
                              : ''}
                          </span>
                          {i.assessment && (
                            <span className="mt-0.5 flex items-start gap-1.5 text-[11px]">
                              <span
                                className={`mt-px shrink-0 rounded px-1 text-[10px] ${i.assessment.source === 'model' ? 'bg-accent/15 text-accent' : 'bg-bg text-muted border border-border'}`}
                              >
                                {i.assessment.source === 'model' ? 'Model' : 'Rule'}
                              </span>
                              <span>{i.assessment.reason}</span>
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
