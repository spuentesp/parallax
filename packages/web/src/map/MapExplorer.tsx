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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMapSearch, useOrgMap, useRefreshMap, useWhoami } from '../api/hooks.js';
import { readExpanded, writeExpanded, writeMapSearch } from '../nav/mapState.js';
import { readStored, writeStored } from '../nav/storage.js';
import { TracePanel } from '../trace/TracePanel.js';
import { CodeInspector } from './CodeInspector.js';
import { canOpen, isCodeId, mergeCode } from './code.js';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';
import { LooseEndsPanel } from './LooseEndsPanel.js';
import { MapCanvas } from './MapCanvas.js';
import { MapInspector } from './MapInspector.js';
import { MapOutline } from './MapOutline.js';
import { useCodeLayer } from './useCodeLayer.js';

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

/** Ancestros de un nodo tal como se ven en el mapa, del padre a la raíz. */
export function trailOf<T extends { id: string; parent: string | null }>(
  byId: ReadonlyMap<string, T>,
  id: string,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent ?? null;
  while (cur !== null && !seen.has(cur)) {
    const n = byId.get(cur);
    if (!n) break;
    out.push(n);
    seen.add(cur);
    cur = n.parent;
  }
  return out;
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

const OUTLINE_KEY = 'parallax.outline';
const readOutlineOpen = (): boolean => readStored('session', OUTLINE_KEY) !== 'closed';
const writeOutlineOpen = (open: boolean): void =>
  writeStored('session', OUTLINE_KEY, open ? 'open' : 'closed');

/** Por encima de esto, abrir todos los repos al entrar sería ruido: se deja cerrado. */
const AUTO_OPEN_MAX_REPOS = 12;

export function MapExplorer({
  workspaceId,
  actions,
}: {
  workspaceId: string;
  /** Acciones contextuales que van en la barra (p. ej. evaluar un PR sobre lo seleccionado). */
  actions?: React.ReactNode;
}): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const selectedId = params.get('sel');
  const focus = params.get('focus');
  const hops = Number(params.get('hops') ?? 1) || 1;

  // Lo abierto se recuerda por workspace: salir a otra sección y volver no lo cierra.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(readExpanded(workspaceId) ?? []),
  );
  const [outlineOpen, setOutlineOpen] = useState(() => readOutlineOpen());
  const [legendOpen, setLegendOpen] = useState(false);
  const [looseOpen, setLooseOpen] = useState(false);
  // El contrato cuyo trazado de punta a punta está abierto (un panel ancho sobre el mapa).
  const [trace, setTrace] = useState<{ key: string; service: string | null } | null>(null);
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
  const serverView = q.data;
  const code = useCodeLayer(workspaceId);
  // La capa de código (archivos/símbolos de LAIN) se suma a la proyección del servidor.
  const view = useMemo(
    () => (serverView ? mergeCode(serverView, code.open, code.state) : undefined),
    [serverView, code.open, code.state],
  );
  const refresh = useRefreshMap(workspaceId);
  const readOnly = useWhoami().data?.readOnly === true;

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

  // Al abrir, los repos se muestran con sus servicios dentro: tres cajas
  // cerradas no cuentan nada. Una sola vez, y sólo si no hay foco ni demasiados.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !serverView || q.isPlaceholderData) return;
    autoOpened.current = true;
    // Si el usuario ya dejó el mapa de una forma (aunque sea todo cerrado), se respeta.
    if (focus || readExpanded(workspaceId) !== null) return;
    const roots = serverView.nodes.filter(
      (n) => n.parent === null && n.kind === 'repo' && n.childCount > 0 && !n.expanded,
    );
    if (roots.length > 0 && roots.length <= AUTO_OPEN_MAX_REPOS) {
      setExpanded((prev) => new Set([...prev, ...roots.map((n) => n.id)]));
    }
  }, [serverView, focus, workspaceId, q.isPlaceholderData]);

  // Lo que el servidor reveló por su cuenta (foco, selección fijada) pasa a ser
  // estado del cliente: así abrir/cerrar actúa sobre lo que realmente se ve.
  // No con la vista anterior que se muestra mientras llega la nueva
  // (placeholder): reabriría lo que el usuario acaba de cerrar.
  useEffect(() => {
    if (!serverView || q.isPlaceholderData) return;
    const revealed = serverView.nodes.filter((n) => n.expanded).map((n) => n.id);
    if (revealed.every((id) => expanded.has(id))) return;
    setExpanded((prev) => new Set([...prev, ...revealed]));
  }, [serverView, expanded, q.isPlaceholderData]);

  useEffect(() => {
    // Sólo se guarda lo que el usuario (o la apertura automática) hizo: no el estado vacío inicial.
    if (autoOpened.current) writeExpanded(workspaceId, expanded);
  }, [expanded, workspaceId]);
  useEffect(() => writeMapSearch(workspaceId, params), [params, workspaceId]);

  const byId = useMemo(() => new Map((view?.nodes ?? []).map((n) => [n.id, n])), [view]);

  const toggle = useCallback(
    (id: string) => {
      const n = byId.get(id);
      // Nodos de código: se abren bajo demanda (se piden a LAIN al abrir).
      if (n && isCodeId(id)) {
        if (n.lazy) code.toggle(id, n.expanded);
        return;
      }
      if (!n || !canOpen(n)) return;
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
    [byId, focus, selectedId, setParam, code.toggle],
  );

  // Seleccionar un símbolo trae sus relaciones (el inspector las lista).
  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo al cambiar la selección
  useEffect(() => {
    if (selectedId && isCodeId(selectedId) && !selectedId.startsWith('code:')) {
      code.ensure(selectedId);
    }
  }, [selectedId]);

  const focusIds = useMemo(() => (view?.focus ? new Set(view.focus.ids) : null), [view?.focus]);
  const meta = view?.meta;
  const hasFilters =
    filters.contract !== undefined ||
    filters.provenance !== undefined ||
    filters.minConfidence !== undefined;

  return (
    <div className="h-full flex flex-col bg-surface" data-testid="map-explorer">
      <Toolbar
        workspaceId={workspaceId}
        filters={filters}
        setParam={setParam}
        hasFilters={hasFilters}
        onSelect={(id) => setParam({ sel: id })}
        meta={meta}
        totals={view?.totals}
        refreshing={refresh.isPending}
        readOnly={readOnly}
        onRefresh={() => refresh.mutate(undefined, { onSuccess: code.reset })}
        onFit={() => setFitNonce((n) => n + 1)}
        loading={q.isFetching}
        looseOpen={looseOpen}
        onToggleLoose={() => setLooseOpen((o) => !o)}
        outlineOpen={outlineOpen}
        onToggleOutline={() => {
          setOutlineOpen((o) => {
            writeOutlineOpen(!o);
            return !o;
          });
        }}
        actions={actions}
      />

      {meta && meta.source !== 'lain' ? (
        <SourceNotice meta={meta} />
      ) : (
        <div
          className={`grid flex-1 min-h-0 border-t border-border ${
            outlineOpen ? 'grid-cols-[14rem_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'
          }`}
        >
          {outlineOpen && (
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
          )}

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
            {hasFilters && (
              <div
                className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-warning bg-surface px-3 py-1 text-xs shadow-sm"
                data-testid="map-filter-banner"
              >
                <span className="text-warning">Filtered view</span>
                <span className="text-muted">
                  {[
                    filters.contract ? `${filters.contract} only` : null,
                    filters.provenance ?? null,
                    filters.minConfidence !== undefined
                      ? `confidence ≥ ${filters.minConfidence.toFixed(1)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  — repos and services without a match are hidden
                </span>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setParam({ contract: null, prov: null, minc: null })}
                >
                  show everything
                </button>
              </div>
            )}
            <Legend open={legendOpen} onToggle={() => setLegendOpen((o) => !o)} />

            {trace && (
              <div className="absolute right-3 top-3 bottom-3 z-40 flex w-[34rem] max-w-[85%] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                <TracePanel
                  workspaceId={workspaceId}
                  contract={trace}
                  onSelect={(id) => setParam({ sel: id })}
                  onClose={() => setTrace(null)}
                />
              </div>
            )}

            {looseOpen && !trace && (
              <div className="absolute right-3 top-3 bottom-3 z-30 flex w-[26rem] max-w-[70%] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                <LooseEndsPanel
                  workspaceId={workspaceId}
                  onSelect={(id) => setParam({ sel: id })}
                  onClose={() => setLooseOpen(false)}
                />
              </div>
            )}

            {selectedId && !looseOpen && !trace && (
              <div className="absolute right-3 top-3 bottom-3 z-20 flex w-[21rem] max-w-[60%] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                <button
                  type="button"
                  onClick={() => setParam({ sel: null })}
                  aria-label="Close inspector"
                  title="Close"
                  className="absolute right-2 top-2 z-10 h-6 w-6 rounded-md text-xs text-muted hover:bg-bg hover:text-fg"
                >
                  ✕
                </button>
                <aside className="flex-1 overflow-y-auto" aria-label="Inspector">
                  {selectedId && isCodeId(selectedId) ? (
                    <CodeInspector
                      workspaceId={workspaceId}
                      nodeId={selectedId}
                      node={byId.get(selectedId)}
                      entry={code.state[selectedId]}
                      trail={trailOf(byId, selectedId)}
                      onSelect={(id) => setParam({ sel: id })}
                      onToggle={toggle}
                    />
                  ) : (
                    <MapInspector
                      workspaceId={workspaceId}
                      nodeId={selectedId}
                      onSelect={(id) => setParam({ sel: id })}
                      onFocus={(id) => setParam({ focus: id, hops: String(hops), sel: id })}
                      onToggle={toggle}
                      focusing={focus !== null}
                      onClearFocus={() => setParam({ focus: null, hops: null })}
                    />
                  )}
                </aside>
              </div>
            )}
          </div>
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
  readOnly: boolean;
  onRefresh: () => void;
  onFit: () => void;
  loading: boolean;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  looseOpen: boolean;
  onToggleLoose: () => void;
  actions?: React.ReactNode;
}): React.ReactElement {
  const { filters, setParam, meta, totals } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const chip = (active: boolean) =>
    `px-2 py-0.5 rounded-full text-xs transition-colors ${active ? 'bg-accent text-accent-fg' : 'bg-bg text-muted hover:bg-border'}`;
  const prov = filters.provenance;
  const setProv = (p: Provenance | undefined) =>
    setParam({ prov: p ?? null, ...(p === 'deterministic' ? { minc: null } : {}) });

  return (
    <div className="px-3 py-2" data-testid="map-toolbar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={props.onToggleOutline}
          aria-pressed={props.outlineOpen}
          title={props.outlineOpen ? 'Hide the structure list' : 'Show the structure list'}
          className={`${chip(props.outlineOpen)} shrink-0`}
        >
          Structure
        </button>
        <button
          type="button"
          onClick={props.onToggleLoose}
          aria-pressed={props.looseOpen}
          title="Calls the engine could not bind, and what each one is"
          className={`${chip(props.looseOpen)} shrink-0`}
        >
          Loose ends
        </button>
        <SearchBox workspaceId={props.workspaceId} onPick={props.onSelect} />

        <fieldset
          className="flex items-center gap-1 border-0 p-0 m-0 min-w-0"
          aria-label="Relation provenance"
        >
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
            <EdgeSwatch provenance="deterministic" width={16} />
            deterministic
          </button>
          <button
            type="button"
            aria-pressed={prov === 'inferred'}
            className={`${chip(prov === 'inferred')} inline-flex items-center gap-1.5`}
            onClick={() => setProv(prov === 'inferred' ? undefined : 'inferred')}
          >
            <EdgeSwatch provenance="inferred" width={16} />
            inferred
          </button>
        </fieldset>

        {prov !== 'deterministic' && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
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
              className="w-20 accent-[var(--color-accent)]"
            />
            <span className="tabular-nums w-7">{(filters.minConfidence ?? 0).toFixed(1)}</span>
          </label>
        )}

        <fieldset
          className="flex items-center gap-1 border-0 p-0 m-0 min-w-0"
          aria-label="Contract kind"
        >
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

        <div className="ml-auto flex items-center gap-2.5 text-xs text-muted">
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
            className="px-2 py-0.5 rounded-md hover:bg-border"
            title="Fit to view"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.refreshing || props.readOnly}
            title={
              props.readOnly
                ? 'Read-only access cannot rebuild the graph'
                : 'Rebuild the graph from LAIN'
            }
            className="px-2 py-0.5 rounded-md border border-border hover:bg-border disabled:opacity-60"
          >
            {props.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {props.actions}
        </div>
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

function Legend({ open, onToggle }: { open: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <div
      className="absolute bottom-3 left-3 z-10 rounded-lg border border-border bg-surface/95 px-3 py-1.5 text-[11px] text-muted space-y-1"
      data-testid="map-legend"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-[11px] text-muted hover:text-fg"
      >
        {open ? 'Hide legend' : 'Legend'}
      </button>
      {open && (
        <>
          <div className="flex items-center gap-3">
            {(['repo', 'service', 'group', 'endpoint'] as const).map((k) => (
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
        </>
      )}
    </div>
  );
}
