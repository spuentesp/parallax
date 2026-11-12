// MapCanvas — el lienzo del mapa: Cytoscape con nodos compuestos (repo ⊃
// servicio ⊃ endpoint). Sólo dibuja lo que el servidor proyectó; no calcula
// jerarquía ni agrega aristas. Colores y trazos salen de los tokens de
// index.css (se releen al cambiar el tema), nada está cableado a "dark".

import type { MapViewResponse } from '@parallax/shared/org-map';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import type * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { type CyElement, layoutInput, toCyElements } from './elements.js';
import { layoutMap, type MapLayout, type Point } from './layout.js';

export interface MapCanvasProps {
  view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>;
  selectedId: string | null;
  /** Vecindad enfocada: lo demás se atenúa. null = sin foco. */
  focusIds: ReadonlySet<string> | null;
  onSelect: (id: string | null) => void;
  /** Abre/cierra un nodo (doble clic). */
  onToggle: (id: string) => void;
  /** Cambia cuando el usuario pide recentrar (botón "fit" de fuera). */
  fitNonce?: number;
  /** Trazado de punta a punta activo (clave y servicio). */
  traceContract?: { key: string; service: string | null } | null;
  /** Límite numérico de bifurcación (fanout) para el trazado de punta a punta. */
  traceFanoutLimit?: number;
}

/** Controles del lienzo que la barra de fuera no puede alcanzar (zoom). */
export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

const TOKEN = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

const FONT_UI = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

export function buildStyle(): StylesheetJson {
  const fg = TOKEN('--color-fg', '#14161a');
  const muted = TOKEN('--color-muted', '#667080');
  const surface = TOKEN('--color-surface', '#ffffff');
  const accent = TOKEN('--color-accent', '#4d7c0f');
  const repo = TOKEN('--color-repo', '#5b6572');
  const service = TOKEN('--color-service', '#4f46e5');
  const endpoint = TOKEN('--color-endpoint', '#475569');
  const codeC = TOKEN('--color-code', '#6d28d9');
  const fileC = TOKEN('--color-file', '#7c3aed');
  const symbolC = TOKEN('--color-symbol', '#8b5cf6');
  const det = TOKEN('--color-deterministic', '#8a97a8');
  const inf = TOKEN('--color-inferred', '#d97706');

  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-family': FONT_UI,
        'font-size': 13,
        color: fg,
        'text-wrap': 'ellipsis',
        'text-max-width': 'data(tw)' as unknown as string,
        'text-valign': 'center',
        'text-halign': 'center',
        'min-zoomed-font-size': 10,
        'overlay-opacity': 0,
        'border-width': 1.5,
        'transition-property': 'border-width, border-color, background-opacity, opacity',
        'transition-duration': 120,
        'transition-timing-function': 'ease-out',
      },
    },
    // Repositorio: la caja más externa. Su halo suave da profundidad sin
    // sombras (Cytoscape no las tiene).
    {
      selector: 'node.repo',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 16 as unknown as string,
        'background-color': repo,
        'background-opacity': 0.04,
        'border-color': repo,
        'border-width': 1.5,
        'underlay-color': repo,
        'underlay-opacity': 0.07,
        'underlay-padding': 4,
        'font-weight': 600,
        width: 'data(w)',
        height: 'data(h)',
        // Los repos contienen servicios, y cada servicio lleva su rótulo
        // encima de su caja: sin esta banda, el rótulo del servicio cae
        // sobre el borde del repo y parece tachado.
        padding: '28px',
      },
    },
    {
      selector: 'node.service',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 12 as unknown as string,
        'background-color': service,
        'background-opacity': 0.03,
        'border-color': service,
        'font-weight': 500,
        width: 'data(w)',
        height: 'data(h)',
        padding: '14px',
      },
    },
    {
      selector: 'node.group',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 8 as unknown as string,
        'background-color': 'transparent',
        'background-opacity': 0,
        'border-color': muted,
        'border-width': 1,
        'border-style': 'dashed',
        'border-opacity': 0.35,
        width: 'data(w)',
        height: 'data(h)',
        padding: '10px',
        'font-weight': 500,
        'font-size': 11,
        color: muted,
      },
    },
    {
      selector: 'node.interfaces',
      style: {
        'corner-radius': 12 as unknown as string,
        'background-color': service,
        'background-opacity': 0.06,
        'border-color': service,
        'border-opacity': 0.65,
        'border-width': 1.5,
        color: fg,
        'font-weight': 600,
        'font-size': 13,
      },
    },
    // Hoja: tarjeta neutra. El color lo pone el borde; el fondo es la superficie.
    {
      selector: 'node.endpoint',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 8 as unknown as string,
        'background-color': surface,
        'background-opacity': 1,
        'border-color': endpoint,
        'border-width': 1.25,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 12,
        'font-family': FONT_MONO,
      },
    },
    // Grafo de código: la puerta ("Code"), archivos/módulos y símbolos.
    {
      selector: 'node.code',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 10 as unknown as string,
        'background-color': 'transparent',
        'background-opacity': 0,
        'border-color': codeC,
        'border-width': 1,
        'border-style': 'dashed',
        'border-opacity': 0.45,
        'font-weight': 500,
        'font-size': 12,
        color: codeC,
        width: 'data(w)',
        height: 'data(h)',
        padding: '12px',
      },
    },
    {
      selector: 'node.code:parent',
      style: {
        'background-color': codeC,
        'background-opacity': 0.04,
        'border-style': 'solid',
        'border-opacity': 0.75,
        'border-width': 1.25,
        padding: '16px',
      },
    },
    {
      selector: 'node.file',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 10 as unknown as string,
        'background-color': fileC,
        'background-opacity': 0.05,
        'border-color': fileC,
        width: 'data(w)',
        height: 'data(h)',
        padding: '16px',
        'font-size': 12,
        'font-family': FONT_MONO,
      },
    },
    {
      selector: 'node.symbol',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 8 as unknown as string,
        'background-color': surface,
        'background-opacity': 1,
        'border-color': symbolC,
        'border-width': 1.25,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 12,
        'font-family': FONT_MONO,
      },
    },
    // Abiertos: contenedor, la etiqueta va arriba y el padding deja sitio a los hijos.
    {
      selector: ':parent',
      style: {
        'text-valign': 'top',
        'text-halign': 'center',
        // El rótulo vive en la banda reservada por el reparto (arriba del
        // rectángulo): si roza el borde, parecía tachado.
        'text-margin-y': -8,
        'compound-sizing-wrt-labels': 'exclude',
        'border-style': 'solid',
      },
    },
    // Plegados con hijos: borde punteado = "hay más dentro" (doble clic).
    { selector: 'node.collapsible', style: { 'border-style': 'dashed' } },
    // Selección: el nodo no pierde el color de su tipo; se le pone un halo.
    {
      selector: 'node:selected',
      style: {
        'border-width': 2.5,
        'outline-width': 3,
        'outline-color': accent,
        'outline-opacity': 0.9,
        'outline-offset': 2,
        'z-index': 10,
      },
    },
    // Hover: el nodo responde al puntero sin cambiar de color.
    {
      selector: 'node.hover',
      style: { 'border-width': 2.5, 'underlay-opacity': 0.16, 'z-index': 9 },
    },
    // Nodo conectado destacado cuando se selecciona su par: se muestra claro con halo
    {
      selector: 'node.connected-peer',
      style: {
        'border-width': 2.5,
        'border-color': accent,
        'border-style': 'solid',
        'underlay-color': accent,
        'underlay-opacity': 0.18,
        'underlay-padding': 4,
        'z-index': 9,
      },
    },
    // Trazado de punta a punta: nodos y enlaces destacados a lo largo de toda la cadena
    {
      selector: 'node.trace-node',
      style: {
        'border-width': 3,
        'border-color': accent,
        'border-style': 'solid',
        'underlay-color': accent,
        'underlay-opacity': 0.28,
        'underlay-padding': 6,
        'z-index': 12,
      },
    },
    {
      selector: 'edge.trace-edge',
      style: {
        'line-color': accent,
        'target-arrow-color': accent,
        width: 3.2,
        opacity: 1,
        'z-index': 11,
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 'data(width)',
        opacity: 'data(opacity)' as unknown as number,
        // Líneas finas y limpias: punta pequeña, extremos redondos y un respiro respecto al nodo.
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.65,
        'line-cap': 'round',
        'source-distance-from-node': 2,
        'target-distance-from-node': 4,
        // El rótulo (×N) sólo aparece al mirar la arista: en conjunto es ruido.
        label: '',
        'font-size': 9,
        color: muted,
        'text-background-color': surface,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
        'overlay-opacity': 0,
      },
    },
    // Determinista = trazo continuo y neutro; inferido = trazo discontinuo y ámbar.
    {
      selector: 'edge.deterministic',
      style: { 'line-color': det, 'target-arrow-color': det, 'line-style': 'solid' },
    },
    {
      selector: 'edge.inferred',
      style: {
        'line-color': inf,
        'target-arrow-color': inf,
        'line-style': 'dashed',
        'line-dash-pattern': [5, 4],
      },
    },
    // Relaciones de código bajo demanda: limpias por defecto, rótulo sólo al enfocar
    {
      selector: 'edge.code-edge',
      style: {
        'line-style': 'dashed',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.55,
        label: '',
        'font-size': 8,
        color: muted,
        opacity: 0.45,
        'text-background-color': surface,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
      },
    },
    {
      selector: 'edge.code-edge:selected, edge.code-edge.hl, edge.code-edge.loud',
      style: {
        label: 'data(label)',
        opacity: 1,
        width: 1.8,
      },
    },
    { selector: 'edge.calls', style: { 'line-color': accent, 'target-arrow-color': accent } },
    { selector: 'edge.uses', style: { 'line-color': symbolC, 'target-arrow-color': symbolC } },
    {
      selector: 'edge.imports',
      style: {
        'line-color': muted,
        'target-arrow-color': muted,
        'line-style': 'dotted',
        opacity: 0.25,
      },
    },
    {
      selector: 'edge.servedby, edge.implements',
      style: {
        'line-color': codeC,
        'target-arrow-color': codeC,
        'line-style': 'dashed',
        'line-dash-pattern': [4, 3],
        width: 1.5,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.6,
        label: '',
        'font-size': 8,
        color: codeC,
        'text-background-color': surface,
        'text-background-opacity': 0.85,
      },
    },
    {
      selector:
        'edge.servedby:selected, edge.servedby.hl, edge.servedby.loud, edge.implements:selected',
      style: {
        label: 'data(label)',
        opacity: 1,
        width: 2,
      },
    },
    // Atenuar es jerarquizar, no borrar: por debajo de este valor el nodo se
    // vuelve ilegible y se pierde el contexto de dónde estaba.
    { selector: '.dim', style: { opacity: 0.2 } },
    // Relaciones secundarias de un grafo denso: presentes, pero en segundo plano.
    { selector: 'edge.quiet', style: { opacity: 0.12, width: 1 } },
    { selector: 'edge.hl, edge.loud', style: { opacity: 1, 'z-index': 10, label: 'data(label)' } },
  ];
}

/**
 * Aplica el reparto calculado en layout.ts (posiciones de las hojas; los
 * contenedores se ajustan solos a sus hijos). Encuadrar necesita un contenedor
 * con tamaño — pestaña oculta, primer render —: si no lo tiene se deja
 * `pending` y el ResizeObserver encuadra cuando haya sitio.
 */
function applyLayout(cy: Core, lay: MapLayout, first: boolean): 'done' | 'pending' {
  cy.batch(() => {
    for (const [id, p] of lay.leaves) {
      const n = cy.getElementById(id);
      const size = lay.sizes.get(id);
      if (n.empty()) continue;
      if (size) n.data({ w: size.w, h: size.h, tw: size.w - 12 });
      n.position(p);
    }
  });
  const box = cy.container();
  if (!box || box.clientWidth === 0 || box.clientHeight === 0) {
    cy.scratch('pendingFit', { first });
    return 'pending';
  }
  cy.scratch('pendingFit', null);
  if (first) cy.fit(undefined, 40);
  return 'done';
}

/** Ids de elementos para decidir si hay que recolocar (cambió la estructura). */
function signature(els: CyElement[]): string {
  return els
    .map((e) => (e.group === 'nodes' ? `n:${e.data.id}:${e.data.parent ?? ''}` : `e:${e.data.id}`))
    .sort()
    .join('|');
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    view,
    selectedId,
    focusIds,
    onSelect,
    onToggle,
    fitNonce = 0,
    traceContract = null,
    traceFanoutLimit = 3,
  },
  ref,
): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const lastSig = useRef('');
  const touched = useRef(false);
  // Posiciones de primer nivel del reparto anterior: abrir un nodo no baraja el resto.
  const topRef = useRef<ReadonlyMap<string, Point>>(new Map());
  // Los handlers de Cytoscape se registran una vez: leen siempre lo último.
  const handlers = useRef({ onSelect, onToggle });
  handlers.current = { onSelect, onToggle };

  // Zoom y encuadre desde los controles flotantes del lienzo.
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.zoom({
          level: Math.min(cy.zoom() * 1.25, cy.maxZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
      },
      zoomOut: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.zoom({
          level: Math.max(cy.zoom() / 1.25, cy.minZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
      },
      fit: () => {
        const cy = cyRef.current;
        if (!cy || cy.elements().empty()) return;
        cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 200 });
      },
    }),
    [],
  );

  // Montaje único de la instancia.
  useEffect(() => {
    if (!host.current) return;
    const cy = cytoscape({
      container: host.current,
      // Sin layout inicial: el de por defecto (grid) mide el contenedor y falla
      // si aún no tiene tamaño; el nuestro se corre al llegar los datos.
      layout: { name: 'null' },
      style: buildStyle(),
      minZoom: 0.15,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (ev) => handlers.current.onSelect(String(ev.target.id())));
    cy.on('dbltap', 'node', (ev) => handlers.current.onToggle(String(ev.target.id())));
    cy.on('tap', (ev) => {
      if (ev.target === cy) handlers.current.onSelect(null);
    });
    // Hover: el nodo se ilumina un instante bajo el puntero. Cytoscape no
    // tiene propiedad de cursor, así que el puntero se cambia en el lienzo.
    cy.on('mouseover', 'node', (ev) => {
      ev.target.addClass('hover');
      if (host.current) host.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node', (ev) => {
      ev.target.removeClass('hover');
      if (host.current) host.current.style.cursor = '';
    });
    // Conservar las posiciones movidas por el usuario para que al expandir o
    // plegar un contenedor no rebote a la posición previa.
    const syncTopPositions = () => {
      const next = new Map<string, Point>(topRef.current);
      for (const n of cy.nodes()) {
        if (n.isChild()) continue;
        const bb = n.boundingBox();
        next.set(n.id(), {
          x: (bb.x1 + bb.x2) / 2,
          y: (bb.y1 + bb.y2) / 2,
        });
      }
      topRef.current = next;
    };
    cy.on('dragfree', 'node', syncTopPositions);
    cyRef.current = cy;
    // Instancia nueva = lienzo vacío: el diff de datos tiene que volver a repartir
    // (StrictMode monta, desmonta y monta de nuevo conservando los refs).
    lastSig.current = '';
    topRef.current = new Map();
    // Gancho de inspección para las comprobaciones en navegador real (dev).
    if (import.meta.env.DEV) (window as unknown as { __parallaxCy?: Core }).__parallaxCy = cy;

    // El usuario toma la vista (arrastra/rueda): desde ahí deja de encuadrarse solo.
    const take = () => {
      touched.current = true;
    };
    host.current?.addEventListener('wheel', take, { passive: true });
    host.current?.addEventListener('pointerdown', take);

    // Cuántos nodos caen dentro del lienzo visible (comprobable desde fuera).
    // Con rAF para no evaluar renderedBoundingBox() N veces por cuadro durante animaciones o arrastre.
    let reportFrame: number | null = null;
    const reportVisible = () => {
      const box = cy.container();
      if (!box) return;
      const w = box.clientWidth;
      const h = box.clientHeight;
      const visible = cy.nodes().filter((n) => {
        const b = n.renderedBoundingBox();
        return b.x2 > 0 && b.y2 > 0 && b.x1 < w && b.y1 < h;
      }).length;
      host.current?.setAttribute('data-visible', String(visible));
    };

    const scheduleReport = () => {
      if (reportFrame !== null) return;
      reportFrame = requestAnimationFrame(() => {
        reportFrame = null;
        reportVisible();
      });
    };

    cy.on('layoutstop add remove', reportVisible);
    cy.on('viewport position', scheduleReport);
    reportVisible();

    const ro = new ResizeObserver(() => {
      cy.resize();
      const pending = cy.scratch('pendingFit') as { first: boolean } | null | undefined;
      if (pending && cy.nodes().nonempty()) {
        cy.scratch('pendingFit', null);
        if (pending.first) cy.fit(undefined, 40);
        host.current?.setAttribute('data-layout', 'done');
      } else if (!touched.current && cy.nodes().nonempty()) {
        // El hueco cambió (se abrió/cerró el chat o el esquema): sin vista propia, se reencuadra.
        cy.fit(undefined, 40);
      }
    });
    if (host.current) ro.observe(host.current);

    // El tema cambia con la clase de <html>: se releen los tokens.
    const mo = new MutationObserver(() => cy.style(buildStyle()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      if (reportFrame !== null) cancelAnimationFrame(reportFrame);
      host.current?.removeEventListener('wheel', take);
      host.current?.removeEventListener('pointerdown', take);
      ro.disconnect();
      mo.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Datos: diff incremental para conservar posiciones de lo que ya estaba.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const els = toCyElements(view);
    const sig = signature(els);
    const wanted = new Set(els.map((e) => e.data.id));

    let added: cytoscape.Collection | null = null;
    cy.batch(() => {
      cy.elements()
        .filter((el) => !wanted.has(el.id()))
        .remove();
      const toAdd: ElementDefinition[] = [];
      // Nodos antes que aristas, y padres antes que hijos.
      const ordered = [...els].sort(
        (a, b) => Number(b.group === 'nodes') - Number(a.group === 'nodes'),
      );
      for (const e of ordered) {
        const found = cy.getElementById(e.data.id);
        if (found.nonempty()) {
          found.data(e.data);
          found.classes(e.classes);
        } else {
          toAdd.push({ group: e.group, data: e.data, classes: e.classes });
        }
      }
      if (toAdd.length > 0) added = cy.add(toAdd);
    });

    if (sig !== lastSig.current) {
      const first = lastSig.current === '';
      lastSig.current = sig;
      if (els.length > 0) {
        const input = layoutInput(view);
        const lay = layoutMap(input.nodes, input.edges, topRef.current);
        topRef.current = lay.top;
        const state = applyLayout(cy, lay, first);
        host.current?.setAttribute('data-layout', state);
        // Tras abrir un nodo se encuadra lo que apareció (y su contenedor), no
        // todo el grafo: el usuario no pierde el hilo ni queda mirando un vacío.
        const fresh = added as cytoscape.Collection | null;
        if (state === 'done' && !first && fresh?.nodes().nonempty()) {
          if (touched.current) {
            // Si el usuario ya movió o ajustó la vista, sólo reencuadrar si lo
            // nuevo cae fuera del lienzo visible; si ya está en pantalla, no
            // mover la cámara para evitar que la caja parezca rebotar.
            const box = cy.container();
            if (box && box.clientWidth > 0 && box.clientHeight > 0) {
              const target = fresh.nodes().union(fresh.nodes().ancestors());
              const bb = target.renderedBoundingBox();
              const pad = 24;
              const isOffscreen =
                bb.x1 < pad ||
                bb.y1 < pad ||
                bb.x2 > box.clientWidth - pad ||
                bb.y2 > box.clientHeight - pad;
              if (isOffscreen) {
                cy.animate({ fit: { eles: target, padding: 60 }, duration: 200 });
              }
            }
          } else {
            // Si el usuario aún no movió la vista (apertura automática, filtros), se
            // encuadra TODO: nada puede quedar fuera de pantalla sin que lo sepa.
            cy.fit(undefined, 40);
          }
        }
      }
    }
  }, [view]);

  // Selección, foco y trazado de punta a punta: sólo clases, sin tocar la geometría.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` re-aplica las clases
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dim hl loud connected-peer trace-node trace-edge');
      cy.nodes().unselect();
      if (focusIds) {
        cy.nodes()
          .filter((n) => !focusIds.has(n.id()) && !n.isParent())
          .addClass('dim');
        const inside = cy
          .edges()
          .filter((e) => focusIds.has(e.source().id()) && focusIds.has(e.target().id()));
        inside.addClass('loud');
        cy.edges().not(inside).addClass('dim');
      }

      // Si hay un trazado de punta a punta activo, se recorre toda la cadena de conexiones
      // respetando el límite numérico de bifurcación (fanout) y protegiendo contra bucles cíclicos.
      if (traceContract) {
        let startNode = selectedId ? cy.getElementById(selectedId) : cy.collection();
        if (startNode.empty() || startNode.data('kind') !== 'endpoint') {
          const matching = cy.nodes().filter((n) => {
            const label = n.data('label');
            const k = n.data('contract');
            return (
              (label === traceContract.key || k === traceContract.key) &&
              (!traceContract.service ||
                n.parent().data('label') === traceContract.service ||
                n.id().includes(traceContract.service))
            );
          });
          if (matching.nonempty() && matching[0]) {
            startNode = cy.collection().merge(matching[0]);
          }
        }

        if (startNode.nonempty()) {
          startNode.select();
          const fanoutCap = traceFanoutLimit && traceFanoutLimit > 0 ? traceFanoutLimit : 3;

          // Recorrido bidireccional multirramal (upstream + downstream)
          const traceNodes = cy.collection();
          const traceEdges = cy.collection();
          const visitedNodeIds = new Set<string>();

          traceNodes.merge(startNode);
          visitedNodeIds.add(startNode.id());

          const queue: string[] = [startNode.id()];

          while (queue.length > 0) {
            const currId = queue.shift();
            if (!currId) break;
            const curr = cy.getElementById(currId);
            if (curr.empty()) continue;

            const edges = curr.connectedEdges();
            let branchesTaken = 0;

            for (let i = 0; i < edges.length; i++) {
              const edge = edges[i];
              if (!edge) continue;
              const src = edge.source();
              const tgt = edge.target();
              const other = src.id() === currId ? tgt : src;

              // Detección de bucles/dependencias cíclicas: la arista se mantiene visible
              // pero no se vuelve a encolar para evitar loops infinitos
              if (visitedNodeIds.has(other.id())) {
                traceEdges.merge(edge);
                continue;
              }

              // Límite de bifurcación (fanout) por nodo
              if (branchesTaken >= fanoutCap) {
                continue;
              }

              branchesTaken++;
              visitedNodeIds.add(other.id());
              traceNodes.merge(other);
              traceEdges.merge(edge);
              queue.push(other.id());
            }
          }

          const keepNodes = traceNodes.union(traceNodes.ancestors());
          const keepElements = keepNodes.union(traceEdges);

          // Atenuar elementos fuera del trazado
          cy.elements().not(keepElements).addClass('dim');
          keepElements.removeClass('dim');

          // Destacar nodos y aristas a lo largo de todo el trazado
          traceNodes.addClass('trace-node connected-peer');
          traceEdges.addClass('trace-edge hl loud');
        }
      } else if (selectedId) {
        const n = cy.getElementById(selectedId);
        if (n.nonempty()) {
          n.select();
          const connectedEdges = n.connectedEdges();
          if (connectedEdges.nonempty()) {
            const peers = connectedEdges.connectedNodes().not(n);
            // Conservar nítidos el nodo elegido, sus ancestros/hijos, y todas las
            // cajas conectadas a él con sus contenedores correspondientes.
            const keepNodes = n
              .union(n.ancestors())
              .union(n.descendants())
              .union(peers)
              .union(peers.ancestors())
              .union(peers.descendants());
            const keepElements = keepNodes.union(connectedEdges);

            // Atenuar elementos no relacionados
            cy.elements().not(keepElements).addClass('dim');
            keepElements.removeClass('dim');

            // Destacar las aristas conectadas sobre el resto
            connectedEdges.addClass('hl loud');

            // Resaltar las cajas conectadas para que no queden como bloques opacos/apagados
            peers.addClass('connected-peer');
          }
        }
      }
    });
  }, [selectedId, focusIds, view, traceContract, traceFanoutLimit]);

  // Un foco nuevo (agente, "Focus neighborhood") encuadra su vecindad.
  const focusKey = useMemo(() => (focusIds ? [...focusIds].sort().join('|') : ''), [focusIds]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo reencuadra cuando cambia el conjunto enfocado
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusIds || focusIds.size === 0) return;
    const eles = cy.nodes().filter((n) => focusIds.has(n.id()));
    if (eles.nonempty()) cy.animate({ fit: { eles, padding: 90 }, duration: 240 });
  }, [focusKey]);

  useEffect(() => {
    if (fitNonce > 0)
      cyRef.current?.animate({
        fit: { eles: cyRef.current.elements(), padding: 40 },
        duration: 200,
      });
  }, [fitNonce]);

  // Al seleccionar desde fuera (outline, búsqueda, agente) se centra el nodo.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedId) return;
    const n = cy.getElementById(selectedId);
    if (n.nonempty()) cy.animate({ center: { eles: n }, duration: 180 });
  }, [selectedId]);

  // Cytoscape toma el control del estilo de su contenedor (lo fuerza a
  // `position: relative`), así que el contenedor no puede ser el elemento
  // absoluto: va dentro de uno que sí ocupa el hueco.
  return (
    <div className="absolute inset-0">
      <div
        ref={host}
        data-testid="map-canvas"
        data-nodes={view.nodes.length}
        data-edges={view.edges.length}
        role="application"
        aria-label="Architecture map"
        className="map-grid w-full h-full"
      />
    </div>
  );
});
