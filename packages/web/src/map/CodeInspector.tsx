// CodeInspector — un nodo del grafo de código (puerta "Code", archivo/módulo o
// símbolo). Lo que LAIN dice de él: de qué tipo es, con qué se comunica
// (agrupado por el tipo de arista con que se consultó) y su fuente.

import type { ProjectedNode } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useSymbolContext } from '../api/hooks.js';
import { type CodeEntry, codeNodeId } from './code.js';
import { KIND_LABEL, KindIcon } from './icons.js';
import { SourcePeek } from './SourcePeek.js';

export interface CodeInspectorProps {
  workspaceId: string;
  nodeId: string;
  node: ProjectedNode | undefined;
  entry: CodeEntry | undefined;
  /** Del padre a la raíz, tal como se ve en el mapa. */
  trail: ProjectedNode[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  relationsActive?: boolean;
  onToggleRelations?: () => void;
}

export function CodeInspector({
  workspaceId,
  nodeId,
  node,
  entry,
  trail,
  onSelect,
  onToggle,
  relationsActive,
  onToggleRelations,
}: CodeInspectorProps): React.ReactElement {
  if (!node) {
    return (
      <div className="p-5 text-sm text-muted" data-testid="code-inspector-missing">
        <p className="font-medium text-fg mb-1">Not loaded</p>
        <p>
          <span className="font-mono">{nodeId}</span> is part of a repository's code graph, which is
          loaded as you open it. Open the repository and its <b>Code</b> node to bring it back.
        </p>
      </div>
    );
  }

  const repo = String(node.meta.repo ?? '');
  const type = typeof node.meta.type === 'string' ? node.meta.type : undefined;
  const isRoot = node.kind === 'code';

  return (
    <div className="divide-y divide-border" data-testid="code-inspector">
      <div className="p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <KindIcon kind={node.kind} />
          <span>{KIND_LABEL[node.kind]}</span>
          {type && (
            <span className="rounded px-1 uppercase tracking-wide bg-bg border border-border">
              {type}
            </span>
          )}
        </div>
        <h3 className="text-sm font-semibold font-mono break-words">{node.label}</h3>
        {trail.length > 0 && (
          <p className="text-xs text-muted break-words">
            {[...trail].reverse().map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' / '}
                <button
                  type="button"
                  className="hover:text-accent hover:underline"
                  onClick={() => onSelect(p.id)}
                >
                  {p.label}
                </button>
              </span>
            ))}
          </p>
        )}
        {node.lazy && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="px-2.5 py-1 rounded-full text-xs bg-bg text-muted hover:bg-border border border-border"
          >
            {node.expanded ? 'Close' : 'Open'}
          </button>
        )}
      </div>

      {isRoot ? (
        <div className="p-5 text-xs text-muted space-y-2">
          <p>
            Files, modules and symbols of <span className="font-mono">{repo}</span>, read from
            LAIN's code graph as you open them.
          </p>
          <p>
            Relationships between code elements are listed per node, not drawn as lines: the engine
            does not say where the other end lives in the tree, or which way the link points.
          </p>
        </div>
      ) : (
        <>
          <Relationships
            entry={entry}
            relationsActive={Boolean(relationsActive)}
            onToggleRelations={onToggleRelations}
          />
          {node.kind === 'symbol' && (
            <CallStackStepper
              workspaceId={workspaceId}
              repo={repo}
              symbol={node.label}
              onStep={(sym) => onSelect(codeNodeId(repo, 'Function', sym))}
            />
          )}
        </>
      )}

      {!isRoot && repo && (type === 'File' || node.kind === 'symbol') && (
        <div className="p-5">
          <SourcePeek
            workspaceId={workspaceId}
            repo={repo}
            target={type === 'File' ? { path: node.label } : node.label}
          />
        </div>
      )}
    </div>
  );
}

function Relationships({
  entry,
  relationsActive,
  onToggleRelations,
}: {
  entry: CodeEntry | undefined;
  relationsActive?: boolean | undefined;
  onToggleRelations?: (() => void) | undefined;
}): React.ReactElement {
  if (!entry || entry.state === 'loading') {
    return <p className="p-5 text-xs text-muted">Loading relationships…</p>;
  }
  if (entry.state === 'error') {
    return <p className="p-5 text-xs text-warning">{entry.message}</p>;
  }
  const groups = entry.communications.filter((g) => g.nodes.length > 0 || g.error);
  if (groups.length === 0) {
    return (
      <p className="p-5 text-xs text-muted" data-testid="code-no-comm">
        No communication edges found for this node.
      </p>
    );
  }
  return (
    <div className="p-5 space-y-3" data-testid="code-relations">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Communicates with
        </h4>
        {onToggleRelations && (
          <button
            type="button"
            onClick={onToggleRelations}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${
              relationsActive
                ? 'bg-accent text-accent-fg border-accent'
                : 'border-border text-muted hover:bg-bg hover:text-fg'
            }`}
          >
            {relationsActive ? 'Hide from canvas' : 'Show on canvas'}
          </button>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.edge}>
          <p className="text-xs font-medium">
            {g.edge}
            <span className="text-muted font-normal"> · {g.nodes.length}</span>
          </p>
          {g.error ? (
            <p className="text-xs text-warning">{g.error}</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {g.nodes.map((n) => (
                <li key={n.id} className="flex items-center gap-1.5 text-[12px]">
                  <KindIcon kind={isOpenableLike(n.type) ? 'file' : 'symbol'} size={12} />
                  <span className="font-mono truncate" title={n.name}>
                    {n.name}
                  </span>
                  <span className="shrink-0 rounded px-1 text-[10px] uppercase tracking-wide bg-bg text-muted border border-border">
                    {n.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-[11px] text-muted">
        Listed by the edge type queried; the engine does not report direction between a node and
        each neighbour.
      </p>
    </div>
  );
}

const isOpenableLike = (type: string): boolean =>
  ['File', 'Namespace', 'Module', 'Package'].includes(type);

function CallStackStepper({
  workspaceId,
  repo,
  symbol,
  onStep,
}: {
  workspaceId: string;
  repo: string;
  symbol: string;
  onStep: (sym: string) => void;
}): React.ReactElement | null {
  const q = useSymbolContext(workspaceId, repo, symbol);
  const ctx = q.data?.context;

  if (q.isPending) return <p className="p-5 text-xs text-muted">Tracing call stack…</p>;
  if (!ctx || q.isError || (ctx.calledBy.length === 0 && ctx.calls.length === 0)) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border" data-testid="call-stack-stepper">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Call Stack Navigation
        </h4>
        {ctx.anchorScore !== undefined && (
          <span className="text-[10px] text-muted rounded bg-bg px-1.5 py-0.5 border border-border">
            Anchor: {ctx.anchorScore.toFixed(0)}
          </span>
        )}
      </div>

      {ctx.calledBy.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted flex items-center gap-1">
            <span>▲ Called by (Upstream)</span>
            <span className="text-muted/60 font-normal">· {ctx.calledBy.length}</span>
          </p>
          <ul className="space-y-1">
            {ctx.calledBy.slice(0, 6).map((caller) => (
              <li key={caller} className="flex items-center justify-between text-xs font-mono">
                <span className="truncate max-w-[13rem]" title={caller}>
                  {caller}
                </span>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] bg-bg border border-border text-accent hover:bg-border font-sans"
                  onClick={() => onStep(caller)}
                >
                  Step back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctx.calls.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted flex items-center gap-1">
            <span>▼ Calls (Downstream)</span>
            <span className="text-muted/60 font-normal">· {ctx.calls.length}</span>
          </p>
          <ul className="space-y-1">
            {ctx.calls.slice(0, 6).map((callee) => (
              <li key={callee} className="flex items-center justify-between text-xs font-mono">
                <span className="truncate max-w-[13rem]" title={callee}>
                  {callee}
                </span>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] bg-bg border border-border text-accent hover:bg-border font-sans"
                  onClick={() => onStep(callee)}
                >
                  Step into
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
