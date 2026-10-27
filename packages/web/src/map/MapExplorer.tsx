// MapExplorer — el centro de mando de la arquitectura: jerarquía repo →
// servicio → endpoint (árbol + lienzo compuesto), filtros por tipo de contrato
// y por procedencia de la relación, búsqueda, foco por vecindad y un
// inspector que responde "¿quién consume esto?".
//
// Carga perezosa: el servidor sólo manda lo visible; abrir un nodo pide otra
// proyección. El estado que debe poder compartirse (selección, foco, filtros)
// vive en la URL, así un agente o un enlace pueden dejar el mapa apuntando a
// un subgrafo concreto: ?focus=<id>&hops=1&sel=<id>.

import type { MapMeta, OrgGraphFilters, Provenance } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMapSearch, useOrgMap, useRefreshMap } from '../api/hooks.js';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';
import { MapCanvas } from './MapCanvas.js';
import { MapInspector } from './MapInspector.js';
import { MapOutline } from './MapOutline.js';

const CONTRACTS = ['http', 'topic', 'graphql', 'table', 'rpc', 'websocket'] as const;
const PAGE = 100;

export function filtersFromParams(p: URLSearchParams): OrgGraphFilters {
  const prov = p.get('prov');
  const minc = Number(p.get('minc'));
  return {
    contract: p.get('contract') ?? undefined,
    provenance: prov === 'deterministic' || prov === 'inferred' ? prov : undefined,
    minConfidence: p.get('minc') !== null && Number.isFinite(minc) ? minc : undefined,
  };
}

/** ¿`id` cuelga (a cualquier profundidad) de `ancestor` en lo que se ve? */
export function isDescendant(
  byId: ReadonlyMap<string, { parent: string | null }>,
  id: string,
  ancestor: string,
): boolean {
  const seen = new Set<string>();
  let cur = byId.get(id)?.parent ?? null;
  while (cur !== null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parent ?? null;
  }
  return false;
}

export function MapExplorer({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const selectedId = params.get('sel');
  const focus = params.get('focus');
  const hops = Number(params.get('hops') ?? 1) || 1;

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [fitNonce, setFitNonce] = useState(0);

  const q = useOrgMap(workspaceId, {
    expand: [...expanded],
    filters,
    focus: focus ?? undefined,
    hops,
    limits,
    pin: selectedId ? [selectedId] : [],
  });
  const view = q.data;
  const refresh = useRefreshMap(workspaceId);

  const setParam = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // Lo que el servidor reveló por su cuenta (foco, selección fijada) pasa a ser
  // estado del cliente: así abrir/cerrar actúa sobre lo que realmente se ve.
  // No con la vista anterior que se muestra mientras llega la nueva
  // (placeholder): reabriría lo que el usuario acaba de cerrar.
  useEffect(() => {
    if (!view || q.isPlaceholderData) return;
    const revealed = view.nodes.filter((n) => n.expanded).map((n) => n.id);
    if (revealed.every((id) => expanded.has(id))) return;
    setExpanded((prev) => new Set([...prev, ...revealed]));
  }, [view, expanded, q.isPlaceholderData]);

  const byId = useMemo(() => new Map((view?.nodes ?? []).map((n) => [n.id, n])), [view]);

  const toggle = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n || n.childCount === 0) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (n.expanded) next.delete(id);
        else next.add(id);
        return next;
      });
      if (n.expanded) {
        // La selección fijada reabriría a sus ancestros: si lo que se cierra la
        // contiene, la selección pasa al nodo cerrado (si no, "no cierra").
        if (selectedId && isDescendant(byId, selectedId, id)) setParam({ sel: id });
        // Cerrar un nodo con foco activo no tiene efecto visible: se suelta el foco.
        if (focus) setParam({ focus: null, hops: null });
      }
    },
    [byId, focus, selectedId, setParam],
  );

  const focusIds = useMemo(() => (view?.focus ? new Set(view.focus.ids) : null), [view?.focus]);
  const meta = view?.meta;
  const hasFilters =
    filters.contract !== undefined ||
    filters.provenance !== undefined ||
    filters.minConfidence !== undefined;

  return (
    <div
      className="rounded-xl border border-border bg-surface overflow-hidden"
      data-testid="map-explorer"
    >
      <Toolbar
        workspaceId={workspaceId}
        filters={filters}
        setParam={setParam}
        hasFilters={hasFilters}
        onSelect={(id) => setParam({ sel: id })}
        meta={meta}
        totals={view?.totals}
        refreshing={refresh.isPending}
        onRefresh={() => refresh.mutate()}
        onFit={() => setFitNonce((n) => n + 1)}
        loading={q.isFetching}
      />

      {meta && meta.source !== 'lain' ? (
        <SourceNotice meta={meta} />
      ) : (
        <div className="grid grid-cols-[17rem_minmax(0,1fr)_21rem] h-[calc(100vh-18rem)] min-h-[520px] border-t border-border">
          <aside className="overflow-y-auto border-r border-border" aria-label="Structure">
            {view ? (
              <MapOutline
                view={view}
                selectedId={selectedId}
                focusIds={focusIds}
                onSelect={(id) => setParam({ sel: id })}
                onToggle={toggle}
                onMore={(id) => setLimits((l) => ({ ...l, [id]: (l[id] ?? 50) + PAGE }))}
              />
            ) : (
              <p className="p-4 text-sm text-muted">
                {q.isError ? 'Could not load the map.' : 'Loading map…'}
              </p>
            )}
          </aside>

          <div className="relative bg-bg min-w-0">
            {view && view.nodes.length > 0 ? (
              <MapCanvas
                view={view}
                selectedId={selectedId}
                focusIds={focusIds}
                onSelect={(id) => setParam({ sel: id })}
                onToggle={toggle}
                fitNonce={fitNonce}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted">
                {view ? 'No nodes match these filters.' : 'Loading…'}
              </div>
            )}
            {focus && view && !view.focus && (
              <div
                className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full border border-warning bg-surface px-3 py-1 text-xs shadow-sm"
                data-testid="map-focus-missing"
              >
                <span className="text-warning">Focus target is not in this map</span>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setParam({ focus: null, hops: null })}
                >
                  clear
                </button>
              </div>
            )}
            {view?.focus && (
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs shadow-sm">
                <span className="text-muted">Focus</span>
                <span className="font-medium truncate max-w-[16rem]">
                  {byId.get(view.focus.seed)?.label ?? view.focus.seed}
                </span>
                <HopsControl hops={hops} onChange={(h) => setParam({ hops: String(h) })} />
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setParam({ focus: null, hops: null })}
                >
                  clear
                </button>
              </div>
            )}
            <Legend />
          </div>

          <aside className="overflow-y-auto border-l border-border" aria-label="Inspector">
            <MapInspector
              workspaceId={workspaceId}
              nodeId={selectedId}
              onSelect={(id) => setParam({ sel: id })}
              onFocus={(id) => setParam({ focus: id, hops: String(hops), sel: id })}
              onToggle={toggle}
              focusing={focus !== null}
              onClearFocus={() => setParam({ focus: null, hops: null })}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function HopsControl({
  hops,
  onChange,
}: {
  hops: number;
  onChange: (h: number) => void;
}): React.ReactElement {
  return (
    <fieldset className="inline-flex items-center gap-1 border-0 p-0 m-0 min-w-0" aria-label="Hops">
      {[1, 2, 3].map((h) => (
        <button
          key={h}
          type="button"
          aria-pressed={hops === h}
          onClick={() => onChange(h)}
          className={`w-5 h-5 rounded-full text-[11px] ${hops === h ? 'bg-accent text-accent-fg' : 'bg-bg text-muted hover:bg-border'}`}
        >
          {h}
        </button>
      ))}
      <span className="text-muted">hops</span>
    </fieldset>
  );
}

function SourceNotice({ meta }: { meta: MapMeta }): React.ReactElement {
  const text =
    meta.source === 'unconfigured'
      ? 'This workspace has no LAIN server configured — connect one to see its architecture.'
      : meta.source === 'none'
        ? 'Workspace not found.'
        : `LAIN error: ${meta.error ?? 'unreachable'}. The map is not empty, it is unavailable.`;
  return (
    <div
      className="border-t border-border p-8 text-sm text-muted text-center"
      data-testid="map-notice"
    >
      {text}
    </div>
  );
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Toolbar(props: {
  workspaceId: string;
  filters: OrgGraphFilters;
  setParam: (p: Record<string, string | null>) => void;
  hasFilters: boolean;
  onSelect: (id: string) => void;
  meta: MapMeta | undefined;
  totals: { nodes: number; edges: number; shownNodes: number; shownEdges: number } | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  onFit: () => void;
  loading: boolean;
}): React.ReactElement {
  const { filters, setParam, meta, totals } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs transition-colors ${active ? 'bg-accent text-accent-fg' : 'bg-bg text-muted hover:bg-border'}`;
  const prov = filters.provenance;
  const setProv = (p: Provenance | undefined) =>
    setParam({ prov: p ?? null, ...(p === 'deterministic' ? { minc: null } : {}) });

  return (
    <div className="px-4 py-3 space-y-2.5" data-testid="map-toolbar">
      <div className="flex items-center gap-3">
        <SearchBox workspaceId={props.workspaceId} onPick={props.onSelect} />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {totals && (
            <span className="tabular-nums" data-testid="map-totals">
              {totals.shownNodes} of {totals.nodes} nodes · {totals.edges} relations
            </span>
          )}
          {meta?.generatedAt !== undefined && (
            <span data-testid="map-freshness" className={meta.stale ? 'text-warning' : ''}>
              {meta.stale ? 'Stale · ' : ''}updated {ago(meta.generatedAt, now)}
              {meta.refreshing ? ' · refreshing…' : ''}
            </span>
          )}
          {meta?.lastError && (
            <span className="text-error" title={meta.lastError}>
              last refresh failed
            </span>
          )}
          <button
            type="button"
            onClick={props.onFit}
            className="px-2 py-1 rounded-md hover:bg-border"
            title="Fit to view"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            className="px-2.5 py-1 rounded-md border border-border hover:bg-border disabled:opacity-60"
          >
            {props.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset
          className="flex items-center gap-1.5 border-0 p-0 m-0 min-w-0"
          aria-label="Relation provenance"
        >
          <span className="text-xs text-muted mr-1">Relations</span>
          <button
            type="button"
            aria-pressed={!prov}
            className={chip(!prov)}
            onClick={() => setProv(undefined)}
          >
            all
          </button>
          <button
            type="button"
            aria-pressed={prov === 'deterministic'}
            className={`${chip(prov === 'deterministic')} inline-flex items-center gap-1.5`}
            onClick={() => setProv(prov === 'deterministic' ? undefined : 'deterministic')}
          >
            <EdgeSwatch provenance="deterministic" width={18} />
            deterministic
          </button>
          <button
            type="button"
            aria-pressed={prov === 'inferred'}
            className={`${chip(prov === 'inferred')} inline-flex items-center gap-1.5`}
            onClick={() => setProv(prov === 'inferred' ? undefined : 'inferred')}
          >
            <EdgeSwatch provenance="inferred" width={18} />
            inferred
          </button>
        </fieldset>

        {prov !== 'deterministic' && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Min confidence
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={filters.minConfidence ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                setParam({ minc: v === 0 ? null : String(v) });
              }}
              aria-label="Minimum confidence of inferred relations"
              className="w-24 accent-[var(--color-accent)]"
            />
            <span className="tabular-nums w-7">{(filters.minConfidence ?? 0).toFixed(1)}</span>
          </label>
        )}

        <fieldset
          className="flex items-center gap-1.5 border-0 p-0 m-0 min-w-0"
          aria-label="Contract kind"
        >
          <span className="text-xs text-muted mr-1">Contract</span>
          {CONTRACTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={filters.contract === c}
              className={chip(filters.contract === c)}
              onClick={() => setParam({ contract: filters.contract === c ? null : c })}
            >
              {c}
            </button>
          ))}
        </fieldset>

        {props.hasFilters && (
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setParam({ contract: null, prov: null, minc: null })}
          >
            clear filters
          </button>
        )}
        {props.loading && <span className="text-xs text-muted">loading…</span>}
      </div>
    </div>
  );
}

function SearchBox({
  workspaceId,
  onPick,
}: {
  workspaceId: string;
  onPick: (id: string) => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(t);
  }, [text]);
  const results = useMapSearch(workspaceId, debounced).data?.results ?? [];

  return (
    <div className="relative w-80">
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search repos, services, endpoints…"
        aria-label="Search the map"
        className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
      {open && debounced.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">No matches.</li>
          ) : (
            results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(r.id);
                    setOpen(false);
                  }}
                >
                  <KindIcon kind={r.kind} />
                  <span className="truncate">{r.label}</span>
                  <span className="ml-auto text-[10px] text-muted">{KIND_LABEL[r.kind]}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Legend(): React.ReactElement {
  return (
    <div
      className="absolute bottom-3 left-3 z-10 rounded-lg border border-border bg-surface/95 px-3 py-2 text-[11px] text-muted space-y-1"
      data-testid="map-legend"
    >
      <div className="flex items-center gap-3">
        {(['repo', 'service', 'endpoint'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <KindIcon kind={k} size={12} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <EdgeSwatch provenance="deterministic" width={22} /> deterministic
        </span>
        <span className="inline-flex items-center gap-1.5">
          <EdgeSwatch provenance="inferred" width={22} /> inferred (fainter = less sure)
        </span>
      </div>
      <div>Dashed box = has contents · double-click to open · ×N = N relations rolled up</div>
    </div>
  );
}
