// TopologyView — reagraph-based service topology visualization.

import { GraphCanvas } from 'reagraph';

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'service' | 'symbol' | 'contract';
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'consumes' | 'calls' | 'has_field' | 'binds';
}

export interface TopologyViewData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const _NODE_COLORS: Record<TopologyNode['kind'], string> = {
  service: '#3b82f6',
  symbol: '#8b5cf6',
  contract: '#f59e0b',
};

export function TopologyView({ data }: { data: TopologyViewData }): React.ReactElement {
  const nodes = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
  }));

  const edges = data.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
  }));

  return (
    <div
      data-testid="topology-view"
      style={{
        width: '100%',
        height: 500,
        background: '#0f172a',
        borderRadius: 12,
        border: '1px solid #1e293b',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {nodes.length > 0 ? (
        <GraphCanvas nodes={nodes} edges={edges} />
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748b',
            fontSize: 14,
          }}
        >
          No services discovered yet
        </div>
      )}
    </div>
  );
}
