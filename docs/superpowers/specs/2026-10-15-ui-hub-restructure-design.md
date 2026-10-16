# UI Hub Restructure — Design Spec

**Date:** 2026-10-15
**Status:** aprobado en diseño conversacional (3 secciones) — pendiente revisión escrita
**Scope:** `packages/web` — estructura de rutas y layout. Sin rediseño visual.

## Problema

El demo del hackathon se siente como tres apps separadas (Workspaces → Orgs →
Assessments) en vez de un command center con contexto compartido. Evidencia en
el código de hoy:

- El sidebar (`AppShell.tsx`) enlaza a `/proposals` — **esa ruta no existe**.
- `routes/Proposal.tsx` está huérfano, sin enrutar.
- La topología del org está **duplicada y fragmentada**: `Org.tsx` pinta
  `TopologyView` con `SAMPLE_TOPOLOGY` y `WorkspaceDetail.tsx` pinta su propia
  copia del grafo de org junto a `HierarchyTree`/`CodeGraphTree`.
- La tabla de rutas es plana: config, topología y evaluación como hermanos sin
  jerarquía de contexto.

## Intención y criterio de éxito

**La topología del org es el hub del command center.** Workspaces, assessments e
informes son acciones y superficies contextuales sobre ese grafo. Éxito: desde
el hub, el siguiente paso del demo (configurar workspace → ver topología →
evaluar PR → leer informe) está a un clic con el contexto ya cargado, y la
navegación se siente como una sola aplicación.

**Enfoque elegido (C, híbrido):** grafo persistente con panel lateral para lo
liviano (detalle de servicio, evidencia, lanzar evaluación) y página completa
para lo pesado (reporte de assessment, config de workspace).

## Arquitectura de información y rutas

| Ruta | Qué es | Superficie |
|---|---|---|
| `/` | redirect → `/orgs` | — |
| `/orgs` | selector de orgs | página |
| `/orgs/:orgId` | **hub de topología** (grafo + chat + acciones de flujo) | página-contenedor |
| `/orgs/:orgId/services/:serviceId` | detalle de servicio + evidencia | **panel** sobre el hub |
| `/orgs/:orgId/assessments` | lista de evaluaciones | página |
| `/orgs/:orgId/assessments/:assessmentId` | reporte completo | página |
| `/workspaces`, `/workspaces/:id` | configuración (LAIN, repos) | página |

Decisiones:

1. **Compatibilidad de URLs**: los deep links actuales siguen funcionando. El
   redirect `/assessments/:id` → `/orgs/:orgId/assessments/:id` resuelve el
   `orgId` del propio registro del assessment (fetch → redirect, con estado de
   carga); el patrón `/orgs/:orgId/services/:serviceId` se conserva, solo
   cambia de superficie. Nada de lo que funciona hoy se rompe.
2. **Topología unificada**: `WorkspaceDetail` deja de pintar el `TopologyView`
   de org (conserva `HierarchyTree`/`CodeGraphTree` como detalle de repo). El
   grafo de org vive solo en el hub.
3. **Proposals**: se quita el enlace muerto del sidebar y se borra
   `Proposal.tsx` (huérfano). Llega de verdad en el subproyecto 6 con su diseño
   real; no se crea placeholder mentiroso.
4. `/orgs/:orgId` pasa a ser el hub de topología (hoy ya muestra topología+chat;
   el trabajo es ordenar el resto alrededor).

## Layout y componentes

**`AppShell` (existente, reajustado):** sidebar global con *org switcher*
(nombre del org + volver al selector cuando estás dentro de un org) y nav real
solo: **Topología · Evaluaciones · Workspaces**.

**`OrgLayout` (nuevo, el corazón):** ruta contenedora en `/orgs/:orgId`:

- renderiza siempre `TopologyView` + `ChatPanel`;
- franja de **acciones de flujo**: "Configurar workspace", "Evaluar PR", "Ver
  evaluaciones" — cada acción lleva el contexto cargado (org, nodo
  seleccionado);
- `<Outlet/>` para el **`ContextPanel`** (drawer derecho deslizante): al entrar
  a `/orgs/:orgId/services/:serviceId`, el detalle + `EvidencePanel` se pintan
  **sobre el grafo sin desmontarlo**; cerrar el panel navega de vuelta a la URL
  del hub.

Cambios en componentes existentes:

- `Org.tsx` se reorganiza en `OrgLayout` + contenido del hub (mismo material,
  mejor estructura).
- `Service.tsx` pasa de página suelta a contenido del `ContextPanel`.
- Lo pesado (reporte de assessment, config de workspace) sigue siendo página
  completa con barra de contexto (org/breadcrumb).

Estética: sin rediseño visual — mismo Tailwind/tema; solo cambia dónde vive cada
cosa.

## Flujo de datos y contexto

- Todo lo navegable vive en la URL (deep-linkable): org en el path, panel por
  sub-ruta, nodo seleccionado como query param (`?node=…`).
- TanStack Query (en uso) cachea; las acciones de flujo pasan contexto por URL
  (p. ej. "Evaluar PR" desde un servicio abre el formulario con el repo
  preseleccionado).
- **Frontera explícita**: `TopologyView` conserva su fuente de datos actual
  (`SAMPLE_TOPOLOGY`). El wiring real de topología es trabajo aparte.

## Estados de error y empty

- Org sin topología → empty state con CTA "Configurar workspace" (el demo
  arranca ahí).
- Panel con `serviceId` inválido → se cierra el panel con mensaje y vuelta al
  hub (nunca pantalla rota).
- Ruta desconocida → redirect al hub del org (o `/orgs` si no hay org).

## Testing

- **Unit**: tabla de rutas (redirects + compat de URLs viejas), `OrgLayout` con
  panel abierto/cerrado, `ContextPanel` (cerrar navega al hub).
- **Composición** (la garantía del flujo, equivalente al held-out del demo):
  test del flujo completo hub → clic nodo → panel de servicio → cerrar → acción
  "Evaluar PR" → formulario con contexto (testing-library + MemoryRouter). Es el
  test que impide volver a "tres apps separadas".
- Todo lo existente se mantiene verde: `pnpm test`, `pnpm test:heldout`,
  `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, smoke.

## Non-goals

- Rediseño visual (paleta, tipografía, estética del grafo).
- Wiring real de datos de topología (sigue `SAMPLE_TOPOLOGY`).
- Chat nuevo o mejoras al investigador.
- Proposals/publications reales (subproyecto 6).

## Restricciones técnicas

- React Router 6 (`react-router-dom ^6.30.6`), TanStack Query 5, Tailwind 4,
  Vitest 5 + testing-library — sin dependencias nuevas.
- Mismas restricciones globales del repo: TS 7 strict, Biome limpio, Node
  24.21.0, pnpm 12.11.2, commits `type(scope): subject` en inglés.
