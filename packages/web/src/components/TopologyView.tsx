// TopologyView — grafo a nivel de endpoint.
//
// Dos clases de nodo: servicios (quién expone) y endpoints/contratos (qué se
// expone). Dos clases de arista: `provides` (el servicio expone el endpoint) y
// `consumes` (un servicio usa ese endpoint), rotulada con el campo que lee.

import type * as React from 'react';
import { GraphCanvas, darkTheme } from 'reagraph';

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'service' | 'endpoint';
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'provides' | 'consumes';
  meta?: Record<string, unknown>;
}

export interface TopologyViewData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const NODE_FILL: Record<TopologyNode['kind'], string> = {
  service: '#3b82f6',
  endpoint: '#f59e0b',
};

const NODE_SIZE: Record<TopologyNode['kind'], number> = {
  service: 22,
  endpoint: 11,
};

export function TopologyView({
  data,
  height = 560,
}: {
  data: TopologyViewData;
  height?: number;
}): React.ReactElement {
  const nodes = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    fill: NODE_FILL[n.kind] ?? NODE_FILL.service,
    size: NODE_SIZE[n.kind] ?? 14,
  }));

  const edges = data.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    ...(e.label !== undefined ? { label: e.label } : {}),
    // `consumes` es la dependencia real; `provides` sólo amarra el endpoint a
    // su dueño, así que va tenue para no competir visualmente.
    ...(e.kind === 'provides'
      ? { fill: 'rgba(148, 163, 184, 0.35)', strokeWidth: 1 }
      : { fill: 'rgba(59, 130, 246, 0.85)', strokeWidth: 2 }),
  }));

  return (
    <div
      data-testid="topology-view"
      className="relative w-full rounded-xl overflow-hidden border border-border bg-bg"
      style={{ height }}
    >
      {nodes.length > 0 ? (
        <GraphCanvas nodes={nodes} edges={edges} labelType="all" theme={darkTheme} layoutType="forceDirected2d" />
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-muted">
          No endpoints match these filters
        </div>
      )}
    </div>
  );
}

export function TopologyLegend(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-full" style={{ background: NODE_FILL.service }} />
        Service
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: NODE_FILL.endpoint }}
        />
        Endpoint / contract
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-0.5" style={{ background: 'rgba(59,130,246,0.85)' }} />
        consumes (rotulado con el campo leído)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 h-0.5" style={{ background: 'rgba(148,163,184,0.5)' }} />
        provides
      </span>
    </div>
  );
}
