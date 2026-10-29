import type * as React from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  type TopologyFilters,
  useEvidence,
  useWorkspace,
  useWorkspaceTopology,
} from '../api/hooks.js';
import { DependencyList } from '../components/DependencyList.js';
import type { EvidenceItem } from '../components/EvidencePanel.js';

const CONTRACT_KINDS = ['http', 'topic', 'graphql', 'table', 'rpc', 'websocket'] as const;

// Contratos del workspace: la lista plana de dependencias con su evidencia
// (cada call-site abre el código). Lo mismo que el mapa, para quien prefiere
// filtrar y leer en lista.
export function Contracts(): React.ReactElement {
  const { orgId: id } = useParams<{ orgId: string }>();
  const [filters, setFilters] = useState<TopologyFilters>({});
  const wsQuery = useWorkspace(id);
  const topoQuery = useWorkspaceTopology(id, filters);
  const evidence = useEvidence();
  const [cited, setCited] = useState<EvidenceItem[] | null>(null);

  const ws = wsQuery.data?.workspace ?? null;
  const topo = topoQuery.data ?? null;
  const stats = topo?.stats;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted mb-1">{ws?.name ?? id}</div>
          <h1 className="text-2xl font-bold">Contracts</h1>
        </div>
        <SourceBadge source={topo?.source ?? 'none'} error={topo?.error} />
      </div>
      <>
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Services" value={stats?.services ?? 0} />
            <Stat label="Endpoints" value={stats?.endpoints ?? 0} />
            <Stat label="Dependencies" value={stats?.dependencies ?? 0} />
            <Stat label="Repositories" value={ws?.repoCount ?? 0} />
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
      </>
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
