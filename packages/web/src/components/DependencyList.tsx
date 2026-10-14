// DependencyList — el mapa navegable del §2: cada arista del grafo y sus
// call-sites, con la evidencia resoluble que lleva al código (§10).

import type * as React from 'react';
import { useState } from 'react';
import type { TopologyEdge } from '../api/hooks.js';
import { EvidencePanel, type EvidenceItem } from './EvidencePanel.js';

interface UseRef {
  endpoint: string | null;
  binding: string;
  confidence: number;
  detector: string | null;
  fields: string[];
  ref: string | null;
  repo: string | null;
  path: string | null;
  line: number | null;
  commit: string | null;
}

export function DependencyList({
  edges,
  onLoadEvidence,
  evidence,
  loading,
}: {
  edges: TopologyEdge[];
  onLoadEvidence: (refs: string[]) => void;
  evidence: EvidenceItem[] | null;
  loading: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null);

  if (edges.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
        No cross-service dependencies detected in this workspace.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="dependency-list">
      {edges.map((e) => {
        const uses = ((e.meta as { uses?: UseRef[] } | undefined)?.uses ?? []) as UseRef[];
        const meta = (e.meta ?? {}) as {
          binding?: string;
          confidence?: number;
          useCount?: number;
          repo?: string;
        };
        const isOpen = open === `${e.source}->${e.target}`;
        return (
          <div key={`${e.source}->${e.target}`} className="rounded-xl border border-border bg-surface">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : `${e.source}->${e.target}`)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg transition-colors"
            >
              <span className="text-xs text-muted">{isOpen ? '▾' : '▸'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="font-medium">{e.source}</span>
                  <span className="text-muted"> consumes </span>
                  <span className="font-medium">{e.target}</span>
                </div>
                <div className="text-xs text-muted mt-0.5 font-mono truncate">
                  {e.label ?? 'uses'} · {meta.binding ?? '—'} · conf{' '}
                  {(meta.confidence ?? 0).toFixed(2)}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-muted whitespace-nowrap">
                {meta.useCount ?? uses.length} call-site
                {(meta.useCount ?? uses.length) === 1 ? '' : 's'}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-border px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
                    Call-sites ({uses.length}
                    {(meta.useCount ?? uses.length) > uses.length ? ' shown' : ''})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      const refs = uses.map((u) => u.ref).filter((r): r is string => !!r);
                      if (refs.length > 0) onLoadEvidence(refs);
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg hover:opacity-90 transition-opacity"
                  >
                    Ver código citado
                  </button>
                </div>

                <ul className="space-y-1">
                  {uses.map((u) => (
                    <li key={u.ref ?? u.path ?? Math.random()} className="text-xs">
                      <div className="flex items-center gap-2 font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            u.binding === 'static'
                              ? 'bg-success/15 text-success'
                              : 'bg-warning/15 text-warning'
                          }`}
                        >
                          {u.binding}
                        </span>
                        <span className="text-accent">{u.endpoint ?? '—'}</span>
                        {u.fields.length > 0 && (
                          <span className="text-muted">[{u.fields.join(', ')}]</span>
                        )}
                      </div>
                      <div className="text-muted font-mono mt-0.5 break-all">
                        {u.repo}@{u.commit?.slice(0, 10)}:{u.path}:{u.line}
                      </div>
                    </li>
                  ))}
                </ul>

                {loading && <p className="text-xs text-muted">Resolviendo evidencia…</p>}
                {evidence && !loading && <EvidencePanel items={evidence} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
