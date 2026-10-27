// MapCanvas — el lienzo del mapa: Cytoscape con nodos compuestos (repo ⊃
// servicio ⊃ endpoint). Sólo dibuja lo que el servidor proyectó; no calcula
// jerarquía ni agrega aristas. Colores y trazos salen de los tokens de
// index.css (se releen al cambiar el tema), nada está cableado a "dark".

import type { MapViewResponse } from '@parallax/shared/org-map';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
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
}

const TOKEN = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export function buildStyle(): StylesheetJson {
  const fg = TOKEN('--color-fg', '#171717');
  const muted = TOKEN('--color-muted', '#737373');
  const surface = TOKEN('--color-surface', '#ffffff');
  const accent = TOKEN('--color-accent', '#2563eb');
  const repo = TOKEN('--color-repo', '#7c3aed');
  const service = TOKEN('--color-service', '#2563eb');
  const endpoint = TOKEN('--color-endpoint', '#d97706');
  const codeC = TOKEN('--color-code', '#64748b');
  const fileC = TOKEN('--color-file', '#65a30d');
  const symbolC = TOKEN('--color-symbol', '#c026d3');
  const det = TOKEN('--color-deterministic', '#0f766e');
  const inf = TOKEN('--color-inferred', '#e11d48');

  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-size': 11,
        color: fg,
        'text-wrap': 'ellipsis',
        'text-max-width': 'data(tw)' as unknown as string,
        'text-valign': 'center',
        'text-halign': 'center',
        'min-zoomed-font-size': 7,
        'overlay-opacity': 0,
        'border-width': 1.5,
      },
    },
    {
      selector: 'node.repo',
      style: {
        shape: 'round-rectangle',
        'background-color': repo,
        'background-opacity': 0.1,
        'border-color': repo,
        'font-weight': 600,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
      },
    },
    {
      selector: 'node.service',
      style: {
        shape: 'round-rectangle',
        'background-color': service,
        'background-opacity': 0.14,
        'border-color': service,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
      },
    },
    {
      selector: 'node.endpoint',
      style: {
        shape: 'round-rectangle',
        'background-color': surface,
        'border-color': endpoint,
        'border-width': 1.5,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 10,
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    // Grafo de código: la puerta ("Code"), archivos/módulos y símbolos.
    {
      selector: 'node.code',
      style: {
        shape: 'round-rectangle',
        'background-color': codeC,
        'background-opacity': 0.1,
        'border-color': codeC,
        'font-weight': 600,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
      },
    },
    {
      selector: 'node.file',
      style: {
        shape: 'round-rectangle',
        'background-color': fileC,
        'background-opacity': 0.12,
        'border-color': fileC,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 10,
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    {
      selector: 'node.symbol',
      style: {
        shape: 'round-rectangle',
        'background-color': surface,
        'border-color': symbolC,
        width: 'data(w)',
        height: 'data(h)',
        padding: '0px',
        'font-size': 10,
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    // Abiertos: contenedor, la etiqueta va arriba y el padding deja sitio a los hijos.
    {
      selector: ':parent',
      style: {
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        padding: '16px',
        'compound-sizing-wrt-labels': 'exclude',
        'background-opacity': 0.06,
        'border-style': 'solid',
      },
    },
    // Plegados con hijos: borde punteado = "hay más dentro" (doble clic).
    { selector: 'node.collapsible', style: { 'border-style': 'dashed' } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': accent } },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 'data(width)',
        opacity: 'data(opacity)' as unknown as number,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
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
    // Determinista = trazo continuo; inferido = trazo discontinuo y otro tono.
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
        'line-dash-pattern': [6, 4],
      },
    },
    { selector: '.dim', style: { opacity: 0.12 } },
    // Relaciones secundarias de un grafo denso: presentes, pero en segundo plano.
    { selector: 'edge.quiet', style: { opacity: 0.07, width: 1 } },
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

export function MapCanvas({
  view,
  selectedId,
  focusIds,
  onSelect,
  onToggle,
  fitNonce = 0,
}: MapCanvasProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const lastSig = useRef('');
  // Posiciones de primer nivel del reparto anterior: abrir un nodo no baraja el resto.
  const topRef = useRef<ReadonlyMap<string, Point>>(new Map());
  // Los handlers de Cytoscape se registran una vez: leen siempre lo último.
  const handlers = useRef({ onSelect, onToggle });
  handlers.current = { onSelect, onToggle };

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
    cyRef.current = cy;
    // Instancia nueva = lienzo vacío: el diff de datos tiene que volver a repartir
    // (StrictMode monta, desmonta y monta de nuevo conservando los refs).
    lastSig.current = '';
    topRef.current = new Map();
    // Gancho de inspección para las comprobaciones en navegador real (dev).
    if (import.meta.env.DEV) (window as unknown as { __parallaxCy?: Core }).__parallaxCy = cy;

    const ro = new ResizeObserver(() => {
      cy.resize();
      const pending = cy.scratch('pendingFit') as { first: boolean } | null | undefined;
      if (pending && cy.nodes().nonempty()) {
        cy.scratch('pendingFit', null);
        if (pending.first) cy.fit(undefined, 40);
        host.current?.setAttribute('data-layout', 'done');
      }
    });
    if (host.current) ro.observe(host.current);

    // El tema cambia con la clase de <html>: se releen los tokens.
    const mo = new MutationObserver(() => cy.style(buildStyle()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
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
          const target = fresh.nodes().union(fresh.nodes().ancestors());
          cy.animate({ fit: { eles: target, padding: 70 }, duration: 220 });
        }
      }
    }
  }, [view]);

  // Selección y foco: sólo clases, sin tocar la geometría. Depende de `view`
  // porque el diff de datos reemplaza las clases de los elementos existentes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` re-aplica las clases
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dim hl loud');
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
      if (selectedId) {
        const n = cy.getElementById(selectedId);
        if (n.nonempty()) {
          n.select();
          // Atenuar el resto sólo tiene sentido si el nodo tiene con qué
          // contrastar (relaciones): uno sin aristas — p. ej. un símbolo de
          // código — dejaría a sus hermanos ilegibles sin decir nada.
          if (n.connectedEdges().nonempty()) {
            const around = n.closedNeighborhood();
            cy.elements().not(around).not(n.ancestors()).addClass('dim');
            n.connectedEdges().addClass('hl');
            around.removeClass('dim');
          }
        }
      }
    });
  }, [selectedId, focusIds, view]);

  // Un foco nuevo (agente, "Focus neighborhood") encuadra su vecindad.
  const focusKey = focusIds ? [...focusIds].sort().join('|') : '';
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
        className="w-full h-full"
      />
    </div>
  );
}
