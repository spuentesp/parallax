import type * as React from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspace } from '../api/hooks.js';
import { RepoManager } from '../components/RepoManager.js';

export function Repos(): React.ReactElement {
  const { orgId } = useParams<{ orgId: string }>();
  const ws = useWorkspace(orgId);
  const workspace = ws.data?.workspace ?? null;
  if (ws.isLoading) return <div className="p-6 text-sm text-muted">Loading workspace…</div>;
  if (!workspace) return <div className="p-6 text-sm text-muted">Workspace not found.</div>;
  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xs font-medium text-muted mb-1">{workspace.name}</div>
        <h1 className="text-2xl font-bold">Repositories</h1>
      </div>
      <RepoManager workspace={workspace} />
    </div>
  );
}
