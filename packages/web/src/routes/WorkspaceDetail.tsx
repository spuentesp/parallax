import type * as React from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEvidence, useWorkspace, useWorkspaceTopology } from '../api/hooks.js';
import { DependencyList } from '../components/DependencyList.js';
import type { EvidenceItem } from '../components/EvidencePanel.js';
import { TopologyView } from '../components/TopologyView.js';

export function WorkspaceDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const wsQuery = useWorkspace(id);
  const topoQuery = useWorkspaceTopology(id);
  const evidence = useEvidence();
  const [cited, setCited] = useState<EvidenceItem[] | null>(null);

  const ws = wsQuery.data?.workspace ?? null;
  const topo = topoQuery.data ?? null;

  if (wsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted">Loading workspace…</div>;
  }
  if (!ws) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Workspace not found.</p>
        <Link to="/workspaces" className="text-sm text-accent">
          ← Back to workspaces
        </Link>
      </div>
    );
  }

  const stats = topo?.stats;

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link to="/workspaces" className="text-xs text-muted hover:text-accent">
          ← Workspaces
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              {ws.name}
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-muted font-normal">
                {ws.repoCount > 1 ? 'Multi-repo' : 'Monorepo'}
              </span>
            </h1>
            {ws.description && <p className="text-sm mt-1 text-muted">{ws.description}</p>}
          </div>
          <SourceBadge source={topo?.source ?? 'none'} error={topo?.error} />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Services" value={stats?.services ?? 0} />
        <Stat label="Dependencies" value={stats?.dependencies ?? 0} />
        <Stat label="Repositories" value={ws.repoCount} />
        <Stat label="Unresolved inbound" value={stats?.unresolvedInbound ?? 0} />
      </div>

      {/* Topology graph */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Service topology</h2>
          <span className="text-xs text-muted">
            {topo?.source === 'lain' ? 'Live from LAIN' : 'Not connected'}
            {topo?.lainUrl ? ` · ${topo.lainUrl}` : ''}
          </span>
        </div>
        {topoQuery.isLoading ? (
          <div className="h-[520px] rounded-xl border border-border flex items-center justify-center text-sm text-muted">
            Loading topology from LAIN…
          </div>
        ) : (
          <TopologyView data={topo?.topology ?? { nodes: [], edges: [] }} />
        )}
        {topo?.error && <p className="text-xs text-warning mt-2">LAIN error: {topo.error}</p>}
      </div>

      {/* Navegación por dependencias + panel de evidencia (§2, §10) */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Dependencies &amp; evidence</h2>
          <span className="text-xs text-muted">
            Cada call-site abre el código en la vista del motor
          </span>
        </div>
        <DependencyList
          edges={topo?.topology?.edges ?? []}
          loading={evidence.isPending}
          evidence={cited}
          onLoadEvidence={(refs) => {
            if (!id) return;
            evidence.mutate(
              { workspaceId: id, refs, contextLines: 6 },
              { onSuccess: (res) => setCited(res.items) },
            );
          }}
        />
      </div>

      {/* Repositories */}
      <div>
        <h2 className="font-semibold mb-2">Repositories</h2>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-muted">
              <tr>
                <th className="text-left font-medium px-4 py-2">URI</th>
                <th className="text-left font-medium px-4 py-2">SHA</th>
                <th className="text-left font-medium px-4 py-2">Local path</th>
              </tr>
            </thead>
            <tbody>
              {ws.repos.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs break-all">{r.uri}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {r.sha ? r.sha.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{r.local ?? '—'}</td>
                </tr>
              ))}
              {ws.repos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted">
                    No repositories configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

function SourceBadge({
  source,
  error,
}: {
  source: string;
  error?: string | undefined;
}): React.ReactElement {
  const style =
    source === 'lain'
      ? 'bg-success/15 text-success'
      : source === 'error'
        ? 'bg-error/15 text-error'
        : 'bg-bg text-muted';
  const label =
    source === 'lain' ? 'LAIN connected' : source === 'error' ? 'LAIN error' : 'No LAIN';
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${style}`} title={error}>
      {label}
    </span>
  );
}
