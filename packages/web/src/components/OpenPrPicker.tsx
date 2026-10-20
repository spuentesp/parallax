import type * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type OpenPrItem, useEvaluatePr, useOpenPrs } from '../api/hooks.js';

/**
 * Selector de PRs abiertos del workspace. Elegir uno lanza su evaluación: la API
 * resuelve la URL a SHAs y el informe queda con la identidad del par (base, head).
 * Los repos que no se pueden listar se muestran, no se omiten en silencio.
 */
export function OpenPrPicker({ orgId }: { orgId: string }): React.ReactElement {
  const { data, isLoading, error } = useOpenPrs(orgId);
  const evaluate = useEvaluatePr();
  const navigate = useNavigate();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const choose = (pr: OpenPrItem) => {
    setPendingUrl(pr.url);
    evaluate.mutate(
      { prUrl: pr.url, orgId },
      {
        onSuccess: (res) => navigate(`/orgs/${orgId}/assessments/${res.assessment.id}`),
        onSettled: () => setPendingUrl(null),
      },
    );
  };

  return (
    <section className="rounded-xl p-4 mb-6 bg-surface border border-border">
      <h2 className="font-semibold mb-1">Open pull requests</h2>
      <p className="text-xs text-muted mb-4">
        PRs abiertos de los repos de GitHub del workspace. Elige uno para evaluarlo.
      </p>

      {isLoading && <p className="text-sm text-muted">Loading pull requests…</p>}
      {error && <p className="text-sm text-error">{String(error)}</p>}

      {data && data.errors.length > 0 && (
        <ul className="text-xs text-error mb-3 space-y-1">
          {data.errors.map((e) => (
            <li key={e.repo}>
              Could not list {e.repo}: {e.message}
            </li>
          ))}
        </ul>
      )}
      {data && data.truncated.length > 0 && (
        <p className="text-xs text-muted mb-3">
          Showing the first 100 open PRs for {data.truncated.join(', ')}; older ones are not listed.
        </p>
      )}
      {data && data.skipped.length > 0 && (
        <p className="text-xs text-muted mb-3">
          Not on GitHub, so no PRs to list: {data.skipped.map((s) => s.repo).join(', ')}.
        </p>
      )}

      {data && data.prs.length === 0 && !isLoading && (
        <p className="text-sm text-muted">No open PRs in this workspace&apos;s GitHub repos.</p>
      )}

      <ul className="divide-y divide-border">
        {(data?.prs ?? []).map((pr) => (
          <li key={pr.url} className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                #{pr.number} {pr.title}
                {pr.draft && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-bg text-muted font-normal">
                    Draft
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-1">
                {pr.repo} · {pr.author ?? 'unknown'} · {pr.baseRef} ← {pr.headRef} ·{' '}
                {new Date(pr.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => choose(pr)}
              disabled={pendingUrl !== null}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {pendingUrl === pr.url ? 'Evaluating…' : 'Evaluate'}
            </button>
          </li>
        ))}
      </ul>

      {evaluate.isError && <p className="text-sm text-error mt-3">{String(evaluate.error)}</p>}
    </section>
  );
}
