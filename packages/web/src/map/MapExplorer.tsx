// MapExplorer — el centro de mando de la arquitectura: jerarquía repo →
// servicio → endpoint (árbol + lienzo compuesto), filtros por tipo de contrato
// y por procedencia de la relación, búsqueda, foco por vecindad y un
// inspector que responde "¿quién consume esto?".
//
// Carga perezosa: el servidor sólo manda lo visible; abrir un nodo pide otra
// proyección. El estado que debe poder compartirse (selección, foco, filtros)
// vive en la URL, así un agente o un enlace pueden dejar el mapa apuntando a
// un subgrafo concreto: ?focus=<id>&hops=1&sel=<id>.

import type {
  MapMeta,
  NodeDetail,
  OrgGraphFilters,
  ProjectedNode,
  Provenance,
} from '@parallax/shared/org-map';
import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMapSearch, useOrgMap, useRefreshMap, useWhoami } from '../api/hooks.js';
import { useMediaQuery } from '../components/useMediaQuery.js';
import { readExpanded, writeExpanded, writeMapSearch } from '../nav/mapState.js';
import { readStored, writeStored } from '../nav/storage.js';
import { TracePanel } from '../trace/TracePanel.js';
import { CodeInspector } from './CodeInspector.js';
import { withInterfaceClusters } from './clusters.js';
import { candidateEndpointPaths, canOpen, codeNodeId, isCodeId, mergeCode } from './code.js';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';
import { LooseEndsPanel } from './LooseEndsPanel.js';
import { MapCanvas, type MapCanvasHandle } from './MapCanvas.js';
import { MapInspector } from './MapInspector.js';
import { MapOutline } from './MapOutline.js';
import { MatrixLens } from './MatrixLens.js';
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
// Presupuesto de la apertura automática: con grafos reales (Saleor: 700 endpoints)
// abrir todo deja un mapa de 250 nodos al 15% de zoom, ilegible; la referencia
// muestra cajas con unas pocas filas. Un nodo con más hijos que MAX_AUTO_CHILDREN
// no se abre solo (se abre a mano o con "Detail"), y la cascada se detiene cuando
// lo visible rebasaría el presupuesto. Un grafo pequeño se abre entero.
const AUTO_OPEN_BUDGET = 60;
const MAX_AUTO_CHILDREN = 12;

export function MapExplorer({
  workspaceId,
  actions,
}: {
  workspaceId: string;
  /** Acciones contextuales que van en la barra (p. ej. evaluar un PR sobre lo seleccionado). */
  actions?: React.ReactNode;
}): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const selectedId = params.get('sel');
  const focus = params.get('focus');
  const hops = Number(params.get('hops') ?? 1) || 1;
  // Lente del mapa: grafo (lienzo) o matriz (consumidor × proveedor).
  const lens = params.get('lens') === 'matrix' ? ('matrix' as const) : ('graph' as const);

  // Lo abierto se recuerda por workspace: salir a otra sección y volver no lo cierra.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(readExpanded(workspaceId) ?? []),
  );
  const wideOutline = useMediaQuery('(min-width: 1100px)');
  const [outlineOpen, setOutlineOpen] = useState(() => readOutlineOpen() && wideOutline);
  // En la lente matriz el panel de estructura (árbol del grafo) no aporta: la
  // matriz ocupa todo el ancho con su propio panel de par.
  const showOutline = lens === 'graph' && outlineOpen;
  useEffect(() => {
    if (!wideOutline) setOutlineOpen(false);
  }, [wideOutline]);
  const [legendOpen, setLegendOpen] = useState(false);
  // Nivel de zoom del lienzo en % (lo actualiza el propio lienzo al hacer zoom).
  const [zoomPct, setZoomPct] = useState(100);
  const [looseOpen, setLooseOpen] = useState(false);
  // Nivel de detalle (referencia "Detail"): hasta qué profundidad se abren los
  // contenedores. Es una orden que se sigue aplicando conforme el servidor
  // revela hijos; abrir o cerrar a mano la suelta.
  const [detail, setDetail] = useState<DetailLevel | null>(null);
  // El contrato cuyo trazado de punta a punta está abierto (un panel ancho sobre el mapa).
  // Un enlace puede abrir el trazado directamente (?trace=<contrato>&tservice=<servicio>),
  // p. ej. desde el detalle de un contrato. Los parámetros se retiran al leerlos: el
  // trazado es estado de la pantalla, no de la URL, y recargar no lo reabre.
  const [trace, setTrace] = useState<{ key: string; service: string | null } | null>(() => {
    const key = params.get('trace');
    return key ? { key, service: params.get('tservice') } : null;
  });
  const [traceFanout, setTraceFanout] = useState<number>(3);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo al montar
  useEffect(() => {
    if (params.has('trace') || params.has('tservice')) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('trace');
          next.delete('tservice');
          return next;
        },
        { replace: true },
      );
    }
  }, []);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [activeRelations, setActiveRelations] = useState<ReadonlySet<string>>(new Set());
  // Controles del lienzo (zoom, encuadre): el lienzo es quien tiene el grafo.
  const mapRef = useRef<MapCanvasHandle>(null);

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
  // Código anclado al lienzo: el que implementa la interfaz seleccionada o
  // enfocada, más los nodos de código que aparecen en los hops del foco.
  // Así la interfaz se ve junto a su código (arista 'implements'), no como un
  // contrato suelto que deja el símbolo "Not loaded".
  const pinnedCode = useMemo(() => {
    if (!serverView) return new Set<string>();
    const pinned = new Set<string>();
    const lainRepos = serverView.nodes
      .filter((n) => n.kind === 'repo' && typeof n.meta.lainRepoId === 'string')
      .map((n) => n.meta.lainRepoId as string);
    const knownRepos = new Set(lainRepos);
    // El repo de LAIN que posee el endpoint: por la cadena servicio→repo del
    // grafo, o por el repo que declara el provider. NUNCA se adivina probando en
    // todos: un path existe en un único checkout y buscarlo en otro da 404.
    const serverById = new Map(serverView.nodes.map((n) => [n.id, n]));
    const ownerLainRepo = (ep: ProjectedNode): string | null => {
      const svcId = typeof ep.meta.service === 'string' ? `svc:${ep.meta.service}` : null;
      let cur = svcId ? serverById.get(svcId) : undefined;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.kind === 'repo' && typeof cur.meta.lainRepoId === 'string') {
          return cur.meta.lainRepoId as string;
        }
        cur = cur.parent ? serverById.get(cur.parent) : undefined;
      }
      const provs = Array.isArray(ep.meta.providers)
        ? (ep.meta.providers as Array<{ repo?: string }>)
        : [];
      for (const p of provs) if (p?.repo && knownRepos.has(p.repo)) return p.repo;
      return null;
    };
    const endpointOf = (id: string | null): ProjectedNode | undefined =>
      id ? serverView.nodes.find((n) => n.id === id && n.kind === 'endpoint') : undefined;
    const pinEndpoint = (ep: ProjectedNode | undefined) => {
      if (!ep) return;
      const owner = ownerLainRepo(ep);
      const repos = owner ? [owner] : lainRepos;
      for (const repo of repos) {
        for (const path of candidateEndpointPaths(ep)) {
          pinned.add(codeNodeId(repo, 'File', path));
        }
      }
    };
    for (const ep of [endpointOf(selectedId), endpointOf(focus ?? null)]) pinEndpoint(ep);
    const focusSeed = serverView.focus?.seed ?? null;
    pinEndpoint(endpointOf(focusSeed));
    for (const id of serverView.focus?.ids ?? []) {
      if (isCodeId(id) && !id.startsWith('code:')) pinned.add(id);
    }
    // Un nodo de código seleccionado directamente también se ancla: así nunca
    // queda "Not loaded" en el inspector por no estar abierto su repo.
    if (selectedId && isCodeId(selectedId) && !selectedId.startsWith('code:')) {
      pinned.add(selectedId);
    }
    return pinned;
  }, [serverView, selectedId, focus]);
  // La capa de código (archivos/símbolos de LAIN) se suma a la proyección del servidor.
  const view = useMemo(
    () =>
      serverView
        ? withInterfaceClusters(
            mergeCode(serverView, code.open, code.state, activeRelations, pinnedCode),
          )
        : undefined,
    [serverView, code.open, code.state, activeRelations, pinnedCode],
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

  // Al abrir, los repos se despliegan en cascada hasta sus interfaces: la caja
  // del repo muestra las cajas de servicio con sus filas de endpoints (modelo
  // de la referencia), no una caja vacía con sólo la puerta de Code. La puerta
  // de código queda plegada. Sólo si no hay foco, no hay estado guardado, no ha
  // intervenido el usuario y no hay demasiados repos.
  const autoOpened = useRef(false);
  const userTouchedExpanded = useRef(false);
  const hadSavedExpanded = useRef<boolean | null>(null);
  if (hadSavedExpanded.current === null) {
    hadSavedExpanded.current = readExpanded(workspaceId) !== null;
  }

  useEffect(() => {
    if (!serverView || q.isPlaceholderData) return;
    if (focus || hadSavedExpanded.current || userTouchedExpanded.current) {
      autoOpened.current = true;
      return;
    }
    autoOpened.current = true;
    const byId = new Map(serverView.nodes.map((n) => [n.id, n]));
    setExpanded((prev) => {
      const roots = serverView.nodes.filter(
        (n) => n.parent === null && n.kind === 'repo' && n.childCount > 0 && !prev.has(n.id),
      );
      if (roots.length > AUTO_OPEN_MAX_REPOS) return prev;
      const willBe = new Set(prev);
      const adding: string[] = [];
      for (const r of roots) {
        adding.push(r.id);
        willBe.add(r.id);
      }
      // Cascada: grupos (Interfaces, familias de contratos…) y servicios cuelgan
      // de lo ya abierto; el código (kind 'code') se queda plegado.
      let budget = AUTO_OPEN_BUDGET - serverView.nodes.length;
      for (const n of serverView.nodes) {
        if (prev.has(n.id) || (n.kind !== 'group' && n.kind !== 'service')) continue;
        const cost = n.childCount;
        if (cost > MAX_AUTO_CHILDREN || cost > budget) continue;
        let p: string | null = n.parent;
        const seen = new Set<string>([n.id]);
        let under = true;
        while (p) {
          if (!willBe.has(p)) {
            under = false;
            break;
          }
          if (seen.has(p)) break;
          seen.add(p);
          p = byId.get(p)?.parent ?? null;
        }
        if (under) {
          adding.push(n.id);
          willBe.add(n.id);
          budget -= cost;
        }
      }
      if (adding.length === 0) return prev;
      return new Set([...prev, ...adding]);
    });
  }, [serverView, focus, q.isPlaceholderData]);

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
    if (!detail || !serverView || q.isPlaceholderData) return;
    const below = DETAIL_DEPTH[detail];
    const toOpen = serverView.nodes
      .filter((n) => !n.expanded && n.childCount > 0 && (KIND_DEPTH[n.kind] ?? 99) < below)
      .map((n) => n.id);
    if (toOpen.length === 0) return;
    userTouchedExpanded.current = true;
    setExpanded((prev) => new Set([...prev, ...toOpen]));
  }, [detail, serverView, q.isPlaceholderData]);

  useEffect(() => {
    // Sólo se guarda lo que el usuario (o la apertura automática) hizo: no el estado vacío inicial.
    if (autoOpened.current) writeExpanded(workspaceId, expanded);
  }, [expanded, workspaceId]);
  useEffect(() => writeMapSearch(workspaceId, params), [params, workspaceId]);

  const byId = useMemo(() => new Map((view?.nodes ?? []).map((n) => [n.id, n])), [view]);
  const selectedTrail = useMemo(
    () => (selectedId ? trailOf(byId, selectedId) : []),
    [byId, selectedId],
  );
  const selectedNode = selectedId ? byId.get(selectedId) : undefined;

  // Un clúster (clu:…) es nodo sólo del cliente: no está en el servidor ni en el
  // lienzo. Al seleccionarlo se resaltan sus puertos en el borde de la caja del
  // repo y el inspector lista sus contratos localmente.
  const clusterSel = useMemo(() => {
    if (!view || !selectedNode || selectedNode.meta.role !== 'cluster') return null;
    const members = view.nodes.filter(
      (n) => n.kind === 'endpoint' && isDescendant(byId, n.id, selectedNode.id),
    );
    return members.length > 0 ? { node: selectedNode, members } : null;
  }, [view, selectedNode, byId]);
  const clusterHighlightIds = useMemo(
    () => (clusterSel ? new Set(clusterSel.members.map((m) => m.id)) : null),
    [clusterSel],
  );
  const localDetail = useMemo<NodeDetail | null>(() => {
    if (!clusterSel || !selectedId) return null;
    return {
      node: clusterSel.node,
      path: trailOf(byId, selectedId),
      children: clusterSel.members,
      consumers: [],
      providers: [],
    };
  }, [clusterSel, byId, selectedId]);

  // Un enlace a un clúster abre su cadena de ancestros para que el clúster exista.
  useEffect(() => {
    if (!selectedId?.startsWith('clu:') || !serverView || q.isPlaceholderData) return;
    const groupId = selectedId.slice(4, selectedId.lastIndexOf(':'));
    const group = serverView.nodes.find((n) => n.id === groupId);
    if (!group) return;
    const serverById = new Map(serverView.nodes.map((n) => [n.id, n]));
    const need = [...trailOf(serverById, groupId).map((n) => n.id), groupId];
    setExpanded((prev) => {
      const missing = need.filter((id) => !prev.has(id));
      return missing.length > 0 ? new Set([...prev, ...missing]) : prev;
    });
  }, [selectedId, serverView, q.isPlaceholderData]);

  const toggle = useCallback(
    (id: string) => {
      // Abrir/cerrar a mano corta la apertura automática en cascada.
      userTouchedExpanded.current = true;
      setDetail(null);
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

  // Los nodos de código anclados (implementan la interfaz enfocada/seleccionada o
  // salen en sus hops) se piden a LAIN para que el inspector tenga sus datos.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo al cambiar el pin
  useEffect(() => {
    for (const id of pinnedCode) code.ensure(id);
  }, [pinnedCode]);

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
        lens={lens}
        hasFilters={hasFilters}
        onSelect={(id) => setParam({ sel: id })}
        meta={meta}
        totals={view?.totals}
        refreshing={refresh.isPending}
        readOnly={readOnly}
        onRefresh={() => refresh.mutate(undefined, { onSuccess: code.reset })}
        loading={q.isFetching}
        looseOpen={looseOpen}
        onToggleLoose={() => setLooseOpen((o) => !o)}
        onOpenContracts={() => navigate('contracts')}
        onOpenCoverage={() => navigate('coverage')}
        trail={[...selectedTrail, ...(selectedNode ? [selectedNode] : [])].map((n) => ({
          id: n.id,
          label: n.label,
        }))}
        detail={detail}
        onDetail={(level) => {
          userTouchedExpanded.current = true;
          setDetail(level);
          if (level === 'repos') setExpanded(new Set());
        }}
        inferredCount={view?.edges.filter((e) => e.inferredCount > 0).length ?? 0}
        outlineOpen={showOutline}
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
            showOutline ? 'grid-cols-[13.5rem_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'
          }`}
        >
          {showOutline && (
            <aside
              className="overflow-y-auto border-r border-border bg-surface"
              aria-label="Structure"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-1 border-b border-border bg-surface px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Structure
                  </span>
                  {view && (
                    <span className="tabular-nums text-[10px] text-muted truncate">
                      ({view.nodes.length})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOutlineOpen(false);
                    writeOutlineOpen(false);
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-bg hover:text-fg transition-colors shrink-0"
                  aria-label="Fold structure panel"
                  title="Fold structure panel"
                >
                  <svg
                    role="img"
                    aria-label="Fold structure panel icon"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <title>Fold structure panel</title>
                    <path d="M6.5 2L3.5 5L6.5 8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
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
            {!showOutline && lens === 'graph' && (
              <button
                type="button"
                onClick={() => {
                  setOutlineOpen(true);
                  writeOutlineOpen(true);
                }}
                className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-2 py-1 text-[11px] font-medium text-muted shadow-sm backdrop-blur hover:bg-surface hover:text-fg transition-colors"
                title="Unfold structure panel"
              >
                <svg
                  role="img"
                  aria-label="Unfold structure panel icon"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <title>Unfold structure panel</title>
                  <path d="M3.5 2L6.5 5L3.5 8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Structure</span>
              </button>
            )}
            {lens === 'matrix' ? (
              <MatrixLens
                workspaceId={workspaceId}
                onSelect={(id) => setParam({ sel: id, lens: null })}
                onFocus={(id) => setParam({ focus: id, hops: String(hops), sel: id, lens: null })}
                onAsk={(question) => setParam({ ask: question })}
                onOpenContracts={() => navigate('contracts', { replace: false })}
              />
            ) : view && view.nodes.length > 0 ? (
              <MapCanvas
                ref={mapRef}
                view={view}
                selectedId={selectedId}
                focusIds={focusIds}
                highlightIds={clusterHighlightIds}
                onSelect={(id) => setParam({ sel: id })}
                onToggle={toggle}
                traceContract={trace}
                traceFanoutLimit={traceFanout}
                onZoomLevel={(z) => setZoomPct(Math.round(z * 100))}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
                <p>{view ? 'No nodes match these filters.' : 'Loading…'}</p>
                {view &&
                  view.totals?.edges === 0 &&
                  (filters.provenance || filters.minConfidence !== undefined) && (
                    <p className="max-w-md text-xs text-muted/80">
                      This workspace has no inter-service relationships; all{' '}
                      {view.totals?.nodes ?? 0} nodes are standalone declarations.
                    </p>
                  )}
                {view && hasFilters && (
                  <button
                    type="button"
                    className="mt-1 rounded-lg border border-border px-2.5 py-1 text-xs text-accent hover:bg-bg"
                    onClick={() =>
                      setParam({ contract: null, prov: null, minc: null, service: null })
                    }
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            {lens === 'graph' && (
              <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2">
                {trace && (
                  <div
                    className="flex items-center gap-2.5 rounded-lg border border-accent/40 bg-surface/95 backdrop-blur px-3 py-1.5 text-xs shadow-md"
                    data-testid="trace-hud"
                  >
                    <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                    <span
                      className="font-semibold text-fg truncate max-w-[12rem]"
                      title={trace.key}
                    >
                      Trace: {trace.key}
                    </span>
                    <div className="flex items-center gap-1 border-l border-border pl-2 text-[11px] text-muted">
                      <span>Fanout:</span>
                      {[1, 2, 3, 5].map((lim) => (
                        <button
                          key={lim}
                          type="button"
                          onClick={() => setTraceFanout(lim)}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            traceFanout === lim
                              ? 'bg-accent text-accent-fg font-medium'
                              : 'bg-bg text-muted hover:bg-border'
                          }`}
                        >
                          {lim}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrace(null)}
                      className="text-muted hover:text-fg ml-1 text-xs"
                      aria-label="Exit trace mode"
                      title="Exit trace mode"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {selectedId &&
                  byId.get(selectedId) &&
                  !trace &&
                  (() => {
                    const selNode = byId.get(selectedId);
                    if (!selNode) return null;
                    return (
                      <div
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-surface/95 backdrop-blur px-3 py-1.5 text-xs shadow-md"
                        data-testid="selected-node-hud"
                      >
                        <KindIcon kind={selNode.kind} />
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-fg truncate max-w-[14rem]">
                            {selNode.label}
                          </span>
                          <span className="rounded px-1 text-[10px] uppercase font-medium bg-bg border border-border text-muted">
                            {selNode.contract ??
                              (selNode.meta.role === 'interfaces'
                                ? 'Interfaces'
                                : KIND_LABEL[selNode.kind])}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setParam({ sel: null })}
                          className="text-muted hover:text-fg ml-1 text-xs"
                          aria-label="Clear selection"
                          title="Clear selection"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })()}
                {activeRelations.size > 0 && (
                  <div
                    className="flex items-center gap-2 rounded-full border border-border bg-surface/95 backdrop-blur px-3 py-1 text-xs shadow-sm"
                    data-testid="active-relations-pill"
                  >
                    <span className="text-muted">
                      Showing code relations for {activeRelations.size} symbol
                      {activeRelations.size === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      className="text-accent hover:underline text-[11px]"
                      onClick={() => setActiveRelations(new Set())}
                    >
                      clear
                    </button>
                  </div>
                )}
              </div>
            )}
            {lens === 'graph' && focus && view && !view.focus && (
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
            {lens === 'graph' && view?.focus && (
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
            {lens === 'graph' && hasFilters && (
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
            {lens === 'graph' && (
              <CanvasControls
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
                onZoomReset={() => mapRef.current?.zoomReset()}
                zoomPct={zoomPct}
                onFit={() => mapRef.current?.fit()}
                legendOpen={legendOpen}
                onToggleLegend={() => setLegendOpen((o) => !o)}
              />
            )}

            {lens === 'graph' && trace && (
              <div className="absolute right-3 top-3 bottom-3 z-40 flex w-[34rem] max-w-[85%] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                <TracePanel
                  workspaceId={workspaceId}
                  contract={trace}
                  onSelect={(id) => setParam({ sel: id })}
                  onClose={() => setTrace(null)}
                  fanout={traceFanout}
                  onFanoutChange={setTraceFanout}
                />
              </div>
            )}

            {lens === 'graph' && looseOpen && !trace && (
              <div className="absolute right-3 top-3 bottom-3 z-30 flex w-[26rem] max-w-[70%] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                <LooseEndsPanel
                  workspaceId={workspaceId}
                  onSelect={(id) => setParam({ sel: id })}
                  onClose={() => setLooseOpen(false)}
                />
              </div>
            )}

            {lens === 'graph' && selectedId && !looseOpen && !trace && (
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
                      trail={selectedTrail}
                      onSelect={(id) => setParam({ sel: id })}
                      onToggle={toggle}
                      onAsk={(question) => setParam({ ask: question })}
                      relationsActive={activeRelations.has(selectedId)}
                      onToggleRelations={() =>
                        setActiveRelations((prev) => {
                          const next = new Set(prev);
                          if (next.has(selectedId)) next.delete(selectedId);
                          else next.add(selectedId);
                          return next;
                        })
                      }
                    />
                  ) : (
                    <MapInspector
                      workspaceId={workspaceId}
                      nodeId={selectedId}
                      node={byId.get(selectedId)}
                      localDetail={localDetail}
                      onSelect={(id) => setParam({ sel: id })}
                      onFocus={(id) => setParam({ focus: id, hops: String(hops), sel: id })}
                      onToggle={toggle}
                      focusing={focus !== null}
                      onClearFocus={() => setParam({ focus: null, hops: null })}
                      onTrace={(key, service) => setTrace({ key, service })}
                      onAsk={(question) => setParam({ ask: question })}
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

type DetailLevel = 'repos' | 'services' | 'endpoints';
// Cuántos niveles de contenedor se abren para cada nivel de detalle.
const DETAIL_DEPTH: Record<DetailLevel, number> = { repos: 0, services: 1, endpoints: 3 };
const KIND_DEPTH: Record<string, number> = { repo: 0, service: 1, group: 2 };
const DETAIL_LABEL: Record<DetailLevel, string> = {
  repos: 'Repos',
  services: 'Services',
  endpoints: 'Endpoints',
};

function Toolbar(props: {
  workspaceId: string;
  filters: OrgGraphFilters;
  setParam: (p: Record<string, string | null>) => void;
  lens: 'graph' | 'matrix';
  hasFilters: boolean;
  onSelect: (id: string) => void;
  meta: MapMeta | undefined;
  totals: { nodes: number; edges: number; shownNodes: number; shownEdges: number } | undefined;
  refreshing: boolean;
  readOnly: boolean;
  onRefresh: () => void;
  loading: boolean;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  looseOpen: boolean;
  onToggleLoose: () => void;
  onOpenContracts: () => void;
  onOpenCoverage: () => void;
  trail: Array<{ id: string; label: string }>;
  detail: DetailLevel | null;
  onDetail: (level: DetailLevel) => void;
  inferredCount: number;
  actions?: React.ReactNode;
}): React.ReactElement {
  const { filters, setParam, meta, totals } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [filtersOpen, setFiltersOpen] = useState(props.hasFilters);
  const prov = filters.provenance;
  const filterCount = [filters.contract, filters.provenance, filters.minConfidence].filter(
    (value) => value !== undefined,
  ).length;
  const setProv = (p: Provenance | undefined) =>
    setParam({ prov: p ?? null, ...(p === 'deterministic' ? { minc: null } : {}) });

  return (
    <div
      className="@container relative z-30 border-b border-border px-4 py-2.5"
      data-testid="map-toolbar"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <nav
          aria-label="Map level"
          className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-1.5 text-[13px] text-muted"
        >
          <button
            type="button"
            onClick={() => setParam({ sel: null })}
            className="hover:text-fg"
            title="Back to the whole workspace"
          >
            Workspace
          </button>
          {props.trail.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span aria-hidden="true">›</span>
              {i === props.trail.length - 1 ? (
                <span aria-current="location" className="font-mono text-xs text-fg">
                  {t.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => props.onSelect(t.id)}
                  className="font-mono text-xs hover:text-fg"
                >
                  {t.label}
                </button>
              )}
            </span>
          ))}
        </nav>

        <fieldset
          className="m-0 flex overflow-hidden rounded-lg border border-border-strong p-0"
          aria-label="Map lens"
          data-testid="lens-toggle"
        >
          {(['graph', 'matrix'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={props.lens === l}
              onClick={() => props.setParam({ lens: l === 'graph' ? null : l })}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                props.lens === l
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'bg-surface-2 text-muted hover:text-fg'
              }`}
            >
              {l}
            </button>
          ))}
        </fieldset>

        {/* Lente, detalle y procedencia: en un panel ancho fluyen y se parten en filas; en
            uno estrecho forman UNA tira desplazable en vez de apilarse en tres filas. */}
        <div className="flex min-w-0 items-center gap-x-5 gap-y-2.5 @3xl:flex-wrap @max-3xl:w-full @max-3xl:overflow-x-auto @max-3xl:pb-1 @max-3xl:pr-8 @max-3xl:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] [&>fieldset]:shrink-0">
          <fieldset
            className="m-0 flex overflow-hidden rounded-[10px] border border-border-strong p-0 text-[13px]"
            aria-label="Lens"
          >
            {[
              {
                label: 'Structure',
                on: props.outlineOpen,
                click: props.onToggleOutline,
                title: props.outlineOpen ? 'Hide the structure list' : 'Show the structure list',
              },
              {
                label: 'Loose ends',
                on: props.looseOpen,
                click: props.onToggleLoose,
                title: 'Calls the engine could not bind, and what each one is',
              },
              {
                label: 'Contracts',
                on: false,
                click: props.onOpenContracts,
                title: 'The same dependencies as a filterable contracts list',
              },
              {
                label: 'Coverage',
                on: false,
                click: props.onOpenCoverage,
                title: 'What the engine could not resolve, and index health per repo',
              },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                aria-pressed={b.label === 'Contracts' || b.label === 'Coverage' ? undefined : b.on}
                onClick={b.click}
                title={b.title}
                className={`px-3.5 py-1.5 transition-colors ${
                  b.on
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'bg-surface text-muted hover:text-fg'
                }`}
              >
                {b.label}
              </button>
            ))}
          </fieldset>

          <fieldset
            className="m-0 flex items-center gap-1.5 border-0 p-0 text-xs text-muted"
            aria-label="Detail level"
          >
            <span>Detail</span>
            {(['repos', 'services', 'endpoints'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={props.detail === l}
                onClick={() => props.onDetail(l)}
                className={`rounded-full border px-2.5 py-1 transition-colors ${
                  props.detail === l
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-strong text-muted hover:text-fg'
                }`}
              >
                {DETAIL_LABEL[l]}
              </button>
            ))}
          </fieldset>

          <fieldset
            className="m-0 flex items-center gap-1.5 border-0 p-0 text-xs"
            aria-label="Provenance"
          >
            <button
              type="button"
              aria-pressed={prov !== 'inferred'}
              title="Relations the engine proved by static analysis"
              onClick={() => setProv(prov === 'inferred' ? undefined : 'inferred')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                prov !== 'inferred'
                  ? 'border-deterministic bg-surface text-fg'
                  : 'border-border-strong text-muted'
              }`}
            >
              <EdgeSwatch provenance="deterministic" width={14} />
              Proven
            </button>
            <button
              type="button"
              aria-pressed={prov !== 'deterministic'}
              title="Relations bound by a heuristic, with a confidence score"
              onClick={() => setProv(prov === 'deterministic' ? undefined : 'deterministic')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                prov !== 'deterministic'
                  ? 'border-inferred bg-surface text-warning'
                  : 'border-border-strong text-muted'
              }`}
            >
              <EdgeSwatch provenance="inferred" width={14} />
              Inferred{props.inferredCount > 0 ? ` ${props.inferredCount}` : ''}
            </button>
          </fieldset>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Divider />
        <SearchBox workspaceId={props.workspaceId} onPick={props.onSelect} />

        <details
          className="relative"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        >
          <summary
            className={`flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors [&::-webkit-details-marker]:hidden ${
              props.hasFilters
                ? 'border-accent/30 bg-accent-soft text-accent'
                : 'border-border text-muted hover:bg-surface hover:text-fg'
            }`}
          >
            Filters
            {filterCount > 0 && (
              <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                {filterCount}
              </span>
            )}
            <span aria-hidden="true" className={filtersOpen ? 'rotate-180' : ''}>
              ⌄
            </span>
          </summary>
          <div className="absolute right-0 top-full mt-2 w-[38rem] max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-border bg-surface p-4 shadow-xl sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {prov !== 'deterministic' && (
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
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
                  <span className="w-7 tabular-nums">
                    {(filters.minConfidence ?? 0).toFixed(1)}
                  </span>
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Caption>Contract</Caption>
              <div className="flex flex-wrap items-center gap-1">
                {CONTRACTS.map((c) => {
                  const on = filters.contract === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                        on
                          ? 'bg-accent-soft text-accent font-medium'
                          : 'border border-transparent text-muted hover:bg-surface hover:text-fg'
                      }`}
                      onClick={() => setParam({ contract: on ? null : c })}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            {props.hasFilters && (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setParam({ contract: null, prov: null, minc: null })}
              >
                clear filters
              </button>
            )}
          </div>
        </details>
        {props.loading && <span className="text-xs text-muted">loading…</span>}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5 text-xs text-muted">
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
            onClick={props.onRefresh}
            disabled={props.refreshing || props.readOnly}
            title={
              props.readOnly
                ? 'Read-only access cannot rebuild the graph'
                : 'Rebuild the graph from LAIN'
            }
            className="h-8 rounded-lg border border-border px-2.5 transition-colors hover:bg-surface disabled:opacity-60"
          >
            {props.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {props.actions}
        </div>
      </div>
    </div>
  );
}

/** Separador vertical entre grupos de la barra: agrupa sin recargar de cajas. */
function Divider(): React.ReactElement {
  return <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />;
}

/** Rótulo de un grupo de filtros. */
function Caption({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted/80">
      {children}
    </span>
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
    <div className="relative min-w-[12rem] max-w-[20rem] flex-1">
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search repos, services…"
        aria-label="Search the map"
        className="h-8 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
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
                  <span className="ml-auto text-[10px] text-muted">
                    {r.meta.role === 'interfaces' ? 'Interfaces' : KIND_LABEL[r.kind]}
                  </span>
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
      className="overflow-hidden rounded-xl border border-border bg-surface/95 shadow-sm backdrop-blur"
      data-testid="map-legend"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-fg"
      >
        Legend
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M2 4l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-3 py-2 text-[11px] text-muted">
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
              <EdgeSwatch provenance="deterministic" width={22} /> deterministic · label ×N = call
              sites
            </span>
            <span className="inline-flex items-center gap-1.5">
              <EdgeSwatch provenance="inferred" width={22} /> inferred · label N·c = call sites ·
              confidence (fainter = less sure)
            </span>
          </div>
          <div>
            Click = select · double-click a box/dot = open/close it · drag = move · click empty
            canvas = deselect
          </div>
          <div>
            Box = container: repo box → service box → interface rows inside the service (like the
            contracts reference) · Code ▸ chip = open the repo's file tree
          </div>
          <div>
            Colors: grey = repo · indigo = service · slate rows = interfaces (full contract label) ·
            violet = code (file/function dots when drilled in) · selected node gets a green halo
          </div>
          <div>
            Edges run service → service: label ×N = N call sites (N·c = inferred, c = confidence) ·
            nothing is hidden — provenance is in the line, not in the opacity
          </div>
        </div>
      )}
    </div>
  );
}

/** Controles flotantes del lienzo: zoom, encuadre y la leyenda, en una sola pieza. */
function CanvasControls({
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoomPct,
  onFit,
  legendOpen,
  onToggleLegend,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  zoomPct: number;
  onFit: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
}): React.ReactElement {
  const btn =
    'grid h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-bg hover:text-fg active:bg-bg active:text-accent select-none touch-none';
  // Mantener pulsado repite el zoom (paso rápido) hasta soltar.
  const hold = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    fn();
    const t = window.setInterval(fn, 170);
    const stop = () => window.clearInterval(t);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  return (
    <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface/95 p-1.5 shadow-md backdrop-blur">
        <button
          type="button"
          className={btn}
          onPointerDown={hold(onZoomOut)}
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out (mantén pulsado para repetir)"
        >
          <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 6h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="h-10 min-w-14 rounded-lg px-1 tabular-nums text-xs font-medium text-muted transition-colors hover:bg-bg hover:text-fg"
          onClick={onZoomReset}
          aria-label="Restablecer zoom al 100%"
          title="Restablecer zoom al 100%"
        >
          {zoomPct}%
        </button>
        <button
          type="button"
          className={btn}
          onPointerDown={hold(onZoomIn)}
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in (mantén pulsado para repetir)"
        >
          <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M6 2v8M2 6h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="mx-0.5 h-6 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          className={btn}
          onClick={onFit}
          aria-label="Fit to view"
          title="Encajar todo en pantalla"
        >
          <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 4.5V2h2.5M7.5 2H10v2.5M10 7.5V10H7.5M4.5 10H2V7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <Legend open={legendOpen} onToggle={onToggleLegend} />
    </div>
  );
}
