// TopologyView — red de dependencias a nivel de endpoint, colapsable.
//
// La lectura correcta es una CADENA, no un radio:
//   consumidor ──consumes──▶ endpoint ──served by──▶ proveedor
// Así cada endpoint tiene entrada y salida y el grafo se lee como flujo.
//
// Repo → servicio → endpoint es jerarquía colapsable: al colapsar un repo se
// ocultan sus servicios, sus contratos y las aristas que dependen de ellos.

import type * as React from 'react';
import { useMemo, useState } from 'react';
import { darkTheme, GraphCanvas } from 'reagraph';

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'repo' | 'service' | 'endpoint';
  parent: string | null;
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'contains' | 'consumes' | 'servedBy';
  meta?: Record<string, unknown>;
}

export interface TopologyViewData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const NODE_FILL: Record<TopologyNode['kind'], string> = {
  repo: '#a78bfa',
  service: '#3b82f6',
  endpoint: '#f59e0b',
};

const NODE_SIZE: Record<TopologyNode['kind'], number> = {
  repo: 30,
  service: 18,
  endpoint: 8,
};

// La jerarquía se dibuja tenue pero visible: si se pierde del todo, el repo
// queda como punto suelto y no se lee como contenedor de sus servicios.
const EDGE_STYLE: Record<TopologyEdge['kind'], { fill: string; strokeWidth: number }> = {
  contains: { fill: 'rgba(167, 139, 250, 0.45)', strokeWidth: 1.5 },
  servedBy: { fill: 'rgba(167, 139, 250, 0.8)', strokeWidth: 2 },
  consumes: { fill: 'rgba(59, 130, 246, 0.9)', strokeWidth: 2.5 },
};

function isVisible(
  n: TopologyNode,
  byId: Map<string, TopologyNode>,
  collapsed: Set<string>,
): boolean {
  let cur: TopologyNode | undefined = n;
  const guard = new Set<string>();
  while (cur) {
    if (collapsed.has(cur.id)) return false;
    if (guard.has(cur.id)) return false;
    guard.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return true;
}

const LAYOUTS = [
  { id: 'forceDirected2d', label: 'network' },
  { id: 'treeTd2d', label: 'hierarchy' },
] as const;

export function TopologyView({
  data,
  height = 560,
}: {
  data: TopologyViewData;
  height?: number;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]['id']>('forceDirected2d');

  const { nodes, edges } = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const counts = new Map<string, number>();
    for (const n of data.nodes) {
      if (n.parent) counts.set(n.parent, (counts.get(n.parent) ?? 0) + 1);
    }

    const visible = data.nodes.filter((n) => isVisible(n, byId, collapsed));
    const ids = new Set(visible.map((n) => n.id));

    return {
      nodes: visible.map((n) => {
        const isCollapsed = collapsed.has(n.id);
        const kids = counts.get(n.id) ?? 0;
        return {
          id: n.id,
          label: isCollapsed && kids > 0 ? `${n.label} (+${kids})` : n.label,
          fill: NODE_FILL[n.kind] ?? NODE_FILL.service,
          size: NODE_SIZE[n.kind] ?? 12,
        };
      }),
      edges: data.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e, i) => {
          const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.consumes;
          return {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            ...(e.label ? { label: e.label } : {}),
            fill: s.fill,
            strokeWidth: s.strokeWidth,
          };
        }),
      childCounts: counts,
    };
  }, [data, collapsed]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      data-testid="topology-view"
      className="relative w-full rounded-xl overflow-hidden border border-border bg-bg"
      style={{ height }}
    >
      {nodes.length > 0 ? (
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          labelType="all"
          theme={darkTheme}
          layoutType={layout}
          onNodeClick={(n) => toggle(String(n.id))}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-muted">
          No endpoints match these filters
        </div>
      )}
      <div className="absolute bottom-2 left-3 flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLayout(l.id)}
              className={`px-2 py-0.5 rounded-full transition-colors ${
                layout === l.id ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-border'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="text-muted">
          Click a repo or service to collapse / expand
          {collapsed.size > 0 && (
            <button
              type="button"
              onClick={() => setCollapsed(new Set())}
              className="ml-2 text-accent hover:underline"
            >
              expand all
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

export function TopologyLegend(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <LegendDot color={NODE_FILL.repo} size={12} label="Repository (colapsable)" />
      <LegendDot color={NODE_FILL.service} size={10} label="Service / module" />
      <LegendDot color={NODE_FILL.endpoint} size={7} label="Endpoint / contract" />
      <LegendLine color={EDGE_STYLE.consumes.fill} label="consumes (rotulado con el campo leído)" />
      <LegendLine color={EDGE_STYLE.servedBy.fill} label="served by (cierra la cadena)" />
      <LegendLine color={EDGE_STYLE.contains.fill} label="contains (jerarquía)" />
    </div>
  );
}

function LegendDot({
  color,
  size,
  label,
}: {
  color: string;
  size: number;
  label: string;
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block rounded-full"
        style={{ background: color, width: size, height: size }}
      />
      {label}
    </span>
  );
}

function LegendLine({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-6 h-0.5" style={{ background: color }} />
      {label}
    </span>
  );
}
