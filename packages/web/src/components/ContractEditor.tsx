import { ContractApplyBody, type ContractApplyResult } from '@parallax/shared/domain';
import type * as React from 'react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import {
  type RecommendationDto,
  useApplyContractRemediation,
  useRecommendations,
  useWhoami,
} from '../api/hooks.js';

const INITIAL_CONTEXT = JSON.stringify(
  {
    provides: [
      {
        service: 'api',
        key: 'http:GET /orders',
        source: 'Parallax contract editor',
      },
    ],
    host_aliases: [],
    bindings: [],
  },
  null,
  2,
);

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: string } | null;
    return body?.detail ?? `request failed (${error.status})`;
  }
  return error instanceof Error ? error.message : 'request failed';
}

const EMPTY_CONTEXT = { provides: [], host_aliases: [], bindings: [] };

/**
 * Añade las declaraciones elegidas al contexto, sin repetir las que ya están. Si el
 * texto sigue siendo el ejemplo de partida, se descarta (no es del usuario: dejarlo
 * declararía un proveedor inventado junto a lo recomendado).
 */
export function mergeIntoContext(
  contextText: string,
  chosen: readonly RecommendationDto[],
): { text: string } | { error: string } {
  let base: Record<string, unknown>;
  if (contextText === INITIAL_CONTEXT) base = { ...EMPTY_CONTEXT };
  else {
    try {
      const parsed: unknown = JSON.parse(contextText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'The context must be a JSON object to add recommendations to it.' };
      }
      base = { ...EMPTY_CONTEXT, ...(parsed as Record<string, unknown>) };
    } catch (e) {
      return {
        error: `The context is not valid JSON (${e instanceof Error ? e.message : 'error'}).`,
      };
    }
  }
  const current = Array.isArray(base.bindings) ? (base.bindings as unknown[]) : [];
  const have = new Set(current.map((x) => JSON.stringify(x)));
  const extra = chosen.map((r) => r.declaration).filter((d) => !have.has(JSON.stringify(d)));
  base.bindings = [...current, ...extra];
  return { text: JSON.stringify(base, null, 2) };
}

function basisBadge(r: RecommendationDto): { label: string; cls: string } {
  if (r.modelPicked) {
    return { label: 'assistant picked · engine accepts', cls: 'border-inferred text-warning' };
  }
  return { label: 'engine verified', cls: 'border-success text-success' };
}

function Recommendations({
  recs,
  note,
  onAdd,
}: {
  recs: readonly RecommendationDto[];
  note: string | null;
  onAdd: (chosen: RecommendationDto[]) => void;
}): React.ReactElement {
  // Lo que el motor aceptó sin ayuda viene marcado; lo demás lo decide quien revisa.
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        recs
          .filter((r) => r.basis === 'engine_verified' && !r.modelPicked && !r.caution)
          .map((r) => r.id),
      ),
  );
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="space-y-3" data-testid="recommendations">
      {note && <p className="text-xs text-muted">{note}</p>}
      <ul className="space-y-2">
        {recs.map((r) => {
          const badge = basisBadge(r);
          return (
            <li key={r.id} className="rounded-lg border border-border bg-bg p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`Add ${r.title}`}
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-xs">{r.title}</span>
                    <span className={`rounded-full border px-2 py-px text-[10px] ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </span>
                  <span className="block text-[11px] text-muted">{r.basisDetail}</span>
                  {r.caution && (
                    <span className="block text-[11px] text-warning" data-testid="caution">
                      Check first: {r.caution}
                    </span>
                  )}
                  {r.alternatives.length > 0 && (
                    <span className="block text-[11px] text-muted">
                      The engine also accepts:{' '}
                      <span className="font-mono">
                        {r.alternatives.map((a) => `${a.service} ${a.key}`).join(', ')}
                      </span>
                    </span>
                  )}
                  {r.rationale && (
                    <span className="block text-xs">
                      <span className="text-muted">
                        Assistant&apos;s reading, not an engine fact:{' '}
                      </span>
                      {r.rationale}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={picked.size === 0}
        onClick={() => onAdd(recs.filter((r) => picked.has(r.id)))}
        className="rounded border border-accent px-3 py-1.5 text-sm text-accent disabled:opacity-50"
      >
        Add {picked.size} selected to the context
      </button>
    </div>
  );
}

export function ContractEditor({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const [contextText, setContextText] = useState(INITIAL_CONTEXT);
  const [validationError, setValidationError] = useState('');
  const [result, setResult] = useState<ContractApplyResult | null>(null);
  const mutation = useApplyContractRemediation();
  const suggest = useRecommendations(workspaceId);
  const [added, setAdded] = useState<string | null>(null);
  const readOnly = useWhoami().data?.readOnly === true;
  const recs = suggest.data;

  const apply = (dryRun: boolean) => {
    setValidationError('');
    let raw: unknown;
    try {
      raw = JSON.parse(contextText);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'invalid JSON');
      return;
    }
    const parsed = ContractApplyBody.safeParse({
      snapshot: 'live',
      ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}),
      dry_run: dryRun,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    mutation.mutate({ workspaceId, body: parsed.data }, { onSuccess: setResult });
  };

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
      data-testid="contract-editor"
    >
      <div>
        <h2 className="font-semibold">Contract remediation</h2>
        <p className="text-xs text-muted mt-1">
          Declare providers, host aliases, and bindings in Lain. Dry-run returns the exact YAML;
          apply validates and writes it atomically with a backup.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-bg/50 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
            disabled={suggest.isPending}
            onClick={() => {
              setAdded(null);
              suggest.mutate();
            }}
          >
            {suggest.isPending ? 'Looking at the loose ends…' : 'Suggest with assistant'}
          </button>
          <p className="min-w-0 flex-1 text-xs text-muted">
            Proposes bindings for the loose ends. The engine checks each one; nothing is applied
            until you preview and apply it.
          </p>
        </div>
        {suggest.isError && <p className="text-xs text-error">Could not get recommendations.</p>}
        {recs && recs.source !== 'lain' && (
          <p className="text-xs text-muted">
            {recs.source === 'unconfigured'
              ? 'This workspace has no LAIN server configured.'
              : `LAIN error: ${recs.error ?? 'unreachable'}.`}
          </p>
        )}
        {recs?.source === 'lain' && (
          <>
            {recs.recommendations.length === 0 ? (
              <p className="text-xs text-muted" data-testid="no-recommendations">
                Nothing to recommend: no loose end has a link the engine accepts unambiguously.
                {recs.model.note ? ` ${recs.model.note}` : ''}
              </p>
            ) : (
              <Recommendations
                // Una respuesta nueva reinicia la selección.
                key={recs.recommendations.map((r) => r.id).join(',')}
                recs={recs.recommendations}
                note={recs.model.note}
                onAdd={(chosen) => {
                  const merged = mergeIntoContext(contextText, chosen);
                  if ('error' in merged) {
                    setValidationError(merged.error);
                    return;
                  }
                  setValidationError('');
                  setContextText(merged.text);
                  setResult(null);
                  setAdded(
                    `Added ${chosen.length} to the context below. Preview changes to have the engine validate the whole change.`,
                  );
                }}
              />
            )}
            {added && (
              <p className="text-xs text-success" role="status">
                {added}
              </p>
            )}
            {recs.skipped.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer hover:text-fg">
                  What was left out, and why
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {recs.skipped.map((x) => (
                    <li key={x.reason}>
                      {x.count} · {x.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
      <label className="block text-xs text-muted">
        Context JSON
        <textarea
          className="mt-1 min-h-56 w-full rounded border border-border bg-bg p-3 font-mono text-sm"
          value={contextText}
          onChange={(event) => setContextText(event.target.value)}
        />
      </label>
      {validationError && <p className="text-xs text-error">{validationError}</p>}
      {mutation.error && <p className="text-xs text-error">{errorText(mutation.error)}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
          disabled={readOnly || mutation.isPending}
          onClick={() => apply(true)}
        >
          Preview changes
        </button>
        <button
          type="button"
          className="rounded bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-50"
          disabled={readOnly || mutation.isPending}
          onClick={() => apply(false)}
        >
          Apply changes
        </button>
      </div>
      {result && (
        <div>
          <h3 className="text-sm font-semibold" data-testid="remediation-result">
            {result.applied ? 'Applied by Lain' : 'Dry-run preview'}
          </h3>
          {result.note && <p className="text-xs text-muted mt-1">{result.note}</p>}
          {result.backup && <p className="text-xs text-muted mt-1">Backup: {result.backup}</p>}
          <pre
            className="mt-2 max-h-80 overflow-auto rounded bg-bg p-3 text-xs"
            data-testid="contract-preview"
          >
            {result.yaml ?? JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
