// MapOutline — el árbol del mapa. Misma proyección que el lienzo (lo que está
// abierto en uno está abierto en el otro): repo → servicio → endpoint, con
// tipo de contrato, número de hijos y un "+N más" cuando el servidor recortó.
// Teclado: ↑/↓ mover, → abrir, ← cerrar o subir al padre, Enter seleccionar.

import type { MapViewResponse, ProjectedNode } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useMemo } from 'react';
import { canOpen } from './code.js';
import { KindIcon } from './icons.js';

export interface MapOutlineProps {
  view: Pick<MapViewResponse, 'nodes' | 'hiddenChildren'>;
  selectedId: string | null;
  focusIds: ReadonlySet<string> | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onMore: (parentId: string) => void;
}

interface Row {
  node: ProjectedNode;
  depth: number;
}

/** Aplana el árbol visible en orden de lectura (padres antes que hijos). */
export function flattenOutline(nodes: readonly ProjectedNode[]): Row[] {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string | null, ProjectedNode[]>();
  for (const n of nodes) {
    const key = n.parent !== null && ids.has(n.parent) ? n.parent : null;
    const list = kids.get(key) ?? [];
    list.push(n);
    kids.set(key, list);
  }
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const list = [...(kids.get(parent) ?? [])].sort((a, b) => a.label.localeCompare(b.label));
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // Un ciclo de padres (o un nodo que es su propio padre) no cuelga de ninguna
  // raíz: se muestra como raíz en vez de desaparecer del árbol.
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push({ node: n, depth: 0 });
    walk(n.id, 1);
  }
  return out;
}

function displayLabel(n: ProjectedNode): string {
  if (n.kind !== 'endpoint') return n.label;
  const at = n.label.indexOf(':');
  return at > 0 && at < 10 ? n.label.slice(at + 1) : n.label;
}

export function MapOutline({
  view,
  selectedId,
  focusIds,
  onSelect,
  onToggle,
  onMore,
}: MapOutlineProps): React.ReactElement {
  const rows = useMemo(() => flattenOutline(view.nodes), [view.nodes]);
  // Sin selección visible, la primera fila es la entrada de tabulador del árbol.
  const hasSelection = rows.some((r) => r.node.id === selectedId);

  const onKey = (e: React.KeyboardEvent, row: Row, index: number) => {
    const move = (to: number) => {
      const target = rows[to];
      if (!target) return;
      e.preventDefault();
      onSelect(target.node.id);
      (
        e.currentTarget.parentElement?.querySelectorAll('[role=treeitem]')[to] as
          | HTMLElement
          | undefined
      )?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'ArrowRight' && row.node.childCount > 0 && !row.node.expanded) {
      e.preventDefault();
      onToggle(row.node.id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (row.node.expanded) onToggle(row.node.id);
      else if (row.node.parent) onSelect(row.node.parent);
    }
  };

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">Nothing to show for these filters.</p>;
  }

  return (
    <div role="tree" aria-label="Organization structure" data-testid="map-outline" className="py-1">
      {rows.map((row, i) => {
        const n = row.node;
        const selected = n.id === selectedId;
        const inFocus = focusIds?.has(n.id) ?? false;
        const hidden = view.hiddenChildren[n.id] ?? 0;
        // Los nodos de código (lazy) se abren sin saber cuántos hijos tienen.
        const openable = canOpen(n);
        const loading = n.meta.loading === true;
        const failed = typeof n.meta.error === 'string' ? n.meta.error : null;
        return (
          <div key={n.id}>
            <div
              role="treeitem"
              tabIndex={selected || (!hasSelection && i === 0) ? 0 : -1}
              aria-selected={selected}
              aria-expanded={openable ? n.expanded : undefined}
              data-node-id={n.id}
              onClick={() => onSelect(n.id)}
              onDoubleClick={() => openable && onToggle(n.id)}
              onKeyDown={(e) => onKey(e, row, i)}
              className={`group flex items-center gap-1.5 pr-3 py-[3px] text-[13px] cursor-pointer outline-none border-l-2 ${
                selected
                  ? 'bg-accent/10 border-accent'
                  : inFocus
                    ? 'border-accent/40 hover:bg-bg'
                    : 'border-transparent hover:bg-bg'
              }`}
              style={{ paddingLeft: 8 + row.depth * 16 }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={n.expanded ? `Collapse ${n.label}` : `Expand ${n.label}`}
                disabled={!openable}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(n.id);
                }}
                className={`w-4 h-4 grid place-items-center rounded text-muted ${
                  openable ? 'hover:bg-border' : 'opacity-0'
                }`}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  aria-hidden="true"
                  className={`transition-transform ${n.expanded ? 'rotate-90' : ''}`}
                >
                  <path d="M2 1l4 3-4 3z" fill="currentColor" />
                </svg>
              </button>
              <KindIcon kind={n.kind} />
              <span
                className={`truncate ${n.kind === 'endpoint' || n.kind === 'file' || n.kind === 'symbol' ? 'font-mono text-[12px]' : n.kind === 'repo' ? 'font-semibold' : ''}`}
                title={n.label}
              >
                {displayLabel(n)}
              </span>
              {n.contract && (
                <span className="shrink-0 rounded px-1 text-[10px] leading-4 uppercase tracking-wide bg-bg text-muted border border-border">
                  {n.contract}
                </span>
              )}
              {loading && <span className="ml-auto shrink-0 text-[11px] text-muted">loading…</span>}
              {failed && (
                <span className="ml-auto shrink-0 text-[11px] text-error" title={failed}>
                  failed
                </span>
              )}
              {openable && !n.expanded && n.childCount > 0 && !loading && !failed && (
                <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted">
                  {n.childCount}
                </span>
              )}
            </div>
            {n.expanded && n.meta.truncated === true && (
              <p
                className="text-[11px] text-muted py-0.5"
                style={{ paddingLeft: 8 + (row.depth + 1) * 16 + 22 }}
              >
                Showing the first entries — more exist than shown.
              </p>
            )}
            {n.expanded && typeof n.meta.hiddenNoise === 'number' && n.meta.hiddenNoise > 0 && (
              <p
                className="text-[11px] text-muted py-0.5"
                data-testid="code-hidden-note"
                style={{ paddingLeft: 8 + (row.depth + 1) * 16 + 22 }}
              >
                {n.meta.hiddenNoise} hidden: dot folders, tests, stories, tooling.
              </p>
            )}
            {n.expanded && hidden > 0 && (
              <button
                type="button"
                onClick={() => onMore(n.id)}
                className="text-[12px] text-accent hover:underline py-0.5"
                style={{ paddingLeft: 8 + (row.depth + 1) * 16 + 22 }}
              >
                +{hidden} more…
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
