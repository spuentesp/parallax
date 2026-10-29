import type * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import {
  type RepoStatus,
  useAddRepo,
  useDeleteWorkspace,
  useLainConfig,
  useRemoveRepo,
  useRepoStatus,
  useUpdateWorkspace,
  useWhoami,
  type Workspace,
} from '../api/hooks.js';

// Configuración básica del workspace, sin modelo: qué repos tiene, si LAIN los
// tiene indexados, a qué servidor LAIN apunta. El árbol del mapa sale de lo que
// LAIN indexó, no de esta lista; por eso cada repo muestra su estado frente a LAIN
// y lo que LAIN tiene de más aparece aparte, en vez de desajustarse en silencio.

const STATE_LABEL: Record<RepoStatus['state'], { text: string; cls: string; hint: string }> = {
  indexed: {
    text: 'Indexed',
    cls: 'bg-success/15 text-success',
    hint: 'LAIN reviewed this repository: it appears in the map.',
  },
  unreviewed: {
    text: 'Not reviewed',
    cls: 'bg-warning/15 text-warning',
    hint: 'LAIN knows this repository but has not reviewed it yet (still indexing, or excluded).',
  },
  not_in_lain: {
    text: 'Not in LAIN',
    cls: 'bg-error/15 text-error',
    hint: "LAIN's own configuration does not include this repository, so it is not in the map. Add it to LAIN's repos.yaml and re-index.",
  },
};

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.body as { detail?: string } | null)?.detail;
    return detail ?? `request failed (${e.status})`;
  }
  return e instanceof Error ? e.message : 'request failed';
}

export function RepoManager({ workspace: ws }: { workspace: Workspace }): React.ReactElement {
  const readOnly = useWhoami().data?.readOnly === true;
  const status = useRepoStatus(ws.id);
  const stateById = new Map((status.data?.repos ?? []).map((r) => [r.id, r]));

  return (
    <div className="space-y-6" data-testid="repo-manager">
      <LainServer workspace={ws} readOnly={readOnly} />

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Repositories</h2>
          <button
            type="button"
            onClick={() => void status.refetch()}
            className="text-xs text-accent hover:underline"
          >
            Re-check status
          </button>
        </div>
        <RepoTable ws={ws} stateById={stateById} readOnly={readOnly} loading={status.isPending} />
        {status.data?.source === 'error' && (
          <p className="text-xs text-warning mt-2" data-testid="status-error">
            Could not ask LAIN ({status.data.error}). Status below is unknown, not "missing".
          </p>
        )}
        {status.data?.source === 'unconfigured' && ws.repos.length > 0 && (
          <p className="text-xs text-muted mt-2">
            This workspace has no LAIN server set, so nothing can be indexed or shown in the map.
          </p>
        )}
        {!readOnly && <AddRepo workspaceId={ws.id} />}
      </div>

      {status.data && status.data.untracked.length > 0 && (
        <div data-testid="untracked">
          <h3 className="text-sm font-semibold mb-1">Indexed by LAIN, not configured here</h3>
          <p className="text-xs text-muted mb-2">
            These repositories are in the map but not in this list, so their code cannot be browsed.
            Add them above (use the same name LAIN uses).
          </p>
          <ul className="rounded-xl border border-border divide-y divide-border text-sm">
            {status.data.untracked.map((u) => (
              <li key={u.repo} className="px-4 py-2 flex items-center justify-between">
                <span className="font-mono text-xs">{u.repo}</span>
                <span className="font-mono text-[11px] text-muted">{u.commit.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <LainConfig workspaceId={ws.id} />
      {!readOnly && <DangerZone workspace={ws} />}
    </div>
  );
}

function RepoTable({
  ws,
  stateById,
  readOnly,
  loading,
}: {
  ws: Workspace;
  stateById: ReadonlyMap<string, RepoStatus>;
  readOnly: boolean;
  loading: boolean;
}): React.ReactElement {
  const remove = useRemoveRepo(ws.id);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg text-muted">
          <tr>
            <th className="text-left font-medium px-4 py-2">Repository</th>
            <th className="text-left font-medium px-4 py-2">Local path</th>
            <th className="text-left font-medium px-4 py-2">LAIN</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {ws.repos.map((r) => {
            const st = stateById.get(r.id);
            const label = st ? STATE_LABEL[st.state] : null;
            return (
              <tr key={r.id} className="border-t border-border" data-testid={`repo-row-${r.id}`}>
                <td className="px-4 py-2">
                  <div className="font-medium">{st?.lainRepoId ?? r.uri}</div>
                  <div className="font-mono text-[11px] text-muted break-all">{r.uri}</div>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted">{r.local ?? '—'}</td>
                <td className="px-4 py-2">
                  {label ? (
                    <span
                      title={label.hint}
                      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${label.cls}`}
                    >
                      {label.text}
                      {st?.state === 'indexed' && st.commit ? ` · ${st.commit.slice(0, 7)}` : ''}
                      {st?.dirty ? ' (dirty)' : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{loading ? 'checking…' : 'unknown'}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {!readOnly &&
                    (confirming === r.id ? (
                      <span className="text-xs">
                        Remove?{' '}
                        <button
                          type="button"
                          className="text-error hover:underline mr-2"
                          onClick={() =>
                            remove.mutate(r.id, { onSettled: () => setConfirming(null) })
                          }
                        >
                          yes
                        </button>
                        <button
                          type="button"
                          className="text-muted hover:underline"
                          onClick={() => setConfirming(null)}
                        >
                          no
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${st?.lainRepoId ?? r.uri}`}
                        onClick={() => setConfirming(r.id)}
                        className="text-xs text-muted hover:text-error"
                      >
                        Remove
                      </button>
                    ))}
                </td>
              </tr>
            );
          })}
          {ws.repos.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-muted">
                No repositories configured.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {remove.isError && (
        <p className="px-4 py-2 text-xs text-error" role="alert">
          {errorText(remove.error)}
        </p>
      )}
    </div>
  );
}

function AddRepo({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const add = useAddRepo(workspaceId);
  const [uri, setUri] = useState('');
  const [local, setLocal] = useState('');
  const [sha, setSha] = useState('');
  const input =
    'px-3 py-2 rounded-lg text-sm bg-bg border border-border focus:outline-none focus:ring-2 focus:ring-accent';

  return (
    <form
      className="mt-3 flex flex-wrap gap-2 items-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (!uri.trim()) return;
        add.mutate(
          {
            uri: uri.trim(),
            ...(local.trim() ? { local: local.trim() } : {}),
            ...(sha.trim() ? { sha: sha.trim() } : {}),
          },
          {
            onSuccess: () => {
              setUri('');
              setLocal('');
              setSha('');
            },
          },
        );
      }}
    >
      <input
        aria-label="Repository URL or path"
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        placeholder="https://github.com/org/repo.git"
        className={`flex-1 min-w-[16rem] ${input}`}
      />
      <input
        aria-label="Local checkout path"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Local path (optional)"
        className={`w-48 ${input}`}
      />
      <input
        aria-label="Commit SHA"
        value={sha}
        onChange={(e) => setSha(e.target.value)}
        placeholder="SHA (optional)"
        className={`w-36 ${input}`}
      />
      <button
        type="submit"
        disabled={add.isPending || !uri.trim()}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-accent-fg disabled:opacity-50"
      >
        {add.isPending ? 'Adding…' : 'Add repository'}
      </button>
      {add.isError && (
        <p className="basis-full text-xs text-error" role="alert">
          {errorText(add.error)}
        </p>
      )}
    </form>
  );
}

function LainServer({
  workspace: ws,
  readOnly,
}: {
  workspace: Workspace;
  readOnly: boolean;
}): React.ReactElement {
  const update = useUpdateWorkspace(ws.id);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ws.lainUrl ?? '');

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">LAIN server</div>
          {editing ? (
            <input
              aria-label="LAIN server URL"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="http://localhost:9999/mcp"
              className="mt-1 w-80 max-w-full px-3 py-1.5 rounded-lg text-sm bg-bg border border-border focus:outline-none focus:ring-2 focus:ring-accent font-mono"
            />
          ) : (
            <div className="font-mono text-sm break-all" data-testid="lain-url">
              {ws.lainUrl ?? <span className="text-muted">not configured</span>}
            </div>
          )}
        </div>
        {!readOnly &&
          (editing ? (
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    { lainUrl: value.trim() === '' ? null : value.trim() },
                    { onSuccess: () => setEditing(false) },
                  )
                }
                className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue(ws.lainUrl ?? '');
                }}
                className="px-3 py-1.5 rounded-lg text-sm border border-border"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-accent hover:underline shrink-0"
            >
              Edit
            </button>
          ))}
      </div>
      {update.isError && (
        <p className="text-xs text-error mt-2" role="alert">
          {errorText(update.error)}
        </p>
      )}
    </div>
  );
}

function LainConfig({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const q = useLainConfig(workspaceId, open);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-sm text-accent hover:underline"
      >
        {open ? 'Hide' : 'Show'} LAIN configuration for these repositories
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">
            Use this as LAIN's <span className="font-mono">repos.yaml</span> (adjust paths), then
            restart or re-index LAIN. Parallax reads what LAIN indexed; it does not change LAIN.
          </p>
          <pre
            data-testid="lain-config"
            className="rounded-lg border border-border bg-bg p-3 text-[11px] font-mono overflow-auto max-h-64 whitespace-pre"
          >
            {q.isPending ? 'Loading…' : (q.data?.config ?? 'No configuration available.')}
          </pre>
          {q.data?.config && (
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(q.data?.config ?? '')
                  .then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DangerZone({ workspace: ws }: { workspace: Workspace }): React.ReactElement {
  const del = useDeleteWorkspace(ws.id);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-xl border border-error/40 px-4 py-3">
      <div className="text-sm font-semibold text-error">Delete workspace</div>
      <p className="text-xs text-muted mt-1">
        Removes this workspace and its repository list from Parallax. It does not touch the
        repositories or LAIN.
      </p>
      {confirm ? (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span>Delete “{ws.name}”?</span>
          <button
            type="button"
            disabled={del.isPending}
            onClick={() => del.mutate(undefined, { onSuccess: () => navigate('/workspaces') })}
            className="px-3 py-1 rounded-lg bg-error text-accent-fg text-xs"
          >
            Yes, delete
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="px-3 py-1 rounded-lg border border-border text-xs"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="mt-2 px-3 py-1 rounded-lg border border-error/60 text-error text-xs"
        >
          Delete workspace…
        </button>
      )}
      {del.isError && (
        <p className="text-xs text-error mt-2" role="alert">
          {errorText(del.error)}
        </p>
      )}
    </div>
  );
}
