import { useQueryClient } from '@tanstack/react-query';
import type * as React from 'react';
import { useState } from 'react';
import { useCiSettings, useSaveCiSettings, type WorkspaceCiSettings } from '../api/hooks.js';

/**
 * CI automática del workspace: evaluar cada PR que se abre o actualiza en sus repos
 * de GitHub y GitLab, con un comentario de asesoría si se activa.
 */
export function CiSettingsPanel({ orgId }: { orgId: string }): React.ReactElement {
  const { data, isLoading, error } = useCiSettings(orgId);

  return (
    <section className="rounded-xl p-4 mb-6 bg-surface border border-border">
      <h2 className="font-semibold mb-1">Automatic reviews</h2>
      <p className="text-xs text-muted mb-4">
        Evaluate new or updated requests in the workspace&apos;s GitHub and GitLab repositories.
        Results are advisory and never set a commit status.
      </p>
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-error">{String(error)}</p>}
      {data && <CiForm key={JSON.stringify(data)} orgId={orgId} initial={data} />}
    </section>
  );
}

function CiForm({
  orgId,
  initial,
}: {
  orgId: string;
  initial: WorkspaceCiSettings;
}): React.ReactElement {
  const [mode, setMode] = useState(initial.mode);
  const [baseBranch, setBaseBranch] = useState(initial.baseBranch ?? '');
  const [reportComments, setReportComments] = useState(initial.reportComments);
  const save = useSaveCiSettings(orgId);
  const queryClient = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        mode,
        baseBranch: baseBranch.trim() === '' ? null : baseBranch.trim(),
        reportComments,
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['ci-settings', orgId] });
        },
      },
    );
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg text-sm bg-bg border border-border focus:outline-none focus:ring-2 focus:ring-accent';

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="block text-xs text-muted mb-1">Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as WorkspaceCiSettings['mode'])}
          className={inputCls}
        >
          <option value="off">Off — evaluate only when asked</option>
          <option value="on-open-and-update">On — evaluate when a PR opens or updates</option>
        </select>
      </label>

      <label className="block text-sm">
        <span className="block text-xs text-muted mb-1">Base branch (optional)</span>
        <input
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          placeholder="any branch"
          className={inputCls}
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={reportComments}
          onChange={(e) => setReportComments(e.target.checked)}
        />
        Post an advisory comment on the request
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {save.isSuccess && <span className="text-xs text-muted">Saved.</span>}
        {save.isError && <span className="text-xs text-error">{String(save.error)}</span>}
      </div>
    </form>
  );
}
