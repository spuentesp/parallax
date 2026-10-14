import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface Repo {
  id: string;
  uri: string;
  sha: string | null;
  local: string | null;
}

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  repos: Repo[];
  repoCount: number;
}

export function Workspaces(): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  async function loadWorkspaces() {
    try {
      const res = await fetch('/api/workspaces');
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch {
      setError('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p style={{ color: 'var(--color-muted, #a3a3a3)' }} className="text-sm mt-1">
            Configure your organizations. Each workspace is a set of git repos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: 'var(--color-accent, #3b82f6)',
            color: '#fff',
          }}
        >
          + New Workspace
        </button>
      </div>

      {showCreate && <CreateWorkspace onCreated={() => { setShowCreate(false); loadWorkspaces(); }} />}

      {loading && <p style={{ color: 'var(--color-muted, #a3a3a3)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p>}

      <div className="grid gap-4 mt-6">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            to={`/workspaces/${w.id}`}
            className="block rounded-xl p-4 transition-colors"
            style={{
              background: 'var(--color-surface, #171717)',
              border: '1px solid var(--color-border, #262626)',
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{w.name}</div>
                {w.description && (
                  <div className="text-sm mt-1" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
                    {w.description}
                  </div>
                )}
                <div className="text-xs mt-2" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
                  {w.repoCount} repo{w.repoCount !== 1 ? 's' : ''}
                  {w.repos.length > 0 && ` · ${w.repos.map((r) => r.uri.split('/').pop()).join(', ')}`}
                </div>
              </div>
              <div
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: 'var(--color-bg, #0a0a0a)',
                  color: 'var(--color-muted, #a3a3a3)',
                }}
              >
                {w.repoCount > 1 ? 'Multi-repo' : 'Monorepo'}
              </div>
            </div>
          </Link>
        ))}
        {workspaces.length === 0 && !loading && (
          <div
            className="text-center py-12 rounded-xl"
            style={{
              background: 'var(--color-surface, #171717)',
              border: '1px dashed var(--color-border, #262626)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>⬡</div>
            <div className="text-sm" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
              No workspaces yet. Create one to get started.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateWorkspace({ onCreated }: { onCreated: () => void }): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repos, setRepos] = useState<Array<{ uri: string; sha: string; local: string }>>([
    { uri: '', sha: '', local: '' },
  ]);
  const [saving, setSaving] = useState(false);

  const addRepo = () => setRepos([...repos, { uri: '', sha: '', local: '' }]);
  const removeRepo = (i: number) => setRepos(repos.filter((_, idx) => idx !== i));
  const updateRepo = (i: number, field: string, value: string) => {
    const next = [...repos];
    (next[i] as Record<string, string>)[field] = value;
    setRepos(next);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      const wsId = data.workspace.id;
      for (const repo of repos) {
        if (repo.uri.trim()) {
          await fetch(`/api/workspaces/${wsId}/repos`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              uri: repo.uri,
              sha: repo.sha || undefined,
              local: repo.local || undefined,
            }),
          });
        }
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 mb-6"
      style={{
        background: 'var(--color-surface, #171717)',
        border: '1px solid var(--color-border, #262626)',
      }}
    >
      <h2 className="font-semibold mb-4">New Workspace</h2>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workspace name (e.g. Saleor)"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--color-bg, #0a0a0a)',
            border: '1px solid var(--color-border, #262626)',
            color: 'var(--color-fg, #fafafa)',
          }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--color-bg, #0a0a0a)',
            border: '1px solid var(--color-border, #262626)',
            color: 'var(--color-fg, #fafafa)',
          }}
        />

        <div className="text-sm font-medium mt-4">Repositories</div>
        {repos.map((repo, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              value={repo.uri}
              onChange={(e) => updateRepo(i, 'uri', e.target.value)}
              placeholder="https://github.com/org/repo.git or ./path"
              className="flex-1 px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--color-bg, #0a0a0a)',
                border: '1px solid var(--color-border, #262626)',
                color: 'var(--color-fg, #fafafa)',
              }}
            />
            <input
              value={repo.sha}
              onChange={(e) => updateRepo(i, 'sha', e.target.value)}
              placeholder="SHA (optional)"
              className="w-32 px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--color-bg, #0a0a0a)',
                border: '1px solid var(--color-border, #262626)',
                color: 'var(--color-fg, #fafafa)',
              }}
            />
            <input
              value={repo.local}
              onChange={(e) => updateRepo(i, 'local', e.target.value)}
              placeholder="Local path (optional)"
              className="w-40 px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--color-bg, #0a0a0a)',
                border: '1px solid var(--color-border, #262626)',
                color: 'var(--color-fg, #fafafa)',
              }}
            />
            {repos.length > 1 && (
              <button
                type="button"
                onClick={() => removeRepo(i)}
                className="px-2 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-error, #ef4444)', color: '#fff' }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addRepo}
          className="text-sm"
          style={{ color: 'var(--color-accent, #3b82f6)' }}
        >
          + Add repo
        </button>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: saving ? 'var(--color-muted, #a3a3a3)' : 'var(--color-accent, #3b82f6)',
              color: '#fff',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Creating…' : 'Create Workspace'}
          </button>
          <button
            type="button"
            onClick={onCreated}
            className="px-4 py-2 rounded-lg text-sm"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border, #262626)',
              color: 'var(--color-fg, #fafafa)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
