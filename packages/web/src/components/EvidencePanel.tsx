// EvidencePanel — abre el código al que apunta cada cita.
//
// INV 1: toda cita publicada referencia SHAs concretos y evidencia resoluble.
// INV 3: una ref que no resuelve se muestra como exists:false, nunca se oculta.
// La fuente es resolve_evidence + read_source contra la misma vista del motor.

import type * as React from 'react';

export interface EvidenceAnchor {
  id: string;
  name?: string | undefined;
  node_type: string;
  ref: {
    commit: string;
    id: string;
    line: number;
    path: string;
    repo: string;
    text?: string | undefined;
  };
}

export interface EvidenceSource {
  text: string;
  path: string;
  start: number;
  end: number;
  commit: string;
  total_lines: number;
  source?: string | undefined;
  error?: string | undefined;
}

export interface EvidenceItem {
  exists: boolean;
  ref: string;
  reason?: string | undefined;
  snippet?: string | null | undefined;
  node?: EvidenceAnchor | undefined;
  source?: EvidenceSource | null | undefined;
}

export function EvidencePanel({ items = [] }: { items?: EvidenceItem[] }): React.ReactElement {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
        No citations to resolve.
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="evidence-panel">
      {items.map((item) => (
        <EvidenceCard key={item.ref} item={item} />
      ))}
    </div>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }): React.ReactElement {
  const anchor = item.node?.ref;
  const src = item.source ?? null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <div className="font-mono text-xs break-all">
            {anchor ? (
              <>
                <span className="text-fg">{anchor.repo}</span>
                <span className="text-muted">@</span>
                <span className="text-muted">{anchor.commit.slice(0, 10)}</span>
                <span className="text-muted">:</span>
                <span className="text-accent">{anchor.path}</span>
                <span className="text-muted">:{anchor.line}</span>
              </>
            ) : (
              <span className="text-muted break-all">{item.ref}</span>
            )}
          </div>
          {item.node?.name && (
            <div className="text-xs text-muted mt-0.5">
              {item.node.node_type} · {item.node.name}
            </div>
          )}
        </div>
        {item.exists ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-success/15 text-success whitespace-nowrap">
            resuelta
          </span>
        ) : (
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-error/15 text-error whitespace-nowrap"
            title={item.reason}
          >
            no resuelve
          </span>
        )}
      </div>

      {/* INV 3: la ref rota sigue visible con su motivo. */}
      {!item.exists && item.reason && (
        <div className="px-4 py-2 text-xs text-error bg-error/5 border-b border-border">
          {item.reason}
        </div>
      )}

      {src && typeof src.text === 'string' ? (
        <CodeBlock source={src} highlightLine={anchor?.line ?? null} />
      ) : src?.error ? (
        <div className="px-4 py-3 text-xs text-warning">No se pudo leer la fuente: {src.error}</div>
      ) : item.snippet ? (
        <pre className="px-4 py-3 text-xs font-mono overflow-x-auto text-muted whitespace-pre">
          {item.snippet}
        </pre>
      ) : null}
    </div>
  );
}

function CodeBlock({
  source,
  highlightLine,
}: {
  source: EvidenceSource;
  highlightLine: number | null;
}): React.ReactElement {
  const lines = source.text.split('\n');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const lineNo = source.start + i + 1;
            const isTarget = highlightLine != null && lineNo === highlightLine;
            return (
              <tr
                key={lineNo}
                className={isTarget ? 'bg-accent/15' : undefined}
                data-cited={isTarget ? 'true' : undefined}
              >
                <td
                  className={`select-none text-right px-3 py-0.5 whitespace-nowrap border-r border-border ${
                    isTarget ? 'text-accent font-semibold' : 'text-muted'
                  }`}
                >
                  {lineNo}
                </td>
                <td
                  className={`px-3 py-0.5 whitespace-pre ${
                    isTarget ? 'text-fg font-medium' : 'text-fg/80'
                  }`}
                >
                  {line || ' '}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
