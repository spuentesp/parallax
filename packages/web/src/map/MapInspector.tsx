// MapInspector — qué es el nodo seleccionado y con quién se relaciona. Es la
// respuesta a "¿quién consume este endpoint?": una lista de servicios (de este
// y de otros repos), cada uno con la procedencia de la relación — continua si
// el análisis la prueba, discontinua si es una inferencia con su confianza.

import type { EndpointLink, NodeDetail, NodeRelation } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useMapNode } from '../api/hooks.js';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';
import { SourcePeek } from './SourcePeek.js';

export interface MapInspectorProps {
  workspaceId: string;
  nodeId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  focusing: boolean;
  onClearFocus: () => void;
}

const repoName = (id: string | null): string => (id ? id.replace(/^repo:/, '') : '');

export function MapInspector({
  workspaceId,
  nodeId,
  onSelect,
  onFocus,
  onToggle,
  focusing,
  onClearFocus,
}: MapInspectorProps): React.ReactElement {
  const q = useMapNode(workspaceId, nodeId);

  if (nodeId === null) {
    return (
      <div className="p-5 text-sm text-muted" data-testid="map-inspector-empty">
        <p className="font-medium text-fg mb-1">Select a node</p>
        <p>
          Click a repo, service or endpoint to see who consumes it, what it depends on and how sure
          we are of each link. Double-click to open what it contains.
        </p>
      </div>
    );
  }
  if (q.isPending) return <div className="p-5 text-sm text-muted">Loading…</div>;
  if (q.isError) {
    // 404 = el enlace apunta a algo que este mapa no tiene (p. ej. tras un
    // refresh o con otros filtros): es recuperable, no un fallo.
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return missing ? (
      <div className="p-5 text-sm text-muted" data-testid="map-inspector-missing">
        <p className="font-medium text-fg mb-1">Not in this map</p>
        <p>
          <span className="font-mono">{nodeId}</span> is not in the current graph. It may have been
          removed, or the link was made for another workspace.
        </p>
      </div>
    ) : (
      <div className="p-5 text-sm text-error">Could not load this node.</div>
    );
  }
  const detail = q.data?.detail;
  if (!detail) {
    return (
      <div className="p-5 text-sm text-muted">
        This node is not in the current graph — it may have disappeared after a refresh.
      </div>
    );
  }
  return (
    <Detail
      workspaceId={workspaceId}
      detail={detail}
      onSelect={onSelect}
      onFocus={onFocus}
      onToggle={onToggle}
      focusing={focusing}
      onClearFocus={onClearFocus}
    />
  );
}

function Detail({
  workspaceId,
  detail,
  onSelect,
  onFocus,
  onToggle,
  focusing,
  onClearFocus,
}: Omit<MapInspectorProps, 'nodeId'> & { detail: NodeDetail }): React.ReactElement {
  const { node } = detail;
  const consumerRepos = new Set(detail.consumers.map((c) => c.peer.parent));
  // El repo que contiene al nodo (o el nodo mismo) decide si hay código navegable.
  const repoNode = node.kind === 'repo' ? node : detail.path.find((p) => p.kind === 'repo');
  const lainRepo = typeof repoNode?.meta.lainRepoId === 'string' ? repoNode.meta.lainRepoId : null;
  const providers =
    (node.meta.providers as Array<{ repo?: string; path?: string; line?: number }> | undefined) ??
    [];

  return (
    <div className="divide-y divide-border" data-testid="map-inspector">
      <div className="p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <KindIcon kind={node.kind} />
          <span>{KIND_LABEL[node.kind]}</span>
          {node.contract && (
            <span className="rounded px-1 uppercase tracking-wide bg-bg border border-border">
              {node.contract}
            </span>
          )}
        </div>
        <h3
          className={`text-base font-semibold break-words ${node.kind === 'endpoint' ? 'font-mono text-sm' : ''}`}
        >
          {node.label}
        </h3>
        {detail.path.length > 0 && (
          <p className="text-xs text-muted">
            {[...detail.path].reverse().map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' / '}
                <button
                  type="button"
                  className="hover:text-accent hover:underline"
                  onClick={() => onSelect(p.id)}
                >
                  {p.label}
                </button>
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => onFocus(node.id)}
            className="px-2.5 py-1 rounded-full text-xs bg-accent text-accent-fg"
          >
            Focus neighborhood
          </button>
          {focusing && (
            <button
              type="button"
              onClick={onClearFocus}
              className="px-2.5 py-1 rounded-full text-xs bg-bg text-muted hover:bg-border"
            >
              Clear focus
            </button>
          )}
          {detail.children.length > 0 && (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              className="px-2.5 py-1 rounded-full text-xs bg-bg text-muted hover:bg-border"
            >
              {detail.children.length} inside · open / close
            </button>
          )}
        </div>
      </div>

      {node.kind !== 'repo' || detail.consumers.length > 0 || detail.providers.length > 0 ? (
        <>
          <Relations
            title="Consumed by"
            summary={
              detail.consumers.length > 0
                ? `${detail.consumers.length} service${detail.consumers.length === 1 ? '' : 's'} across ${consumerRepos.size} repo${consumerRepos.size === 1 ? '' : 's'}`
                : undefined
            }
            empty="No consumers found in the indexed repositories. That is not proof there are none: unresolved calls and unindexed repos are outside this map."
            relations={detail.consumers}
            onSelect={onSelect}
          />
          <Relations
            title="Depends on"
            empty="No outgoing dependencies found."
            relations={detail.providers}
            onSelect={onSelect}
          />
        </>
      ) : null}

      {node.kind === 'repo' && node.meta.lainRepoId === null && (
        <p className="p-5 text-xs text-muted" data-testid="repo-no-code">
          Code browsing is unavailable for this repository: its name in the contract analysis does
          not match any repository configured in this workspace, so it cannot be linked to the
          engine's code graph. Nothing is guessed.
        </p>
      )}

      {providers.length > 0 && (
        <div className="p-5 space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">Defined at</h4>
          {providers.map((p) => (
            <div key={`${p.repo}:${p.path}:${p.line}`} className="space-y-1">
              <p className="font-mono text-xs break-all">
                {p.repo ? `${p.repo}:` : ''}
                {p.path}
                {p.line ? `:${p.line}` : ''}
              </p>
              {p.path && lainRepo && (
                <SourcePeek workspaceId={workspaceId} repo={lainRepo} target={{ path: p.path }} />
              )}
            </div>
          ))}
          {!lainRepo && (
            <p className="text-[11px] text-muted">
              Source unavailable: this repository is not linked to the engine's code graph.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Relations({
  title,
  summary,
  empty,
  relations,
  onSelect,
}: {
  title: string;
  summary?: string | undefined;
  empty: string;
  relations: NodeRelation[];
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const sorted = [...relations].sort(
    (a, b) =>
      Number(b.edge.provenance === 'deterministic') -
        Number(a.edge.provenance === 'deterministic') ||
      b.edge.count - a.edge.count ||
      a.peer.label.localeCompare(b.peer.label),
  );
  return (
    <div className="p-5 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h4>
        {summary && <span className="text-xs text-muted">{summary}</span>}
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {sorted.map(({ peer, edge, links, hiddenLinks }) => (
            <li key={peer.id}>
              <button
                type="button"
                onClick={() => onSelect(peer.id)}
                className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg"
              >
                <KindIcon kind={peer.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{peer.label}</span>
                  <span className="block text-[11px] text-muted truncate">
                    {repoName(peer.parent)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="flex items-center justify-end gap-1.5">
                    <EdgeSwatch provenance={edge.provenance} width={22} />
                    <span className="text-[11px] tabular-nums text-muted">×{edge.count}</span>
                  </span>
                  <span className="block text-[10px] text-muted">
                    {edge.provenance === 'inferred'
                      ? `inferred · ${Math.round(edge.confidence * 100)}%`
                      : edge.inferredCount > 0
                        ? `deterministic · +${edge.inferredCount} inferred`
                        : 'deterministic'}
                  </span>
                </span>
              </button>
              {links.length > 0 && (
                <EndpointLinks
                  links={links}
                  hidden={hiddenLinks}
                  open={open.has(peer.id)}
                  onToggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(peer.id)) next.add(peer.id);
                      return next;
                    })
                  }
                  onSelect={onSelect}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Los endpoints concretos detrás de una relación entre servicios. */
function EndpointLinks({
  links,
  hidden,
  open,
  onToggle,
  onSelect,
}: {
  links: EndpointLink[];
  hidden: number;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="pl-8 pr-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-[11px] text-accent hover:underline"
      >
        {open ? 'Hide' : 'Show'} {links.length + hidden} endpoint
        {links.length + hidden === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5" data-testid="endpoint-links">
          {links.map((l) => {
            const site = l.sites[0];
            return (
              <li key={l.endpoint.id}>
                <button
                  type="button"
                  onClick={() => onSelect(l.endpoint.id)}
                  className="w-full text-left rounded px-1.5 py-1 hover:bg-bg"
                >
                  <span className="flex items-center gap-1.5">
                    <EdgeSwatch provenance={l.provenance} width={16} />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                      title={l.endpoint.label}
                    >
                      {l.endpoint.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted">×{l.count}</span>
                  </span>
                  {l.fields.length > 0 && (
                    <span className="block truncate text-[10px] text-muted">
                      uses {l.fields.slice(0, 4).join(', ')}
                      {l.fields.length > 4 ? ` +${l.fields.length - 4}` : ''}
                    </span>
                  )}
                  {site && (
                    <span
                      className="block truncate font-mono text-[10px] text-muted"
                      title={site.path}
                    >
                      {site.repo ? `${site.repo}:` : ''}
                      {site.path}
                      {site.line ? `:${site.line}` : ''}
                      {l.sites.length > 1 ? ` +${l.sites.length - 1} more` : ''}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="px-1.5 text-[10px] text-muted">+{hidden} more endpoints not listed</li>
          )}
        </ul>
      )}
    </div>
  );
}
