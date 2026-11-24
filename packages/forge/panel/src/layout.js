// Lays out the relationship graph: consumers on the left, the things the ticket changes on the
// right, a curved edge from each consumer to what it depends on. Pure, so it can be tested.
//
//   graph: { nodes: [{ id, label, kind: 'consumer'|'target', detail, criticality }],
//            edges: [{ from, to, provenance, usages }] }

export const ROW = 46; // vertical distance between nodes
export const PAD = 20;
export const NODE_W = 210;
export const NODE_H = 32;
const MIN_HEIGHT = 80;

// Shorten long names for display; the full name stays available as a tooltip.
export function truncate(text, max = 28) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// Strip the machine prefix from a contract label: "rpc:openshell.v1.OpenShell/CreateSandbox"
// is read as "CreateSandbox", and "http:POST /v1/x" as "POST /v1/x".
export function shortLabel(label) {
  const s = String(label ?? '');
  const http = s.match(/^http:(.*)$/);
  if (http) return http[1];
  const rpc = s.match(/^rpc:.*\/(\w+)$/);
  return rpc ? rpc[1] : s;
}

// Order consumers by the average position of the targets they point at, so edges cross less
// (one pass of the barycentre heuristic). Ties keep the original order.
function orderConsumers(consumers, targets, edges) {
  const targetIndex = new Map(targets.map((t, i) => [t.id, i]));
  const score = new Map();
  for (const c of consumers) {
    const idx = edges.filter((e) => e.from === c.id).map((e) => targetIndex.get(e.to));
    const known = idx.filter((i) => i !== undefined);
    score.set(c.id, known.length ? known.reduce((a, b) => a + b, 0) / known.length : Infinity);
  }
  return [...consumers].sort((a, b) => score.get(a.id) - score.get(b.id));
}

// Edge thickness grows with how often the consumer uses the target, but only slowly.
export function strokeWidth(usages) {
  const n = Math.max(1, Number(usages) || 1);
  return Math.min(5, 1 + Math.log10(n) * 1.6);
}

// Compute positions. `width` is the drawing width in SVG units.
export function layoutGraph(graph, width = 640) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  // Targets that something depends on come first; ones nothing depends on sink to the bottom,
  // where they read as "named in the ticket, no consumers" instead of drawing the eye.
  const edgeCount = (id) => edges.filter((e) => e.to === id).length;
  const targets = nodes
    .filter((n) => n.kind === 'target')
    .sort((a, b) => edgeCount(b.id) - edgeCount(a.id));
  const consumers = orderConsumers(
    nodes.filter((n) => n.kind === 'consumer'),
    targets,
    edges,
  );

  const rows = Math.max(targets.length, consumers.length);
  const height = Math.max(MIN_HEIGHT, PAD * 2 + rows * ROW - (ROW - NODE_H));

  // Centre the shorter lane against the longer one.
  const place = (lane, x) => {
    const span = lane.length * ROW - (ROW - NODE_H);
    const top = (height - span) / 2;
    return lane.map((n, i) => ({
      ...n,
      x,
      y: top + i * ROW,
      w: NODE_W,
      h: NODE_H,
      isolated: !edges.some((e) => e.from === n.id || e.to === n.id),
    }));
  };
  const placedConsumers = place(consumers, PAD);
  const placedTargets = place(targets, width - PAD - NODE_W);
  const byId = new Map([...placedConsumers, ...placedTargets].map((n) => [n.id, n]));

  const placedEdges = edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + b.h / 2;
      const mid = (x1 + x2) / 2;
      return {
        ...e,
        path: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
        width: strokeWidth(e.usages),
      };
    });

  return { width, height, nodes: [...placedConsumers, ...placedTargets], edges: placedEdges };
}
