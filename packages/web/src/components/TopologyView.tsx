// TopologyView — reagraph-based service topology visualization.
// Node/edge data comes from LAIN via GET /api/workspaces/:id/topology.

import type * as React from 'react';
import { GraphCanvas, darkTheme } from 'reagraph';

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'service' | 'symbol' | 'contract';
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'consumes' | 'calls' | 'has_field' | 'binds';
  meta?: Record<string, unknown>;
}

export interface TopologyViewData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const NODE_COLORS: Record<TopologyNode['kind'], string> = {
  service: '#3b82f6',
  symbol: '#8b5cf6',
  contract: '#f59e0b',
};

export function TopologyView({
  data,
  height = 520,
}: {
  data: TopologyViewData;
  height?: number;
}): React.ReactElement {
  const nodes = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    fill: NODE_COLORS[n.kind] ?? NODE_COLORS.service,
  }));

  const edges = data.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    ...(e.label !== undefined ? { label: e.label } : {}),
  }));

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
          layoutType="forceDirected2d"
        />
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-muted">
          No services discovered yet
        </div>
      )}
    </div>
  );
}
