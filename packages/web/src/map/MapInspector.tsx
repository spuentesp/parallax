// MapInspector — qué es el nodo seleccionado y con quién se relaciona. Es la
// respuesta a "¿quién consume este endpoint?": una lista de servicios (de este
// y de otros repos), cada uno con la procedencia de la relación — continua si
// el análisis la prueba, discontinua si es una inferencia con su confianza.

import type { EndpointLink, NodeDetail, NodeRelation, OrgNode } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useImplementation, useMapNode, useWorkspace, type Workspace } from '../api/hooks.js';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';
import { SourcePeek } from './SourcePeek.js';

export interface MapInspectorProps {
  workspaceId: string;
  nodeId: string | null;
  /** Datos síncronos del nodo disponibles de inmediato sin esperar a la API. */
  node?: OrgNode | null | undefined;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  focusing: boolean;
  onClearFocus: () => void;
  /** Abre el trazado de punta a punta de este contrato (sólo endpoints). */
  onTrace?: ((key: string, service: string | null) => void) | undefined;
}

const repoName = (id: string | null): string => (id ? id.replace(/^repo:/, '') : '');

export function MapInspector({
  workspaceId,
  nodeId,
  node: fallbackNode,
  onSelect,
  onFocus,
  onToggle,
  focusing,
  onClearFocus,
  onTrace,
}: MapInspectorProps): React.ReactElement {
  const q = useMapNode(workspaceId, nodeId);
  const wsQuery = useWorkspace(workspaceId);
  const workspace = wsQuery.data?.workspace;

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

  const detail =
    q.data?.detail ??
    (fallbackNode
      ? {
          node: fallbackNode,
          path: [],
          children: [],
          consumers: [],
          providers: [],
        }
      : null);

  if (q.isPending && !detail) return <div className="p-5 text-sm text-muted">Loading…</div>;
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
      workspace={workspace}
      loadingRelations={q.isPending}
      onSelect={onSelect}
      onFocus={onFocus}
      onToggle={onToggle}
      focusing={focusing}
      onClearFocus={onClearFocus}
      onTrace={onTrace}
    />
  );
}

function Detail({
  workspaceId,
  detail,
  workspace,
  loadingRelations = false,
  onSelect,
  onFocus,
  onToggle,
  focusing,
  onClearFocus,
  onTrace,
}: Omit<MapInspectorProps, 'nodeId' | 'node'> & {
  detail: NodeDetail;
  workspace?: Workspace | null | undefined;
  loadingRelations?: boolean;
}): React.ReactElement {
  const { node } = detail;
  const consumerRepos = new Set(detail.consumers.map((c) => c.peer.parent));
  // El repo que contiene al nodo (o el nodo mismo) decide si hay código navegable.
  const repoNode = node.kind === 'repo' ? node : detail.path.find((p) => p.kind === 'repo');
  const lainRepo = typeof repoNode?.meta.lainRepoId === 'string' ? repoNode.meta.lainRepoId : null;
  const providers =
    (node.meta.providers as Array<{ repo?: string; path?: string; line?: number }> | undefined) ??
    [];
  const targetRepoName = node.kind === 'repo' ? node.label : repoNode?.label;
  const wsRepo = workspace?.repos?.find(
    (r) =>
      r.id === node.id ||
      (targetRepoName &&
        (r.uri.endsWith(`/${targetRepoName}.git`) ||
          r.uri.endsWith(`/${targetRepoName}`) ||
          r.uri.toLowerCase().includes(targetRepoName.toLowerCase()))),
  );

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
        {node.kind === 'group' && (
          <div className="space-y-1" data-testid="group-note">
            {typeof node.meta.contracts === 'number' && (
              <p className="text-xs text-muted">
                {node.meta.contracts} contract{node.meta.contracts === 1 ? '' : 's'} in this group
              </p>
            )}
            {typeof node.meta.note === 'string' && (
              <p className="text-xs leading-snug text-muted">{node.meta.note}</p>
            )}
          </div>
        )}
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
          {node.kind === 'endpoint' && onTrace && (
            <button
              type="button"
              onClick={() =>
                onTrace(node.label, detail.path.find((p) => p.kind === 'service')?.label ?? null)
              }
              title="Follow the value from its data, through the API and its clients, to where it ends"
              className="px-2.5 py-1 rounded-full text-xs border border-accent text-accent hover:bg-accent/10"
            >
              Trace end to end
            </button>
          )}
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

        {/* Datos básicos / propiedades estructuradas */}
        <div className="rounded-lg border border-border/70 bg-bg/60 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted bg-surface/80 border border-border/50 rounded px-2 py-0.5 select-all">
            <span className="text-[10px] uppercase font-sans text-muted/70 tracking-wider">
              Node ID
            </span>
            <span className="truncate max-w-[15rem]">{node.id}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
            <div>
              <span className="text-[10px] text-muted block uppercase tracking-wide">Type</span>
              <span className="font-medium text-fg capitalize">{node.kind}</span>
            </div>
            {node.contract && (
              <div>
                <span className="text-[10px] text-muted block uppercase tracking-wide">
                  Protocol
                </span>
                <span className="font-mono text-fg">{node.contract.toUpperCase()}</span>
              </div>
            )}
            {targetRepoName && (
              <div className="col-span-2">
                <span className="text-[10px] text-muted block uppercase tracking-wide">
                  Repository
                </span>
                <span className="font-medium text-fg break-all">{targetRepoName}</span>
                {wsRepo?.uri && (
                  <span className="block text-[10px] font-mono text-muted truncate">
                    {wsRepo.uri}
                  </span>
                )}
                {wsRepo?.sha && (
                  <span className="block text-[10px] font-mono text-muted">
                    Commit: {wsRepo.sha}
                  </span>
                )}
                {wsRepo?.local && (
                  <span className="block text-[10px] font-mono text-muted truncate">
                    Local: {wsRepo.local}
                  </span>
                )}
              </div>
            )}
            {typeof node.meta.definedAt === 'string' && (
              <div className="col-span-2">
                <span className="text-[10px] text-muted block uppercase tracking-wide">
                  Defined at
                </span>
                <span className="font-mono text-fg text-[11px] break-all">
                  {String(node.meta.definedAt)}
                </span>
              </div>
            )}
            {detail.children.length > 0 && (
              <div>
                <span className="text-[10px] text-muted block uppercase tracking-wide">
                  Children
                </span>
                <span className="font-medium text-fg">{detail.children.length} elements</span>
              </div>
            )}
            {(detail.consumers.length > 0 || detail.providers.length > 0) && (
              <div>
                <span className="text-[10px] text-muted block uppercase tracking-wide">
                  Connections
                </span>
                <span className="font-medium text-fg">
                  {detail.consumers.length} in · {detail.providers.length} out
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {loadingRelations && (
        <div className="p-4 text-xs text-muted flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
          <span>Loading relationships…</span>
        </div>
      )}

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

      {node.kind === 'endpoint' && (
        <EndpointCallers
          workspaceId={workspaceId}
          consumers={detail.consumers}
          onSelect={onSelect}
        />
      )}

      {node.kind === 'endpoint' && node.contract === 'graphql' && (
        <ImplementedBy
          workspaceId={workspaceId}
          endpointKey={node.label}
          repo={lainRepo}
          onSelect={onSelect}
        />
      )}

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
          {providers.map((p) => {
            const targetRepo = p.repo ?? lainRepo;
            const targetNodeId = targetRepo ? `sym:${targetRepo}|File|${p.path}` : null;
            return (
              <div key={`${p.repo}:${p.path}:${p.line}`} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs break-all">
                    {p.repo ? `${p.repo}:` : ''}
                    {p.path}
                    {p.line ? `:${p.line}` : ''}
                  </p>
                  {targetNodeId && (
                    <button
                      type="button"
                      onClick={() => onSelect(targetNodeId)}
                      className="rounded px-1.5 py-0.5 text-[10px] bg-bg border border-border text-accent hover:bg-border whitespace-nowrap shrink-0"
                    >
                      View in code
                    </button>
                  )}
                </div>
                {p.path && lainRepo && (
                  <SourcePeek workspaceId={workspaceId} repo={lainRepo} target={{ path: p.path }} />
                )}
              </div>
            );
          })}
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

/**
 * Un contrato GraphQL sólo apunta a su SDL. Esto busca, bajo demanda, el código que
 * lo implementa por NOMBRE en el índice de LAIN: el símbolo y su archivo:línea los
 * da el motor; que sea "la implementación" es una coincidencia de nombre y así se rotula.
 */
function ImplementedBy({
  workspaceId,
  endpointKey,
  repo,
  onSelect,
}: {
  workspaceId: string;
  endpointKey: string;
  repo: string | null;
  onSelect?: (id: string) => void;
}): React.ReactElement {
  const [wanted, setWanted] = useState(false);
  const q = useImplementation(workspaceId, endpointKey, repo, wanted);
  const r = q.data?.result;
  return (
    <div className="p-5 space-y-2" data-testid="implemented-by">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">Implemented by</h4>
      {!repo ? (
        <p className="text-[11px] text-muted">Code search is unavailable for this repository.</p>
      ) : !wanted ? (
        <button
          type="button"
          onClick={() => setWanted(true)}
          className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-bg"
        >
          Find implementation
        </button>
      ) : q.isPending ? (
        <p className="text-[11px] text-muted">Searching the code index…</p>
      ) : q.isError || q.data?.source === 'error' ? (
        <p className="text-[11px] text-warning">
          The lookup failed{q.data?.error ? `: ${q.data.error}` : ''}.
        </p>
      ) : !r ? (
        <p className="text-[11px] text-muted">No LAIN server configured.</p>
      ) : r.error ? (
        <p className="text-[11px] text-muted">{r.error}.</p>
      ) : r.candidates.length === 0 ? (
        <p className="text-[11px] text-muted">
          No class or function named {r.tried.map((t) => `"${t}"`).join(', ')} in this repository
          (not proof there is none: the implementation may be named differently).
        </p>
      ) : (
        <>
          <p className="text-[10px] text-muted">
            Found by <b>name match</b> in LAIN&apos;s code index: the location is the engine&apos;s,
            the link to this endpoint is inferred.
          </p>
          <ul className="space-y-1">
            {r.candidates.map((c) => (
              <li
                key={c.id}
                className="font-mono text-xs break-all flex items-center justify-between gap-2"
              >
                <div>
                  <span className="text-muted">{c.type} </span>
                  {c.path}:{c.line}
                </div>
                {onSelect && repo && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelect(
                        `sym:${repo}|${c.type.toLowerCase() === 'file' ? 'File' : 'Function'}|${c.name || c.path}`,
                      )
                    }
                    className="rounded px-1.5 py-0.5 text-[10px] bg-bg border border-border text-accent hover:bg-border whitespace-nowrap shrink-0"
                  >
                    View in code
                  </button>
                )}
              </li>
            ))}
          </ul>
          {r.registeredIn.length > 0 && (
            <div>
              <p className="text-[10px] text-muted">Registered in</p>
              <ul className="space-y-0.5">
                {r.registeredIn.map((g) => (
                  <li key={`${g.name}|${g.path}`} className="text-xs">
                    <span className="font-medium">{g.name}</span>{' '}
                    <span className="font-mono text-[11px] text-muted break-all">{g.path}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EndpointCallers({
  workspaceId,
  consumers,
  onSelect,
}: {
  workspaceId: string;
  consumers: NodeRelation[];
  onSelect: (id: string) => void;
}): React.ReactElement | null {
  const callerSites = consumers.flatMap((c) =>
    c.links.flatMap((l) =>
      l.sites.map((s) => ({
        ...s,
        service: c.peer.label,
        provenance: l.provenance,
        confidence: l.confidence,
        fields: l.fields,
      })),
    ),
  );

  if (callerSites.length === 0) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border" data-testid="endpoint-callers">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Code using this contract
        </h4>
        <span className="text-xs text-muted">
          {callerSites.length} caller site{callerSites.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="space-y-2">
        {callerSites.map((site) => {
          const targetNodeId = site.repo ? `sym:${site.repo}|File|${site.path}` : null;
          return (
            <li
              key={`${site.service}:${site.repo}:${site.path}:${site.line}`}
              className="rounded-lg border border-border bg-surface p-2.5 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <EdgeSwatch provenance={site.provenance} width={16} />
                    <span>{site.service}</span>
                    {site.repo && (
                      <span className="rounded px-1 text-[10px] bg-bg border border-border text-muted font-normal">
                        {site.repo}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-muted mt-1 break-all">
                    {site.path}
                    {site.line ? `:${site.line}` : ''}
                  </p>
                </div>
                {targetNodeId && (
                  <button
                    type="button"
                    onClick={() => onSelect(targetNodeId)}
                    className="rounded px-2 py-0.5 text-[10px] bg-bg border border-border text-accent hover:bg-border whitespace-nowrap shrink-0"
                  >
                    View caller code
                  </button>
                )}
              </div>
              {site.fields && site.fields.length > 0 && (
                <p className="text-[10px] text-muted truncate">
                  Uses: <span className="font-mono text-fg">{site.fields.join(', ')}</span>
                </p>
              )}
              {site.repo && site.path && (
                <SourcePeek
                  workspaceId={workspaceId}
                  repo={site.repo}
                  target={{ path: site.path }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
