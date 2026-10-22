// HierarchyTree — la jerarquía de nodos, legible.
//
// El grafo espacial sirve para ver flujo, pero no para leer estructura: los
// repos flotan y los endpoints sin consumidor quedan como callejones. Este
// árbol muestra repo → servicio → endpoint y, en cada endpoint, quién lo
// consume y con qué superficie. Es lo que hace visible "cómo se manejan".

import type * as React from 'react';
import { useMemo, useState } from 'react';
import type { TopologyEdge, TopologyNode } from './TopologyView.js';

interface Grouped {
  repo: string;
  services: Array<{
    service: string;
    endpoints: Array<{
      node: TopologyNode;
      consumers: Array<{ from: string; label?: string; binding?: string; confidence?: number }>;
    }>;
  }>;
}

export function HierarchyTree({
  nodes,
  edges,
  onSelect,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onSelect?: (endpointId: string) => void;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => groupHierarchy(nodes, edges), [nodes, edges]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (grouped.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
        No hierarchy to show for these filters.
      </div>
    );
  }

  return (
    <div
      data-testid="hierarchy-tree"
      className="rounded-xl border border-border bg-surface overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          Structure — repo → service → endpoint
        </h3>
        {collapsed.size > 0 && (
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="text-xs text-accent hover:underline"
          >
            expand all
          </button>
        )}
      </div>

      <div className="max-h-[560px] overflow-y-auto py-1">
        {grouped.map((repo) => {
          const repoOpen = !collapsed.has(repo.repo);
          const epCount = repo.services.reduce((a, s) => a + s.endpoints.length, 0);
          return (
            <div key={repo.repo}>
              <TreeRow
                depth={0}
                kind="repo"
                label={repo.repo}
                count={epCount}
                open={repoOpen}
                onToggle={() => toggle(repo.repo)}
              />
              {repoOpen &&
                repo.services.map((svc) => {
                  const svcOpen = !collapsed.has(svc.service);
                  return (
                    <div key={svc.service}>
                      <TreeRow
                        depth={1}
                        kind="service"
                        label={svc.service}
                        count={svc.endpoints.length}
                        open={svcOpen}
                        onToggle={() => toggle(svc.service)}
                      />
                      {svcOpen &&
                        svc.endpoints.map((ep) => (
                          <div key={ep.node.id}>
                            <TreeRow
                              depth={2}
                              kind="endpoint"
                              label={ep.node.label}
                              count={ep.consumers.length}
                              open={false}
                              onToggle={onSelect ? () => onSelect(ep.node.id) : undefined}
                              muted={ep.consumers.length === 0}
                            />
                            {ep.consumers.map((c) => (
                              <div
                                key={c.from}
                                className="flex items-start gap-2 pl-[3.75rem] pr-4 py-0.5 text-xs"
                              >
                                <span className="text-accent shrink-0">←</span>
                                <span className="font-medium">{c.from}</span>
                                <span className="text-muted truncate">
                                  {c.label ?? 'uses'}
                                  {c.binding ? ` · ${c.binding}` : ''}
                                  {c.confidence !== undefined
                                    ? ` · ${c.confidence.toFixed(2)}`
                                    : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TreeRow({
  depth,
  kind,
  label,
  count,
  open,
  onToggle,
  muted,
}: {
  depth: number;
  kind: 'repo' | 'service' | 'endpoint';
  label: string;
  count: number;
  open: boolean;
  onToggle?: (() => void) | undefined;
  muted?: boolean;
}): React.ReactElement {
  const isLeaf = kind === 'endpoint';
  const dot = kind === 'repo' ? '#a78bfa' : kind === 'service' ? '#3b82f6' : '#f59e0b';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      className={`w-full text-left flex items-center gap-2 py-1 pr-4 text-sm hover:bg-bg transition-colors disabled:hover:bg-transparent ${
        muted ? 'opacity-55' : ''
      }`}
      style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
    >
      <span className="w-3 text-muted text-xs">{isLeaf ? '•' : open ? '▾' : '▸'}</span>
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          background: dot,
          width: kind === 'repo' ? 10 : 7,
          height: kind === 'repo' ? 10 : 7,
        }}
      />
      <span className={`truncate ${kind === 'endpoint' ? 'font-mono text-xs' : 'font-medium'}`}>
        {label}
      </span>
      <span className="ml-auto text-xs text-muted whitespace-nowrap">
        {isLeaf
          ? count > 0
            ? `${count} consumer${count === 1 ? '' : 's'}`
            : 'no consumers'
          : `${count}`}
      </span>
    </button>
  );
}

export function groupHierarchy(
  nodes: readonly TopologyNode[],
  edges: readonly TopologyEdge[],
): Grouped[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Quién consume cada endpoint, con la superficie usada.
  const consumers = new Map<
    string,
    Grouped['services'][number]['endpoints'][number]['consumers']
  >();
  for (const e of edges) {
    if (e.kind !== 'consumes') continue;
    const meta = (e.meta ?? {}) as { binding?: string; confidence?: number };
    const list = consumers.get(e.target) ?? [];
    list.push({
      from: byId.get(e.source)?.label ?? e.source,
      ...(e.label ? { label: e.label } : {}),
      ...(meta.binding ? { binding: meta.binding } : {}),
      ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}),
    });
    consumers.set(e.target, list);
  }

  const repoMap = new Map<string, Map<string, Grouped['services'][number]['endpoints']>>();

  const ensure = (repoLabel: string, svcLabel: string) => {
    let services = repoMap.get(repoLabel);
    if (!services) {
      services = new Map();
      repoMap.set(repoLabel, services);
    }
    let endpoints = services.get(svcLabel);
    if (!endpoints) {
      endpoints = [];
      services.set(svcLabel, endpoints);
    }
    return endpoints;
  };

  // Se recorre todo, no sólo los endpoints: un servicio sin contratos también
  // es estructura, y ocultarlo deja al repo invisible en el árbol.
  for (const n of nodes) {
    if (n.kind === 'repo') {
      ensure(n.label, '');
      continue;
    }
    if (n.kind === 'service') {
      const repoNode = n.parent ? byId.get(n.parent) : undefined;
      ensure(repoNode?.label ?? '(sin repo)', n.label);
      continue;
    }
    // endpoint: cuelga del servicio, que cuelga del repo.
    const svcNode = n.parent ? byId.get(n.parent) : undefined;
    const repoNode = svcNode?.parent ? byId.get(svcNode.parent) : undefined;
    ensure(repoNode?.label ?? '(sin repo)', svcNode?.label ?? '(sin servicio)').push({
      node: n,
      consumers: consumers.get(n.id) ?? [],
    });
  }

  return [...repoMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, services]) => ({
      repo,
      services: [...services.entries()]
        .filter(([name]) => name.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([service, endpoints]) => ({
          service,
          endpoints: [...endpoints].sort((a, b) => a.node.label.localeCompare(b.node.label)),
        })),
    }));
}
