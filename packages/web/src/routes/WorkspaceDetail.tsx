import type * as React from 'react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchGraphChildren,
  fetchGraphSnippet,
  type TopologyFilters,
  useEvidence,
  useWorkspace,
  useWorkspaceGraph,
  useWorkspaceTopology,
} from '../api/hooks.js';
import { CodeGraphTree } from '../components/CodeGraphTree.js';
import { DependencyList } from '../components/DependencyList.js';
import type { EvidenceItem } from '../components/EvidencePanel.js';
import { RepoManager } from '../components/RepoManager.js';
import { MapExplorer } from '../map/MapExplorer.js';

const CONTRACT_KINDS = ['http', 'topic', 'graphql', 'table', 'rpc', 'websocket'] as const;

export function WorkspaceDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  // La pestaña vive en la URL: un enlace (o un agente) puede abrir el mapa ya
  // enfocado en un nodo (?tab=map&focus=…).
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: 'map' | 'repos' | 'contracts' | 'graph' =
    rawTab === 'repos' || rawTab === 'contracts' || rawTab === 'graph' ? rawTab : 'map';
  const setTab = (next: 'map' | 'repos' | 'contracts' | 'graph') =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  const [filters, setFilters] = useState<TopologyFilters>({});
  const wsQuery = useWorkspace(id);
  const topoQuery = useWorkspaceTopology(id, filters);
  const graphQuery = useWorkspaceGraph(tab === 'graph' ? id : undefined);
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

      {/* Pestañas: mapa (jerarquía + relaciones), contratos y grafo de código */}
      <div className="flex items-center gap-2" data-testid="workspace-tabs">
        {(
          [
            ['map', 'Map'],
            ['repos', 'Repositories'],
            ['contracts', 'Contracts'],
            ['graph', 'Code graph'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              tab === key ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-border'
            }`}
            data-testid={`tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'map' && id && <MapExplorer workspaceId={id} />}

      {tab === 'repos' && <RepoManager workspace={ws} />}

      {tab === 'contracts' && (
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Services" value={stats?.services ?? 0} />
            <Stat label="Endpoints" value={stats?.endpoints ?? 0} />
            <Stat label="Dependencies" value={stats?.dependencies ?? 0} />
            <Stat label="Repositories" value={ws.repoCount} />
            <Stat label="Contract kinds" value={Object.keys(stats?.byKind ?? {}).length} />
          </div>

          {/* Filtros de la lista de dependencias */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-semibold">Contracts</h2>
              <span className="text-xs text-muted">
                {topo?.source === 'lain' ? 'Live from LAIN' : 'Not connected'}
                {topo?.lainUrl ? ` · ${topo.lainUrl}` : ''}
              </span>
            </div>
            <FilterBar filters={filters} onChange={setFilters} byKind={stats?.byKind ?? {}} />
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
        </>
      )}

      {tab === 'graph' && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-semibold">Code graph</h2>
            <span className="text-xs text-muted">
              Expands node by node from LAIN&apos;s knowledge graph
              {graphQuery.data?.lainUrl ? ` · ${graphQuery.data.lainUrl}` : ''}
            </span>
          </div>
          {graphQuery.isLoading ? (
            <div className="h-[320px] rounded-xl border border-border flex items-center justify-center text-sm text-muted">
              Loading code graph from LAIN…
            </div>
          ) : (
            <CodeGraphTree
              data={graphQuery.data ?? { graph: { repos: [] }, source: 'none' as const }}
              fetchChildren={(ref) => fetchGraphChildren(id ?? '', ref)}
              fetchSnippet={(repo, symbol) => fetchGraphSnippet(id ?? '', repo, symbol)}
            />
          )}
        </div>
      )}
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

function FilterBar({
  filters,
  onChange,
  byKind,
}: {
  filters: TopologyFilters;
  onChange: (f: TopologyFilters) => void;
  byKind: Record<string, number>;
}): React.ReactElement {
  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs transition-colors ${
      active ? 'bg-accent text-accent-fg' : 'bg-bg text-muted hover:bg-border'
    }`;
  const has = Object.keys(filters).some((k) => filters[k as keyof TopologyFilters] !== undefined);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="topology-filters">
      <span className="text-xs text-muted">Contract:</span>
      <button
        type="button"
        onClick={() => onChange({})}
        className={chip(!filters.kind)}
        title="Todos los tipos de contrato"
      >
        all
      </button>
      {CONTRACT_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange({ ...filters, kind: filters.kind === k ? undefined : k })}
          className={chip(filters.kind === k)}
        >
          {k}
          {byKind[k] !== undefined ? ` (${byKind[k]})` : ''}
        </button>
      ))}

      <span className="text-xs text-muted ml-2">Binding:</span>
      {(['static', 'heuristic'] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange({ ...filters, binding: filters.binding === b ? undefined : b })}
          className={chip(filters.binding === b)}
        >
          {b}
        </button>
      ))}

      <span className="text-xs text-muted ml-2">Min conf:</span>
      {[0.3, 0.6, 1].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() =>
            onChange({ ...filters, minConfidence: filters.minConfidence === v ? undefined : v })
          }
          className={chip(filters.minConfidence === v)}
        >
          {v.toFixed(1)}
        </button>
      ))}

      {has && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="text-xs text-accent hover:underline ml-1"
        >
          clear
        </button>
      )}
    </div>
  );
}
