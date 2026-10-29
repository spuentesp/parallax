// CodeInspector — un nodo del grafo de código (puerta "Code", archivo/módulo o
// símbolo). Lo que LAIN dice de él: de qué tipo es, con qué se comunica
// (agrupado por el tipo de arista con que se consultó) y su fuente.

import type { ProjectedNode } from '@parallax/shared/org-map';
import type * as React from 'react';
import type { CodeEntry } from './code.js';
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
}

export function CodeInspector({
  workspaceId,
  nodeId,
  node,
  entry,
  trail,
  onSelect,
  onToggle,
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
        <Relationships entry={entry} />
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

function Relationships({ entry }: { entry: CodeEntry | undefined }): React.ReactElement {
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
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted">
        Communicates with
      </h4>
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
