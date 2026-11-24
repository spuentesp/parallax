// The relationship net: who depends on what the ticket changes.
// Solid green edges are proven by code; dashed amber edges are inferred and need checking.
import { layoutGraph, shortLabel, truncate } from './layout.js';

const WIDTH = 640;
const CRITICALITY = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };

function Node({ node }) {
  const isConsumer = node.kind === 'consumer';
  const crit = CRITICALITY[String(node.criticality).toLowerCase()];
  const main = isConsumer ? node.label : shortLabel(node.label);
  let sub;
  if (isConsumer) sub = node.detail ? `owner: ${node.detail}` : 'no owner recorded';
  else if (node.isolated) sub = `${node.detail ?? 'target'} · no consumers found`;
  else sub = node.detail ?? '';

  return (
    <g
      className={`node ${node.kind}${crit ? ` crit-${crit}` : ''}${node.isolated ? ' isolated' : ''}`}
    >
      <title>{`${node.label}${isConsumer && node.detail ? ` · owner ${node.detail}` : ''}${node.criticality ? ` · ${node.criticality} criticality` : ''}`}</title>
      <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="6" />
      <text x={node.x + 10} y={node.y + 14} className="node-label">
        {truncate(main, 26)}
      </text>
      <text x={node.x + 10} y={node.y + 26} className="node-sub">
        {truncate(sub, 32)}
      </text>
      {crit && (
        <circle cx={node.x + node.w - 12} cy={node.y + node.h / 2} r="4" className="crit-dot" />
      )}
    </g>
  );
}

export default function Graph({ graph }) {
  if (!graph?.nodes?.length) return null;
  const laid = layoutGraph(graph, WIDTH);

  return (
    <svg
      className="graph"
      viewBox={`0 0 ${laid.width} ${laid.height}`}
      role="img"
      aria-label="Consumers on the left depend on the things this ticket changes on the right"
    >
      <defs>
        <marker id="arrow-proven" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="arrow proven" />
        </marker>
        <marker id="arrow-inferred" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="arrow inferred" />
        </marker>
      </defs>

      {laid.edges.map((e) => {
        const proven = e.provenance === 'deterministic';
        return (
          <path
            key={`${e.from}->${e.to}`}
            d={e.path}
            className={`edge ${proven ? 'proven' : 'inferred'}`}
            strokeWidth={e.width}
            markerEnd={`url(#arrow-${proven ? 'proven' : 'inferred'})`}
          >
            <title>{`${proven ? 'Proven by code' : 'Inferred (heuristic)'} · ${e.usages ?? '?'} usages`}</title>
          </path>
        );
      })}

      {laid.nodes.map((n) => (
        <Node key={n.id} node={n} />
      ))}
    </svg>
  );
}
