import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from './lain-adapter/types.js';

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

export interface TopologyStats {
  services: number;
  dependencies: number;
  repos: string[];
  unresolvedInbound: number;
}

export interface TopologyResult extends TopologyViewData {
  stats: TopologyStats;
}

/**
 * Build a service topology graph from a running LAIN server.
 *
 * Nodes come from `list_services`. Edges come from `get_service`: for each
 * service S, every entry in `S.consumers` is a service that depends on S, so
 * the edge is `consumer -> S`. Consumers that LAIN saw but did not list as
 * services (e.g. a client outside the configured services) are added as
 * extra nodes so the graph stays connected.
 */
export async function buildServiceTopology(
  adapter: LainAdapter,
  view: LainView = 'live',
): Promise<TopologyResult> {
  const listed = await adapter.listServices(view);

  const nodes: TopologyNode[] = listed.items.map((s) => ({
    id: s.service,
    label: s.service,
    kind: 'service' as const,
    meta: {
      repo: s.repo,
      endpoints: s.endpoints,
      consumerServices: s.consumer_services,
      unresolvedInbound: s.unresolved_inbound,
    },
  }));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: TopologyEdge[] = [];
  const seen = new Set<string>();
  const repos = new Set<string>();
  let unresolvedInbound = 0;

  for (const s of listed.items) {
    repos.add(s.repo);
    unresolvedInbound += s.unresolved_inbound;
    const detail = await adapter.getService(view, { view, service: s.service });
    for (const c of detail.consumers) {
      // A consumer that is the service itself is an internal read (e.g. a
      // table: endpoint used inside its own code), not a topology edge.
      if (c.service === s.service) continue;
      const key = `${c.service}->${s.service}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const surfaces = c.uses
        .map((u) => u.endpoint?.key)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      const kinds = new Set(c.uses.map((u) => u.binding.kind));
      const maxConfidence = c.uses.reduce(
        (acc, u) => Math.max(acc, u.binding.confidence),
        0,
      );
      edges.push({
        source: c.service,
        target: s.service,
        kind: 'consumes',
        label: surfaces[0] ?? 'uses',
        meta: {
          binding: [...kinds].join('+'),
          confidence: maxConfidence,
          useCount: c.uses.length,
          surfaces,
          repo: c.repo,
        },
      });
    }
  }

  for (const e of edges) {
    if (!nodeIds.has(e.source)) {
      nodeIds.add(e.source);
      nodes.push({ id: e.source, label: e.source, kind: 'service' });
    }
    if (!nodeIds.has(e.target)) {
      nodeIds.add(e.target);
      nodes.push({ id: e.target, label: e.target, kind: 'service' });
    }
  }

  return {
    nodes,
    edges,
    stats: {
      services: nodes.length,
      dependencies: edges.length,
      repos: [...repos],
      unresolvedInbound,
    },
  };
}
