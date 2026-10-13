// TopologyView — curated graph of services and their relationships.
// Nodes = services, edges = consumers/contracts. The agent curates which
// nodes/edges to include (not the whole codebase).

import cytoscape from 'cytoscape';
import { useEffect, useRef } from 'react';

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

const EDGE_COLORS: Record<TopologyEdge['kind'], string> = {
  consumes: '#64748b',
  calls: '#3b82f6',
  has_field: '#10b981',
  binds: '#f59e0b',
};

export function TopologyView({ data }: { data: TopologyViewData }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((n, i) => ({
          data: { id: n.id, label: n.label, kind: n.kind },
          position: { x: 100 + (i % 3) * 150, y: 100 + Math.floor(i / 3) * 120 },
        })),
        ...data.edges.map((e, i) => ({
          data: {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            label: e.label ?? e.kind,
            kind: e.kind,
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            color: '#fff',
            'font-size': '11px',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            width: 60,
            height: 60,
            'background-color': (ele: cytoscape.NodeSingular) =>
              NODE_COLORS[ele.data('kind') as TopologyNode['kind']] ?? '#64748b',
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'font-size': '9px',
            color: '#94a3b8',
            'text-rotation': 'autorotate',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': (ele: cytoscape.EdgeSingular) =>
              EDGE_COLORS[ele.data('kind') as TopologyEdge['kind']] ?? '#64748b',
            'target-arrow-color': (ele: cytoscape.EdgeSingular) =>
              EDGE_COLORS[ele.data('kind') as TopologyEdge['kind']] ?? '#64748b',
            width: 2,
          },
        },
      ],
      layout: { name: 'preset' },
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);

  return (
    <div
      ref={containerRef}
      data-testid="topology-view"
      style={{
        width: '100%',
        height: 400,
        background: '#0f172a',
        borderRadius: 8,
        border: '1px solid #1e293b',
      }}
    />
  );
}
