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
