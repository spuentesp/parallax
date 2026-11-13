// ContractList — la lista plana de contratos (lente lista de la referencia de
// diseño "Contracts"): cada endpoint con su tipo, el servicio que lo provee y
// la anotación de consumidores: "2 consumers", "1 + 3 could match" (hay llamadas
// sin resolver que podrían ser suyas), "1 inferred", o "internal only" cuando
// nadie fuera lo consume dentro del alcance analizado.

import type * as React from 'react';
import { useMemo, useState } from 'react';
import type { LooseEndDto, TopologyEdge, TopologyNode } from '../api/hooks.js';
import { EdgeSwatch } from '../map/icons.js';

export interface ContractRow {
  id: string;
  label: string;
  kind: string | null;
  provider: string | null;
  providerId: string | null;
  repo: string | null;
  /** Consumidores distintos unidos por análisis estático. */
  consumers: number;
  /** Consumidores unidos sólo por heurística. */
  inferred: number;
  /** Llamadas sin resolver que podrían apuntar a este contrato. */
  couldMatch: number;
  /** Sin consumidores ni candidatos: sólo uso interno (dentro del alcance). */
  internalOnly: boolean;
}

/** Etiqueta corta del contrato: quita el prefijo de tipo si el filtro ya lo dice. */
function contractKind(label: string): string | null {
  const at = label.indexOf(':');
  return at > 0 && at < 12 ? label.slice(0, at) : null;
}

function ancestorsOf(id: string, byId: Map<string, TopologyNode>): TopologyNode[] {
  const out: TopologyNode[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent ?? null;
  while (cur && !seen.has(cur)) {
    const n = byId.get(cur);
    if (!n) break;
    out.push(n);
    seen.add(cur);
    cur = n.parent;
  }
  return out;
}

/**
 * Construye las filas de contratos a partir de la topología y los cabos
 * sueltos. Pura: se prueba sin componente.
 */
export function buildContractRows(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  looseEnds: readonly LooseEndDto[] | undefined,
): ContractRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Consumidores por endpoint: fuentes distintas de aristas consumes.
  const consumersByEndpoint = new Map<string, { det: Set<string>; inf: Set<string> }>();
  for (const e of edges) {
    if (e.kind !== 'consumes') continue;
    let agg = consumersByEndpoint.get(e.target);
    if (!agg) {
      agg = { det: new Set(), inf: new Set() };
      consumersByEndpoint.set(e.target, agg);
    }
    const meta = (e.meta ?? {}) as {
      binding?: string;
      staticUses?: number;
      heuristicUses?: number;
    };
    const det = (meta.staticUses ?? 0) > 0 || meta.binding === 'static';
    (det ? agg.det : agg.inf).add(e.source);
  }
  // Llamadas sin resolver que podrían ser de cada contrato (por candidato).
  const couldMatchByEndpoint = new Map<string, number>();
  for (const le of looseEnds ?? []) {
    if (le.kind !== 'unresolved') continue;
    for (const c of le.candidates) {
      couldMatchByEndpoint.set(c, (couldMatchByEndpoint.get(c) ?? 0) + 1);
    }
  }

  const rows: ContractRow[] = [];
  for (const n of nodes) {
    if (n.kind !== 'endpoint') continue;
    const chain = ancestorsOf(n.id, byId);
    const provider = chain.find((a) => a.kind === 'service') ?? null;
    const repo = chain.find((a) => a.kind === 'repo') ?? null;
    const agg = consumersByEndpoint.get(n.id);
    const consumers = agg ? agg.det.size : 0;
    const inferred = agg ? agg.inf.size : 0;
    const couldMatch = couldMatchByEndpoint.get(n.label) ?? 0;
    rows.push({
      id: n.id,
      label: n.label,
      kind: contractKind(n.label),
      provider: provider?.label ?? null,
      providerId: provider?.id ?? null,
      repo: repo?.label ?? null,
      consumers,
      inferred,
      couldMatch,
      internalOnly: consumers === 0 && inferred === 0 && couldMatch === 0,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.consumers + b.inferred > 0) - Number(a.consumers + a.inferred > 0) ||
      b.consumers + b.inferred - (a.consumers + a.inferred) ||
      a.label.localeCompare(b.label),
  );
}

/** "2 consumers" / "1 + 3 could match" / "1 inferred" / "internal only". */
export function consumerAnnotation(r: ContractRow): string {
  if (r.internalOnly) return 'internal only';
  const parts: string[] = [];
  if (r.consumers > 0) parts.push(`${r.consumers} consumer${r.consumers === 1 ? '' : 's'}`);
  if (r.inferred > 0) parts.push(`${r.inferred} inferred`);
  if (r.couldMatch > 0) parts.push(`+${r.couldMatch} could match`);
  return parts.join(' · ');
}

export function ContractList({
  nodes,
  edges,
  looseEnds,
  kindFilter,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  looseEnds: readonly LooseEndDto[] | undefined;
  kindFilter?: string | undefined;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => buildContractRows(nodes, edges, looseEnds), [nodes, edges, looseEnds]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false;
      if (q && !`${r.label} ${r.provider ?? ''} ${r.repo ?? ''}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, query, kindFilter]);

  return (
    <div data-testid="contract-list" className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, service or repo"
        aria-label="Search contracts"
        className="h-8 w-full max-w-sm rounded-lg border border-border bg-surface px-3 text-sm outline-none placeholder:text-muted/70 focus:border-accent"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-muted">No contracts match.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {visible.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg">
              <span className="rounded px-1.5 py-0.5 bg-bg border border-border font-mono text-[10px] uppercase text-muted shrink-0">
                {r.kind ?? 'contract'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px]" title={r.label}>
                  {r.label}
                </div>
                <div className="text-[11px] text-muted truncate">
                  {r.provider ?? '—'}
                  {r.repo ? ` · ${r.repo}` : ''}
                </div>
              </div>
              <AnnotationBadge row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnotationBadge({ row }: { row: ContractRow }): React.ReactElement {
  const text = consumerAnnotation(row);
  if (row.internalOnly) {
    return <span className="shrink-0 text-[11px] text-muted italic">{text}</span>;
  }
  return (
    <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
      {row.consumers > 0 && (
        <span className="inline-flex items-center gap-1 text-fg">
          <EdgeSwatch provenance="deterministic" width={16} />
          {row.consumers} consumer{row.consumers === 1 ? '' : 's'}
        </span>
      )}
      {row.inferred > 0 && (
        <span className="inline-flex items-center gap-1 text-warning">
          <EdgeSwatch provenance="inferred" width={16} />
          {row.inferred} inferred
        </span>
      )}
      {row.couldMatch > 0 && (
        <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">
          +{row.couldMatch} could match
        </span>
      )}
      <span className="sr-only">{text}</span>
    </span>
  );
}
