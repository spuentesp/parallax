// MapCanvas — el lienzo del mapa: Cytoscape con nodos compuestos (repo ⊃
// servicio ⊃ endpoint). Sólo dibuja lo que el servidor proyectó; no calcula
// jerarquía ni agrega aristas. Colores y trazos salen de los tokens de
// index.css (se releen al cambiar el tema), nada está cableado a "dark".

import type { MapViewResponse } from '@parallax/shared/org-map';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from 'cytoscape';
import type * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { type CyElement, layoutInput, toCyElements } from './elements.js';
import { layoutMap, type MapLayout } from './layout.js';

export interface MapCanvasProps {
  view: Pick<MapViewResponse, 'nodes' | 'edges' | 'hiddenChildren'>;
  selectedId: string | null;
  /** Vecindad enfocada: lo demás se atenúa. null = sin foco. */
  focusIds: ReadonlySet<string> | null;
  /** Nodos a resaltar cuando la selección cae en un nodo sólo de cliente (p. ej. un clúster). */
  highlightIds?: ReadonlySet<string> | null;
  onSelect: (id: string | null) => void;
  /** Abre/cierra un nodo (doble clic). */
  onToggle: (id: string) => void;
  /** Cambia cuando el usuario pide recentrar (botón "fit" de fuera). */
  fitNonce?: number;
  /** Trazado de punta a punta activo (clave y servicio). */
  traceContract?: { key: string; service: string | null } | null;
  /** Límite numérico de bifurcación (fanout) para el trazado de punta a punta. */
  traceFanoutLimit?: number;
  /** Nivel de zoom actual, para mostrarlo en los controles (100 = 1x). */
  onZoomLevel?: (level: number) => void;
}

/** Controles del lienzo que la barra de fuera no puede alcanzar (zoom). */
export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Vuelve a 100% (zoom 1) centrado. */
  zoomReset: () => void;
  fit: () => void;
}

const TOKEN = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

const FONT_UI = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';
/** Paso de zoom por clic (los botones repiten al mantener pulsado). */
const ZOOM_STEP = 1.35;

/** Zoom alrededor del centro del lienzo; sin tamaño medible (p. ej. tests) zoom plano. */
function zoomAboutCenter(cy: Core, level: number): void {
  const w = cy.width();
  const h = cy.height();
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    cy.zoom({ level, renderedPosition: { x: w / 2, y: h / 2 } });
  } else {
    cy.zoom(level);
  }
}

export function buildStyle(): StylesheetJson {
  const fg = TOKEN('--color-fg', '#14161a');
  const muted = TOKEN('--color-muted', '#667080');
  const surface = TOKEN('--color-surface', '#ffffff');
  const accent = TOKEN('--color-accent', '#4d7c0f');
  const repo = TOKEN('--color-repo', '#5b6572');
  const service = TOKEN('--color-service', '#4f46e5');
  const codeC = TOKEN('--color-code', '#6d28d9');
  const fileC = TOKEN('--color-file', '#7c3aed');
  const symbolC = TOKEN('--color-symbol', '#8b5cf6');
  const det = TOKEN('--color-deterministic', '#8a97a8');
  const inf = TOKEN('--color-inferred', '#d97706');
  const borderStrong = TOKEN('--color-border-strong', '#343b45');
  const repoFill = TOKEN('--color-repo-fill', '#0f1216');
  const serviceFill = TOKEN('--color-service-fill', '#141824');
  const surface2 = TOKEN('--color-surface-2', '#171b21');

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
        // Como en la referencia "Contracts lens": caja sólida #0f1216 con
        // borde #343b45 y rótulo mono arriba a la izquierda.
        shape: 'round-rectangle',
        'corner-radius': 12 as unknown as string,
        'background-color': repoFill,
        'background-opacity': 1,
        'border-color': borderStrong,
        'border-width': 1,
        'font-weight': 600,
        'font-family': FONT_MONO,
        'font-size': 12,
        color: repo,
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
        // Servicio: caja #141824 con borde índigo tenue (#818cf8 al 70%);
        // seleccionado o destacado pasa a borde de acento a 2px.
        shape: 'round-rectangle',
        'corner-radius': 10 as unknown as string,
        'background-color': serviceFill,
        'background-opacity': 1,
        'border-color': service,
        'border-opacity': 0.7,
        'border-width': 1.5,
        'font-weight': 500,
        'font-family': FONT_MONO,
        'font-size': 13,
        width: 'data(w)',
        height: 'data(h)',
        padding: '14px',
      },
    },
    {
      selector: 'node.service:selected, node.service.hl, node.service.connected-peer',
      style: {
        'border-color': accent,
        'border-opacity': 1,
        'border-width': 2,
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
    // Clúster de contratos relacionados dentro de un grupo: caja punteada más
    // tenue que el grupo, para leer "familia" sin competir con el servicio.
    {
      selector: 'node.group.cluster',
      style: {
        'border-style': 'dotted',
        'border-opacity': 0.3,
        padding: '8px',
        'font-size': 10,
      },
    },
    // Un contenedor SIN hijos es una hoja: el layout le reserva exactamente w×h.
    // En Cytoscape el padding se suma por fuera del tamaño, así que el de los
    // contenedores (28/14/10px) agrandaba los repos colapsados hasta ~90px de alto
    // y se montaban unos sobre otros.
    {
      selector: 'node.repo:childless, node.service:childless, node.group:childless',
      style: { padding: '0px' },
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
    // Fila de interfaz dentro de la caja de su servicio (modelo de la
    // referencia): tarjeta plana a todo lo ancho, rótulo a la izquierda en
    // mono — el contrato completo ya incluye su tipo ("http:GET /x").
    {
      selector: 'node.endpoint.row',
      style: {
        // Fila de contrato como en la referencia: tarjeta sólida #171b21 a
        // todo lo ancho, borde #343b45, rótulo de dos líneas centrado.
        shape: 'round-rectangle',
        'corner-radius': 8 as unknown as string,
        'background-color': surface2,
        'background-opacity': 1,
        'border-color': borderStrong,
        'border-opacity': 1,
        'border-width': 1,
        width: 'data(w)',
        height: 'data(h)',
        'padding-left': '10px',
        'padding-right': '8px',
        // Centrado: con halign left/right este build del lienzo dibuja el rótulo
        // FUERA de la caja cuando el texto es más ancho; centrado queda dentro.
        // El rótulo es de dos líneas: tipo de contrato arriba, nombre debajo.
        'text-halign': 'center',
        'text-valign': 'center',
        // El rótulo ya viene truncado para caber en la fila (elements.nodeLabel):
        // wrap rompe en el "\n" (tipo arriba, nombre debajo, como la referencia)
        // y nunca más allá del ancho del nodo (text-max-width = data(w)).
        'text-wrap': 'wrap',
        'text-max-width': 'data(w)' as unknown as string,
        'font-size': 11,
        'font-family': FONT_MONO,
        color: fg,
      },
    },
    {
      selector:
        'node.endpoint.row.hover, node.endpoint.row:selected, node.endpoint.row.hl, node.endpoint.row.loud',
      style: {
        'background-color': accent,
        'background-opacity': 0.16,
        'border-color': accent,
        'border-opacity': 1,
        'border-width': 1.5,
        'z-index': 20,
      },
    },
    // Grafo de código: la puerta ("Code"), archivos/módulos y símbolos.
    // Plegada es una pastilla compacta (botón "Code ▸"); abierta es la caja
    // que contiene los archivos. Nunca una caja vacía con título.
    {
      selector: 'node.code',
      style: {
        'font-weight': 500,
        'font-size': 12,
        color: codeC,
      },
    },
    {
      selector: 'node.code:childless',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 13 as unknown as string,
        width: 96 as unknown as string,
        height: 26 as unknown as string,
        'background-color': codeC,
        'background-opacity': 0.14,
        'border-color': codeC,
        'border-width': 1,
        'border-style': 'solid',
        'border-opacity': 0.7,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'none',
        'text-max-width': 90 as unknown as string,
        padding: '0px',
        label: 'data(label)',
      },
    },
    {
      selector: 'node.code:childless.hover, node.code:childless:selected',
      style: {
        'background-opacity': 0.18,
        'border-opacity': 1,
        'border-width': 1.5,
      },
    },
    {
      selector: 'node.code:parent',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 10 as unknown as string,
        width: 'data(w)',
        height: 'data(h)',
        padding: '12px',
        'background-color': codeC,
        'background-opacity': 0.04,
        'border-color': codeC,
        'border-width': 1,
        'border-style': 'dashed',
        'border-opacity': 0.45,
      },
    },
    {
      selector: 'node.file',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 10 as unknown as string,
        'background-color': fileC,
        'background-opacity': 0.12,
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
        'background-color': symbolC,
        'background-opacity': 0.14,
        'border-color': symbolC,
        'border-width': 1.25,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 12,
        'font-family': FONT_MONO,
      },
    },
    // Unidad básica = punto (va después de symbol/file para ganarles a las
    // hojas): servicio, archivo, clase o función plegados son nodos, no cajas.
    // Lleva el rótulo debajo; el tamaño/color distinguen el tipo de unidad.
    {
      selector: 'node.dot',
      style: {
        shape: 'ellipse',
        width: 18 as unknown as string,
        height: 18 as unknown as string,
        // Sin padding: el punto mide lo que mide; el rótulo vive en la banda
        // LABEL_H que ya reserva el layout (con padding el nodo renderizado
        // crecía y las etiquetas chocaban con la fila de abajo).
        padding: '0px',
        'background-color': service,
        'background-opacity': 0.9,
        'border-width': 0,
        label: 'data(label)',
        color: fg,
        'font-size': 11,
        'font-weight': 500,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-max-width': 140 as unknown as string,
        'text-background-color': surface,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
      },
    },
    // Azul = servicio (unidad que corre); violeta = unidad de código.
    {
      selector: 'node.file.dot',
      style: {
        width: 14 as unknown as string,
        height: 14 as unknown as string,
        'background-color': fileC,
        'background-opacity': 0.9,
      },
    },
    {
      selector: 'node.symbol.dot',
      style: {
        width: 10 as unknown as string,
        height: 10 as unknown as string,
        'background-color': symbolC,
        'background-opacity': 0.9,
      },
    },
    // Punto plegado con hijos ocultos: anillo punteado = "hay más dentro".
    {
      selector: 'node.dot.collapsible',
      style: {
        'border-width': 1.5,
        'border-style': 'dashed',
        'border-color': muted,
      },
    },
    // Abiertos: contenedor, la etiqueta va arriba y el padding deja sitio a los hijos.
    {
      selector: ':parent',
      style: {
        'text-valign': 'top',
        // Rótulo de contenedor arriba a la IZQUIERDA, como en la referencia.
        'text-halign': 'left',
        'text-margin-x': 12,
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
        'border-color': accent,
        'outline-width': 3,
        'outline-color': accent,
        'outline-opacity': 0.9,
        'outline-offset': 2,
        'underlay-color': accent,
        'underlay-opacity': 0.25,
        'underlay-padding': 6,
        'z-index': 30,
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
        // El rótulo (×N, o N·confianza si es inferido) va siempre: el número de
        // call-sites es información, no ruido. A medio ver al descansar; a pleno
        // al mirar/seleccionar la arista (clase hover / :selected / hl).
        label: 'data(label)',
        'font-size': 10.5,
        'font-weight': 500,
        color: muted,
        'text-opacity': 0.9,
        'text-background-color': surface,
        'text-background-opacity': 0.9,
        'text-background-padding': '3px',
        'text-rotation': 'autorotate',
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'edge.hover, edge:selected, edge.hl, edge.loud',
      style: { 'text-opacity': 1, color: fg, 'z-index': 12 },
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
        // Guion de la referencia: trazo 7-5 a opacidad 0.75 (la confianza va
        // en el rótulo, no en la opacidad).
        'line-dash-pattern': [7, 5],
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
      selector:
        'edge.code-edge:hover, edge.code-edge:selected, edge.code-edge.hl, edge.code-edge.loud',
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
    // "Proporciona": el conector del borde apunta a su implementación dentro de
    // la caja del repo (acento, flecha hacia dentro). Las de consumo (consumes)
    // van en color de procedencia y apuntan al conector del proveedor.
    {
      selector: 'edge.servedby',
      style: {
        'line-color': accent,
        'target-arrow-color': accent,
        'line-style': 'solid',
        width: 1.2,
        opacity: 0.5,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.6,
        label: '',
      },
    },
    {
      selector: 'edge.implements',
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
        'edge.servedby:hover, edge.servedby:selected, edge.servedby.hl, edge.servedby.loud, edge.implements:hover, edge.implements:selected',
      style: {
        label: 'data(label)',
        opacity: 1,
        width: 2,
      },
    },
    // Sin apagado global: todo el grafo se ve.Sólo el modo foco atenúa lo que
    // NO es vecindad — y nunca por debajo de legible: lo importante (lo que
    // tiene relaciones) se resalta con hl/loud, no se esconde.
    { selector: '.dim', style: { opacity: 0.38 } },
    // Relaciones secundarias de un grafo denso: presentes y legibles, en
    // segundo plano — nunca invisibles (una relación es información).
    { selector: 'edge.quiet', style: { opacity: 0.35, width: 1, 'text-opacity': 0.6 } },
    { selector: 'edge.hl, edge.loud', style: { opacity: 1, 'z-index': 10, label: 'data(label)' } },
  ];
}

/**
 * Aplica el reparto calculado en layout.ts (posiciones de las hojas; los
 * contenedores se ajustan solos a sus hijos). Encuadrar necesita un contenedor
 * con tamaño — pestaña oculta, primer render —: si no lo tiene se deja
 * `pending` y el ResizeObserver encuadra cuando haya sitio.
 */
function applyLayout(
  cy: Core,
  lay: MapLayout,
  first: boolean,
  preserve?: ReadonlySet<string>,
): 'done' | 'pending' {
  cy.batch(() => {
    for (const [id, p] of lay.leaves) {
      const n = cy.getElementById(id);
      const size = lay.sizes.get(id);
      if (n.empty()) continue;
      if (size) n.data({ w: size.w, h: size.h, tw: size.w - 12 });
      // Tras tocar el lienzo, los nodos existentes conservan su posición (un
      // re-reparto no debe "volver" lo que el usuario colocó a su sitio).
      if (preserve?.has(id)) continue;
      let pos = p;
      if (preserve) {
        // Nodo nuevo: se alinea con la posición REAL de su raíz (delta entre
        // el reparto nuevo y dónde quedó la raíz en pantalla).
        let root: NodeSingular = n;
        while (root.parent().nonempty()) root = root.parent()[0] as NodeSingular;
        const top = lay.top.get(root.id());
        if (top) {
          const cur = root.position();
          pos = { x: p.x + (cur.x - top.x), y: p.y + (cur.y - top.y) };
        }
      }
      n.position(pos);
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
    highlightIds = null,
    onSelect,
    onToggle,
    fitNonce = 0,
    traceContract = null,
    traceFanoutLimit = 3,
    onZoomLevel,
  },
  ref,
): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const lastSig = useRef('');
  const touched = useRef(false);
  // Los handlers de Cytoscape se registran una vez: leen siempre lo último.
  const handlers = useRef({ onSelect, onToggle, onZoomLevel });
  handlers.current = { onSelect, onToggle, onZoomLevel };

  // Zoom y encuadre desde los controles flotantes del lienzo. Paso amplio
  // (×1.6) para llegar rápido; los botones además repiten al mantener pulsado.
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const cy = cyRef.current;
        if (!cy) return;
        zoomAboutCenter(cy, Math.min(cy.zoom() * ZOOM_STEP, cy.maxZoom()));
      },
      zoomOut: () => {
        const cy = cyRef.current;
        if (!cy) return;
        zoomAboutCenter(cy, Math.max(cy.zoom() / ZOOM_STEP, cy.minZoom()));
      },
      zoomReset: () => {
        const cy = cyRef.current;
        if (!cy) return;
        zoomAboutCenter(cy, 1);
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
      wheelSensitivity: 0.12,
      boxSelectionEnabled: false,
    });
    // Un clic selecciona (nunca abre ni cierra: eso es del doble clic, para no
    // perder la selección al abrir). Doble clic sobre un nodo = open/close.
    cy.on('tap', 'node', (ev) => handlers.current.onSelect(String(ev.target.id())));
    cy.on('dbltap', 'node', (ev) => handlers.current.onToggle(String(ev.target.id())));
    cy.on('tap', (ev) => {
      if (ev.target === cy) handlers.current.onSelect(null);
    });
    // El nivel de zoom se comunica para mostrarlo en los controles (%).
    cy.on('zoom', () => handlers.current.onZoomLevel?.(cy.zoom()));
    handlers.current.onZoomLevel?.(cy.zoom());
    // Un "clic" que se mueve menos de 8px no es un arrastre: se restaura la
    // posición para que click nunca mueva el nodo.
    let dragStart: { x: number; y: number } | null = null;
    cy.on('dragstart', 'node', (ev) => {
      const p = (ev.target as NodeSingular).position();
      dragStart = { x: p.x, y: p.y };
    });
    cy.on('dragfree', 'node', (ev) => {
      const n = ev.target as NodeSingular;
      if (!dragStart) return;
      const p = n.position();
      if (Math.hypot(p.x - dragStart.x, p.y - dragStart.y) < 8) n.position(dragStart);
      dragStart = null;
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
    // Lo mismo para aristas: el rótulo (×N / N·confianza) pasa a pleno al mirar.
    cy.on('mouseover', 'edge', (ev) => ev.target.addClass('hover'));
    cy.on('mouseout', 'edge', (ev) => ev.target.removeClass('hover'));
    cyRef.current = cy;
    // Instancia nueva = lienzo vacío: el diff de datos tiene que volver a repartir
    // (StrictMode monta, desmonta y monta de nuevo conservando los refs).
    lastSig.current = '';
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
    const els = toCyElements(view, { selectedId, focusIds });
    const sig = signature(els);
    const wanted = new Set(els.map((e) => e.data.id));
    // Ids que ya están en el lienzo ANTES del diff: si el usuario ya tocó el
    // lienzo, sus posiciones se respetan (no se re-reparten y "vuelven").
    const existing = new Set(cy.elements().map((el) => el.id()));

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
        const input = layoutInput(view, { selectedId, focusIds });
        const lay = layoutMap(input.nodes, input.edges);
        // Tras tocar el lienzo sólo se conservan las posiciones de las CAJAS DE
        // PRIMER NIVEL (repos): los hijos se reempaquetan limpios dentro de su
        // contenedor, así nada queda "montado encima" de otra cosa al abrir/cerrar.
        const preserve = touched.current
          ? new Set([...existing].filter((id) => lay.top.has(id)))
          : undefined;
        const state = applyLayout(cy, lay, first, preserve);
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
  }, [view, selectedId, focusIds]);

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
        if (n.empty() && highlightIds && highlightIds.size > 0) {
          // Selección en un nodo sólo de cliente (clúster): se resaltan sus
          // miembros en el lienzo (los puertos del borde de la caja del repo).
          const eles = cy.nodes().filter((x) => highlightIds.has(x.id()));
          if (eles.nonempty()) {
            const edges = eles.connectedEdges();
            const keep = eles.union(eles.ancestors()).union(edges).union(edges.connectedNodes());
            cy.elements().not(keep).addClass('dim');
            keep.removeClass('dim');
            eles.addClass('connected-peer');
            edges.addClass('hl loud');
          }
        }
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
  }, [selectedId, focusIds, highlightIds, view, traceContract, traceFanoutLimit]);

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
    else if (highlightIds && highlightIds.size > 0) {
      const eles = cy.nodes().filter((x) => highlightIds.has(x.id()));
      if (eles.nonempty()) cy.animate({ center: { eles }, duration: 180 });
    }
  }, [selectedId, highlightIds]);

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
