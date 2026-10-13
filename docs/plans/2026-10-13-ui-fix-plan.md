# Parallax — UI Fix & Solid Plan

**Date:** 2026-10-13
**Problem:** UI shows white screen and errors. Root cause: React Router routing doesn't match the served URL path.
**Goal:** Working UI with chat, topology, and all routes functional.

---

## Root Cause Analysis

The web bundle is served at `/` (root), but the React Router routes are defined as `/orgs`, `/orgs/:orgId`, etc. When the browser loads `/`, React Router tries to match `/` against the route table. The `/` route redirects to `/orgs`, but the redirect happens client-side and the server needs to serve `index.html` for that path.

**Three issues:**
1. **SPA fallback** — the server must serve `index.html` for ALL non-API routes (including `/orgs`, `/orgs/:orgId`, etc.)
2. **Auth blocking** — the auth plugin protects `/orgs` (the API) but the SPA route `/orgs/:orgId` should be public
3. **Router basename** — if served at `/`, no basename needed; if at `/app/`, need `basename: '/app'`

---

## Fix Plan

### Phase 1: Server-side SPA routing (30 min)

**Goal:** All non-API URLs serve `index.html` so React Router can handle them.

| Task | File | Change |
|---|---|---|
| 1.1 | `src/plugins/auth.ts` | Use route-level `config: { public: true }` instead of URL patterns |
| 1.2 | `src/routes/app.ts` | Mark `/*` and `/assets/*` as `public: true` |
| 1.3 | `src/routes/health.ts` | Mark `/health` as `public: true` |
| 1.4 | `src/routes/app.ts` | SPA fallback: any non-API, non-asset URL → `index.html` |
| 1.5 | `src/routes/orgs.ts` | Mark `/orgs` as protected (scopes: ['read']) |
| 1.6 | Test | `GET /orgs/org_demo` → 200 (SPA fallback) |

### Phase 2: React Router setup (20 min)

**Goal:** Routes match the served URLs.

| Task | File | Change |
|---|---|---|
| 2.1 | `src/router.tsx` | Verify routes: `/`, `/orgs`, `/orgs/:orgId`, etc. |
| 2.2 | `src/main.tsx` | Wrap with `BrowserRouter` (no basename needed at `/`) |
| 2.3 | `src/routes/Orgs.tsx` | Fetch orgs from API, show loading/error states |
| 2.4 | `src/routes/Org.tsx` | Show TopologyView + ChatPanel |
| 2.5 | Test | Navigate to `/orgs` → heading "Organizations" |

### Phase 3: API integration (30 min)

**Goal:** UI connects to real API endpoints.

| Task | File | Change |
|---|---|---|
| 3.1 | `src/api/client.ts` | Add `baseUrl` config (default: same origin) |
| 3.2 | `src/api/hooks.ts` | `useOrgs` calls `GET /orgs` with auth |
| 3.3 | `src/api/hooks.ts` | `useQuery` calls `POST /api/query` |
| 3.4 | `src/routes/Org.tsx` | ChatPanel sends to `/api/query`, updates TopologyView |
| 3.5 | Test | Send chat message → response appears |

### Phase 4: TopologyView rendering (20 min)

**Goal:** Cytoscape graph renders with nodes and edges.

| Task | File | Change |
|---|---|---|
| 4.1 | `src/components/TopologyView.tsx` | Verify Cytoscape initializes in browser |
| 4.2 | `src/components/TopologyView.tsx` | Use `preset` layout with explicit positions |
| 4.3 | `src/components/TopologyView.tsx` | Add error boundary for canvas failures |
| 4.4 | Test | TopologyView renders nodes |

### Phase 5: ChatPanel UX (20 min)

**Goal:** Chat works end-to-end with API.

| Task | File | Change |
|---|---|---|
| 5.1 | `src/components/ChatPanel.tsx` | Input + send button + message list |
| 5.2 | `src/components/ChatPanel.tsx` | Loading state during API call |
| 5.3 | `src/components/ChatPanel.tsx` | Error state on API failure |
| 5.4 | `src/routes/Org.tsx` | Connect ChatPanel to `useQuery` hook |
| 5.5 | Test | Type message → response appears |

---

## File Structure (target)

```
packages/web/src/
├── main.tsx                    # React root + BrowserRouter
├── router.tsx                  # Route definitions
├── api/
│   ├── client.ts               # HTTP client with auth
│   └── hooks.ts                # TanStack Query hooks
├── components/
│   ├── AppShell.tsx            # Layout with sidebar
│   ├── TopologyView.tsx        # Cytoscape graph
│   ├── ChatPanel.tsx           # Conversational UI
│   ├── CoverageBadge.tsx       # Coverage indicator
│   ├── ServiceMap.tsx          # Service list (placeholder)
│   ├── EvidencePanel.tsx       # Evidence list (placeholder)
│   └── AssessmentView.tsx      # Assessment detail (placeholder)
└── routes/
    ├── Orgs.tsx                # Organization list
    ├── Org.tsx                 # Topology + Chat
    ├── Service.tsx             # Service detail
    ├── Assessments.tsx         # Assessment list
    ├── Assessment.tsx          # Assessment detail
    └── Proposal.tsx            # Proposal view
```

---

## Test Plan

| Test | Tool | Assert |
|---|---|---|
| `GET /` returns HTML | Vitest | `<!doctype html>` |
| `GET /assets/*.js` returns JS | Vitest | `text/javascript` |
| `GET /orgs/org_demo` returns HTML (SPA) | Vitest | `<!doctype html>` |
| Navigate to `/orgs` shows heading | Playwright | `h1` = "Organizations" |
| Navigate to `/orgs/org_demo` shows org | Playwright | `h1` = "org_demo" |
| TopologyView renders | Playwright | `canvas` exists |
| ChatPanel accepts input | Playwright | Input is editable |
| Send message → response appears | Playwright | Assistant bubble visible |
| CoverageBadge shows "sin datos" | Playwright | Badge text |

---

## Execution Order

1. **Phase 1** (server) — fix SPA routing + auth → verify with curl
2. **Phase 2** (router) — fix React Router → verify with Playwright
3. **Phase 3** (API) — connect UI to API → verify chat works
4. **Phase 4** (topology) — fix Cytoscape rendering → verify graph shows
5. **Phase 5** (chat) — polish UX → verify full flow

**Total estimated time:** ~2 hours
