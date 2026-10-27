# Org map (command center) — UI review and design

**Date:** 2026-10-27
**Status:** phases 1–3 implemented on `feat/command-center-graph`; open items at the end.
**Scope:** `packages/web`, `packages/api` (map routes), `packages/shared/org-map`.

## 1. Review of the UI as it was

| # | Finding | Evidence |
|---|---|---|
| 1 | **The org hub was fake.** `/orgs/:orgId` drew a hard-coded `SAMPLE_TOPOLOGY` and the chat was a `setTimeout` stub. The "Topología" nav item never touched LAIN. | `OrgLayout.tsx`, `Service.tsx` |
| 2 | **Two disjoint models, no join.** Contract topology (repo → service → endpoint, `binding`/`confidence`) and the code graph (repo → file → symbol) shared no ids. | `topology.ts`, `code-graph.ts` |
| 3 | **Collapsing destroyed information.** Hiding a node hid its edges instead of rolling them up. | `TopologyView.tsx` |
| 4 | **Provenance was not visible.** Static vs heuristic bindings (and confidence) were only a filter chip. | `WorkspaceDetail.tsx` |
| 5 | **Not scalable.** Every request re-paginated all contracts and made N `get_service` calls, with an O(n²) owner lookup inside the consumer loop. No cache, no staleness signal. | `topology.ts` |
| 6 | **Theming was not real.** Hex fallbacks in inline styles, hard-coded dot colours, the 3D graph pinned to `darkTheme` regardless of the toggle. | `AppShell`, `ChatPanel`, `TopologyView` |
| 7 | **Two graph libraries installed, one unused** (`cytoscape`), plus three.js via `reagraph`. | `package.json` |
| 8 | **Mixed ES/EN copy** and ad-hoc glyph icons. | everywhere |
| 9 | `/api/orgs` is a stub returning `[]`, so the org picker listed nothing. | `routes/orgs.ts` |

## 2. Target model

One node model, `repo ⊃ service ⊃ endpoint` expressed as **containment** (`parent`), plus **relations** as edges:

- `consumes` (service → endpoint) and `servedBy`.
- Every relation carries a **provenance**: `deterministic` (static binding / structural) or `inferred` (heuristic binding, with `confidence`). A mixed edge is `deterministic` but keeps its heuristic-use count — nothing is rounded up.
- Shared DTOs: `@parallax/shared/org-map`.

Visual language (same in canvas, outline, inspector, legend):

| Meaning | Encoding |
|---|---|
| deterministic relation | solid, teal |
| inferred relation | dashed, rose, opacity = confidence |
| aggregated relations | width ∝ log₂(count), label `×N (k~)` on hover/select |
| node kind | repo = violet, service = blue, endpoint = amber (theme tokens) |
| closed node with contents | dashed border, `▸ N` |

## 3. Architecture

**Server** (`packages/api`)

- `org-graph.ts` — pure functions: `toOrgGraph`, `filterOrgGraph`, `projectOrgGraph` (lift edges to the nearest visible ancestor and aggregate; per-parent child cap, most-connected first, remainder reported in `hiddenChildren`), `neighborhood`, `describeNode`, `searchOrgGraph`.
- `org-graph-cache.ts` — caches the **unfiltered** graph per workspace+view; stale-while-revalidate, shared in-flight rebuilds, a failed rebuild keeps the old graph and exposes `lastError` (a failure is never "zero relations").
- Routes: `POST /api/workspaces/:id/map/view` (expand set, filters, focus, pins, limits), `GET …/map/node`, `GET …/map/search`, `POST …/map/refresh`. `meta` carries `generatedAt`, `stale`, `refreshing`, `source`.
- `topology.ts` now records per-use static/heuristic counts and indexes endpoint owners.

**Client** (`packages/web/src/map`)

- `MapCanvas` — Cytoscape compound nodes. Layout is **ours** (`layout.ts`): children of an open container in an aligned grid, top-level boxes by a force model with overlap removal, deterministic, warm-started from previous positions so opening a node does not reshuffle the canvas. (Cytoscape's `cose` was tried first and collapsed/deformed on open containers.)
- Progressive disclosure: in dense graphs only each node's strongest relations are loud; the rest fade until selected or focused.
- `MapOutline` (tree, keyboard), `MapInspector` ("consumed by / depends on" with provenance), toolbar (search, provenance, min confidence, contract, freshness, refresh).
- State that should be shareable lives in the URL: `?tab=map&focus=<id>&hops=<n>&sel=<id>&prov=&contract=&minc=`.

**Agent navigation**

- `/api/query` returns `map_focus` built by `agent/map-focus.ts` from **engine-verified** relation claims only, restricted to nodes that exist in the map. Contradicted, unverifiable or unresolved claims never produce a focus.
- The hub's assistant shows engine verdicts and a "Show on map" button that sets `focus`/`sel`. The same URL works as a deep link from any other client.

## 4. Verification

- Unit: `org-graph.test.ts` (provenance, roll-up, caps, filters, detail, cache), `map-focus.test.ts` (built through the real `verifyClaims` against the engine mock), `layout.test.ts`, `elements.test.ts`, `nodeId.test.ts`.
- Component: `MapExplorer.test.tsx`, `MapOutline.test.tsx`, `OrgLayout.test.tsx`, `demo-flow.test.tsx` — network at the MSW edge, no internal mocks.
- Real browser (system Chrome, 14 repos / 48 services / ~900 endpoints, 1.6k relations): hierarchy opens lazily, provenance filter, agent focus, light/dark re-theme. This found two bugs jsdom could not: Cytoscape rewrites its container's `position`, and StrictMode remounts kept stale layout state.

## 5. Not done / open

1. **Code-graph join.** Endpoints should link to their handler (`providers[].path/line`) and expand into files/symbols lazily through `buildGraphChildren`. The model is ready (`meta.providers`); the join is not built. The Code graph tab remains separate.
2. **Direction of code-graph edges.** `connect … direction: both` does not say direction; when the join is built, query outgoing and incoming separately or draw undirected. Do not infer direction.
3. **MCP.** Expose `map_focus` / a `get_map_view` tool so an MCP client gets the same deep link.
4. **Real-data run.** The browser check used synthetic data through the real projection code. It has not been run against Saleor via a live LAIN.
5. **Cache persistence.** The cache is in-memory per process; a restart rebuilds on first request.
6. **Copy.** English applied to the surfaces rewritten here; the remaining pages still mix Spanish.
7. **`check-ui*.mjs` scripts** were not updated and Playwright's bundled browser is not installed in this environment (system Chrome was used).
