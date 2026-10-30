import type * as React from 'react';
import { useState } from 'react';
import { useTraceFlow } from '../api/hooks.js';

export function TraceFlowVisualizer({
  workspaceId,
  contract,
}: {
  workspaceId: string;
  contract: { key: string; service: string | null };
}): React.ReactElement {
  const [strategy, setStrategy] = useState<'breadth' | 'depth'>('breadth');
  const [direction, setDirection] = useState<'downstream' | 'upstream'>('downstream');
  const [depth, setDepth] = useState(6);
  const flow = useTraceFlow(workspaceId);
  const result = flow.data;

  const run = () => {
    if (!contract.service) return;
    flow.mutate({
      snapshot: 'live',
      from: {
        endpoint: {
          key: contract.key,
          service: contract.service,
        },
      },
      direction,
      strategy,
      depth,
      cap: 50,
    });
  };

  return (
    <div className="space-y-4 p-4" data-testid="native-flow-visualizer">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          Strategy
          <select
            className="ml-1 rounded border border-border bg-bg px-2 py-1"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as 'breadth' | 'depth')}
          >
            <option value="breadth">Breadth</option>
            <option value="depth">Depth</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Direction
          <select
            className="ml-1 rounded border border-border bg-bg px-2 py-1"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'downstream' | 'upstream')}
          >
            <option value="downstream">Toward data</option>
            <option value="upstream">Toward consumers</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Max depth
          <input
            className="ml-1 w-14 rounded border border-border bg-bg px-2 py-1"
            type="number"
            min={1}
            max={12}
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 text-xs text-accent-fg disabled:opacity-50"
          disabled={flow.isPending || !contract.service}
          onClick={run}
        >
          Run native flow
        </button>
      </div>
      {!contract.service && (
        <p className="text-xs text-warning">Native endpoint tracing requires a service.</p>
      )}
      {flow.isPending && <p className="text-xs text-muted">Running Lain trace_flow…</p>}
      {flow.error && <p className="text-xs text-error">Native flow failed: {String(flow.error)}</p>}
      {result && (
        <>
          <div className="text-xs text-muted" data-testid="native-flow-stats">
            {result.nodes_visited} nodes visited · {result.paths.length} paths ·{' '}
            {result.gaps.length} gaps
            {result.truncated ? ` · truncated (${result.truncation_reasons.join(', ')})` : ''}
          </div>
          {result.paths.map((path) => (
            <ol
              key={path.hops.map((hop) => hop.id).join('>')}
              className="space-y-2"
              data-testid="native-flow-path"
            >
              {path.hops.map((hop) => (
                <li key={hop.id} className="rounded border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{hop.name}</span>
                    <span
                      className={`text-[10px] ${hop.engine_fact ? 'text-success' : 'text-warning'}`}
                    >
                      {hop.engine_fact ? 'engine fact' : 'inferred'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {hop.node_type}
                    {hop.edge_type ? ` · ${hop.edge_type}` : ''}
                  </div>
                  {hop.path && (
                    <div className="mt-1 font-mono text-[10px] text-muted">
                      {hop.repo}:{hop.path}:{hop.line ?? '?'}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ))}
          {result.gaps.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold">Gaps</h4>
              <ul className="mt-1 space-y-1 text-xs text-warning" data-testid="native-flow-gaps">
                {result.gaps.map((gap) => (
                  <li key={`${gap.node}:${gap.kind}`}>
                    <strong>{gap.kind}</strong> · {gap.name}: {gap.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
