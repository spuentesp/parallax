import type * as React from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCreateWorkspace, useWorkspaces, type Workspace } from '../api/hooks.js';

export function Workspaces(): React.ReactElement {
  const { data, isLoading, error } = useWorkspaces();
  const [showCreate, setShowCreate] = useState(false);
  const workspaces = data?.workspaces ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-sm mt-1 text-muted">
            Each workspace is an organization: one or more git repos, analyzed by LAIN.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:opacity-90 transition-opacity"
        >
          + New Workspace
        </button>
      </div>

      {showCreate && <CreateWorkspace onCreated={() => setShowCreate(false)} />}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-error">{String(error)}</p>}

      <div className="grid gap-4 mt-6">
        {workspaces.map((w) => (
          <WorkspaceCard key={w.id} workspace={w} />
        ))}
        {workspaces.length === 0 && !isLoading && (
          <div className="text-center py-12 rounded-xl border border-dashed border-border">
            <div className="text-3xl mb-2">⬡</div>
            <div className="text-sm text-muted">No workspaces yet. Create one to get started.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace: w }: { workspace: Workspace }): React.ReactElement {
  return (
    <Link
      to={`/workspaces/${w.id}`}
      className="block rounded-xl p-4 bg-surface border border-border hover:border-accent transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-2">
            {w.name}
            <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-muted font-normal">
              {w.repoCount > 1 ? 'Multi-repo' : 'Monorepo'}
            </span>
          </div>
          {w.description && <div className="text-sm mt-1 text-muted">{w.description}</div>}
          <div className="text-xs mt-2 text-muted">
            {w.repoCount} repo{w.repoCount !== 1 ? 's' : ''}
            {w.repos.length > 0 && (
              <span>
                {' '}
                ·{' '}
                {w.repos
                  .map((r) =>
                    r.uri
                      .split('/')
                      .pop()
                      ?.replace(/\.git$/, ''),
                  )
                  .join(', ')}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-muted whitespace-nowrap">
          <div>{w.lainUrl ? 'LAIN connected' : 'LAIN not configured'}</div>
          <div className="mt-1 text-accent">View topology →</div>
        </div>
      </div>
    </Link>
  );
}

function CreateWorkspace({ onCreated }: { onCreated: () => void }): React.ReactElement {
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lainUrl, setLainUrl] = useState('');
  const [repos, setRepos] = useState<Array<{ uri: string; sha: string; local: string }>>([
    { uri: '', sha: '', local: '' },
  ]);

  const addRepo = () => setRepos([...repos, { uri: '', sha: '', local: '' }]);
  const removeRepo = (i: number) => setRepos(repos.filter((_, idx) => idx !== i));
  const updateRepo = (i: number, field: string, value: string) => {
    const next = [...repos];
    (next[i] as Record<string, string>)[field] = value;
    setRepos(next);
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg text-sm bg-bg border border-border focus:outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="rounded-xl p-4 mb-6 bg-surface border border-border">
      <h2 className="font-semibold mb-4">New Workspace</h2>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workspace name (e.g. Saleor)"
          className={inputCls}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className={inputCls}
        />
        <input
          value={lainUrl}
          onChange={(e) => setLainUrl(e.target.value)}
          placeholder="LAIN endpoint (optional, e.g. http://localhost:9999/mcp)"
          className={inputCls}
        />

        <div className="text-sm font-medium mt-4">Repositories</div>
        {repos.map((repo, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: filas editables sin id estable; una key por contenido perdería foco al escribir el uri
          <div key={i} className="flex gap-2 items-center">
            <input
              value={repo.uri}
              onChange={(e) => updateRepo(i, 'uri', e.target.value)}
              placeholder="https://github.com/org/repo.git or ./path"
              className={`flex-1 ${inputCls}`}
            />
            <input
              value={repo.sha}
              onChange={(e) => updateRepo(i, 'sha', e.target.value)}
              placeholder="SHA (optional)"
              className={`w-32 ${inputCls}`}
            />
            <input
              value={repo.local}
              onChange={(e) => updateRepo(i, 'local', e.target.value)}
              placeholder="Local path (optional)"
              className={`w-40 ${inputCls}`}
            />
            {repos.length > 1 && (
              <button
                type="button"
                onClick={() => removeRepo(i)}
                className="px-2 py-2 rounded-lg text-sm bg-error text-accent-fg"
                aria-label="Remove repo"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addRepo} className="text-sm text-accent">
          + Add repo
        </button>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => {
              if (!name.trim()) return;
              create.mutate(
                {
                  name,
                  ...(description ? { description } : {}),
                  ...(lainUrl ? { lainUrl } : {}),
                  repos: repos
                    .filter((r) => r.uri.trim())
                    .map((r) => ({
                      uri: r.uri,
                      ...(r.sha ? { sha: r.sha } : {}),
                      ...(r.local ? { local: r.local } : {}),
                    })),
                },
                { onSuccess: onCreated },
              );
            }}
            disabled={create.isPending || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {create.isPending ? 'Creating…' : 'Create Workspace'}
          </button>
          <button
            type="button"
            onClick={onCreated}
            className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-bg transition-colors"
          >
            Cancel
          </button>
        </div>
        {create.isError && <p className="text-sm text-error">{String(create.error)}</p>}
      </div>
    </div>
  );
}
