// CodeGraphTree — árbol de código expandible sobre query_graph (paquete raw
// de lain). A diferencia del mapa de contratos (map/MapOutline, datos proyectados), aquí
// cada expansión se pide al vuelo: repo → archivo/módulo → símbolo, y al
// abrir un nodo se muestran sus HIJOS (Contains) y sus VECINOS de
// comunicación rotulados por arista (Calls/Uses/Consumes/…).
//
// El motor no devuelve aristas por par de nodos: los vecinos se agrupan por
// el tipo de arista con el que se consultó. Un nodo sin comunicación dice
// "no communication edges" — nunca se rellena (INV 3).

import type * as React from 'react';
import { useState } from 'react';
import type {
  CodeGraphChildrenResponse,
  CodeGraphNode,
  CodeNodeKind,
  GraphRootResponse,
  GraphSnippetResponse,
} from '../api/hooks.js';
import { codeNodeKey } from '../api/hooks.js';

const KIND_DOT: Record<CodeNodeKind, string> = {
  container: 'var(--color-file)',
  symbol: 'var(--color-symbol)',
  route: 'var(--color-endpoint)',
  schema: 'var(--color-muted)',
  other: 'var(--color-muted)',
};

type ChildEntry =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: CodeGraphChildrenResponse };

export interface CodeGraphTreeProps {
  data: GraphRootResponse;
  fetchChildren: (ref: {
    repo: string;
    type: string;
    name: string;
  }) => Promise<CodeGraphChildrenResponse>;
  fetchSnippet: (repo: string, symbol: string) => Promise<GraphSnippetResponse>;
}

export function CodeGraphTree({
  data,
  fetchChildren,
  fetchSnippet,
}: CodeGraphTreeProps): React.ReactElement {
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, ChildEntry>>({});
  const [snippet, setSnippet] = useState<{
    loading: boolean;
    repo: string;
    symbol: string;
    data?: GraphSnippetResponse;
  } | null>(null);

  const repos = data.graph?.repos ?? [];

  const toggleRepo = (repo: string) =>
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });

  const toggleNode = (repo: string, node: CodeGraphNode) => {
    const key = codeNodeKey(repo, node.type, node.name);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      return next;
    });
    if (children[key] === undefined) {
      setChildren((prev) => ({ ...prev, [key]: { state: 'loading' } }));
      fetchChildren({ repo, type: node.type, name: node.name })
        .then((res) => {
          setChildren((prev) => ({
            ...prev,
            [key]:
              res.source === 'error'
                ? { state: 'error', message: res.error ?? 'expansion failed' }
                : { state: 'ready', data: res },
          }));
        })
        .catch((e: unknown) => {
          setChildren((prev) => ({
            ...prev,
            [key]: {
              state: 'error',
              message: e instanceof Error ? e.message : 'expansion failed',
            },
          }));
        });
    }
  };

  const viewSource = (repo: string, symbol: string) => {
    setSnippet({ loading: true, repo, symbol });
    fetchSnippet(repo, symbol)
      .then((res) => setSnippet({ loading: false, repo, symbol, data: res }))
      .catch((e: unknown) =>
        setSnippet({
          loading: false,
          repo,
          symbol,
          data: {
            snippet: null,
            source: 'error',
            error: e instanceof Error ? e.message : 'snippet failed',
          },
        }),
      );
  };

  if (data.source === 'unconfigured') {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
        This workspace has no LAIN server configured — connect one to browse its code graph.
      </div>
    );
  }
  if (repos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
        {data.source === 'error'
          ? `LAIN error: ${data.error ?? 'unreachable'}`
          : 'No repositories to browse.'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <div
        data-testid="code-graph-tree"
        className="rounded-xl border border-border bg-surface overflow-hidden"
      >
        <div className="px-4 py-2.5 border-b border-border">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
            Code graph — repo → file/module → symbol
          </h3>
        </div>
        <div className="max-h-[560px] overflow-y-auto py-1">
          {repos.map((repo) => {
            const open = !collapsedRepos.has(repo.repo);
            return (
              <div key={repo.repo}>
                <button
                  type="button"
                  onClick={() => toggleRepo(repo.repo)}
                  className="w-full text-left flex items-center gap-2 py-1 pr-4 text-sm hover:bg-bg transition-colors"
                  style={{ paddingLeft: '1rem' }}
                >
                  <span className="w-3 text-muted text-xs">{open ? '▾' : '▸'}</span>
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{ background: 'var(--color-repo)', width: 10, height: 10 }}
                  />
                  <span className="font-medium">{repo.repo}</span>
                  <span className="ml-auto text-xs text-muted whitespace-nowrap">
                    {repo.nodes.length} node{repo.nodes.length === 1 ? '' : 's'}
                    {repo.truncated ? ' (truncated)' : ''}
                  </span>
                </button>
                {repo.error && (
                  <p className="pl-10 pr-4 py-1 text-xs text-error">
                    Could not load this repo: {repo.error}
                  </p>
                )}
                {open &&
                  repo.nodes.map((node) => (
                    <NodeRow
                      key={codeNodeKey(repo.repo, node.type, node.name)}
                      repo={repo.repo}
                      node={node}
                      depth={1}
                      expanded={expanded}
                      childMap={children}
                      onToggle={toggleNode}
                      onViewSource={viewSource}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      <SnippetPanel snippet={snippet} />
    </div>
  );
}

function NodeRow({
  repo,
  node,
  depth,
  expanded,
  childMap,
  onToggle,
  onViewSource,
}: {
  repo: string;
  node: CodeGraphNode;
  depth: number;
  expanded: Set<string>;
  childMap: Record<string, ChildEntry>;
  onToggle: (repo: string, node: CodeGraphNode) => void;
  onViewSource: (repo: string, symbol: string) => void;
}): React.ReactElement {
  const key = codeNodeKey(repo, node.type, node.name);
  const isOpen = expanded.has(key);
  const entry = childMap[key];
  const canExpand = node.kind !== 'schema';
  const canViewSource = node.kind === 'symbol';

  return (
    <div>
      <div
        className="w-full flex items-center gap-2 py-1 pr-3 text-sm hover:bg-bg transition-colors"
        style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
      >
        <button
          type="button"
          onClick={() => canExpand && onToggle(repo, node)}
          disabled={!canExpand}
          className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:hover:bg-transparent"
          data-testid={`graph-node-${key}`}
        >
          <span className="w-3 text-muted text-xs shrink-0">
            {canExpand ? (isOpen ? '▾' : '▸') : '•'}
          </span>
          <span
            className="inline-block rounded-full shrink-0"
            style={{ background: KIND_DOT[node.kind], width: 7, height: 7 }}
          />
          <span className="text-[11px] px-1 rounded bg-bg text-muted shrink-0">{node.type}</span>
          <span className={`truncate ${node.kind === 'symbol' ? 'font-mono text-xs' : ''}`}>
            {node.name}
          </span>
        </button>
        {canViewSource && (
          <button
            type="button"
            onClick={() => onViewSource(repo, node.name)}
            className="text-xs text-accent hover:underline shrink-0"
            title="View source via get_code_snippet"
          >
            source
          </button>
        )}
      </div>

      {isOpen && entry?.state === 'loading' && (
        <p className="text-xs text-muted" style={{ paddingLeft: `${2 + depth * 1.25}rem` }}>
          Loading…
        </p>
      )}
      {isOpen && entry?.state === 'error' && (
        <p className="text-xs text-error" style={{ paddingLeft: `${2 + depth * 1.25}rem` }}>
          Expansion failed: {entry.message}
        </p>
      )}
      {isOpen && entry?.state === 'ready' && (
        <div>
          {entry.data.childrenTruncated && (
            <p
              className="text-xs text-muted italic"
              style={{ paddingLeft: `${2 + depth * 1.25}rem` }}
            >
              Showing the first children only — more may exist.
            </p>
          )}
          {entry.data.children?.length === 0 && (
            <p className="text-xs text-muted" style={{ paddingLeft: `${2 + depth * 1.25}rem` }}>
              No children — this node contains no further symbols.
            </p>
          )}
          {entry.data.children?.map((child) => (
            <NodeRow
              key={codeNodeKey(repo, child.type, child.name)}
              repo={repo}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              childMap={childMap}
              onToggle={onToggle}
              onViewSource={onViewSource}
            />
          ))}
          {!entry.data.hasCommunication && (
            <p
              className="text-xs text-muted italic"
              style={{ paddingLeft: `${2 + depth * 1.25}rem` }}
            >
              No communication edges for this node.
            </p>
          )}
          {entry.data.communications?.map((group) => (
            <div key={group.edge}>
              {group.error ? (
                <p
                  className="text-xs text-warning"
                  style={{ paddingLeft: `${2 + depth * 1.25}rem` }}
                >
                  {group.edge}: query failed ({group.error})
                </p>
              ) : (
                group.nodes.map((n) => (
                  <div
                    key={`${group.edge}:${n.type}:${n.name}`}
                    className="flex items-start gap-2 py-0.5 text-xs"
                    style={{ paddingLeft: `${2.5 + depth * 1.25}rem` }}
                  >
                    <span className="text-accent shrink-0">↔</span>
                    <span className="px-1 rounded bg-bg text-muted shrink-0">{group.edge}</span>
                    <span className="text-[11px] text-muted shrink-0">{n.type}</span>
                    <span className="truncate font-mono">{n.name}</span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SnippetPanel({
  snippet,
}: {
  snippet: { loading: boolean; repo: string; symbol: string; data?: GraphSnippetResponse } | null;
}): React.ReactElement {
  if (!snippet) {
    return (
      <div
        data-testid="snippet-panel"
        className="rounded-xl border border-dashed border-border p-6 text-sm text-muted"
      >
        Click “source” on a symbol to read it here.
      </div>
    );
  }
  const res = snippet.data;
  const s = res?.snippet;
  return (
    <div
      data-testid="snippet-panel"
      className="rounded-xl border border-border bg-surface overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted font-mono">
          {snippet.repo} · {snippet.symbol}
        </h3>
        {s?.path && <span className="text-xs text-accent font-mono">{s.path}</span>}
      </div>
      <div className="max-h-[560px] overflow-auto p-4">
        {snippet.loading && <p className="text-sm text-muted">Loading snippet…</p>}
        {!snippet.loading && res?.source === 'error' && (
          <p className="text-sm text-error">Could not load snippet: {res.error}</p>
        )}
        {!snippet.loading && s?.error && <p className="text-sm text-warning">{s.error}</p>}
        {!snippet.loading && s?.text && (
          <pre className="text-xs font-mono whitespace-pre-wrap text-muted">{s.text}</pre>
        )}
      </div>
    </div>
  );
}
