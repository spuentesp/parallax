# UI Hub Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `packages/web` routes and layout so the org topology is the command-center hub — contextual panels and flow actions live over a persistent graph — while old URLs keep working.

**Architecture:** A new `OrgLayout` route container owns the hub (persistent `TopologyView` + `ChatPanel` + flow-action bar + `<Outlet/>` panel slot). Nested route `services/:serviceId` renders inside a sliding `ContextPanel` without unmounting the graph; heavy content (assessment report, workspace config) stays full-page. A legacy redirect layer keeps `/assessments/:id` and `/assessments` working, the dead `/proposals` nav and orphan `Proposal.tsx` go away, and `WorkspaceDetail` stops duplicating the org topology.

**Tech Stack:** React 19.3.0, react-router-dom 6.30.6 (`createBrowserRouter`/`createMemoryRouter`, `RouteObject[]`), @tanstack/react-query 5.104.2, Tailwind 4, Vitest 5.0.4 + @testing-library/react 16.1.0. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-15-ui-hub-restructure-design.md`. **The plan argues from the spec; the executor reads both.**

## Global Constraints

- **No new dependencies.** React Router 6, TanStack Query 5, Tailwind 4, Vitest 5 + testing-library as already pinned in `packages/web/package.json`.
- **No visual redesign**: reuse the existing Tailwind utilities / CSS-variable theme (`var(--color-surface)`, `var(--color-accent)`…). Only structure moves.
- **URL compatibility is mandatory**: every route that works today keeps working (directly or via redirect). Old links inside the app are updated to the new shapes.
- **Non-goals** (spec): real topology data wiring (stays `SAMPLE_TOPOLOGY`), visual redesign, new chat features, real proposals/publications.
- **TypeScript 7 strict** with `tsconfig.base.json` flags (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, …). **Biome** clean on every touched file (`pnpm lint`, `pnpm format:check`). Tests: Vitest + testing-library, `MemoryRouter`/`createMemoryRouter` style as in `packages/web/src/routes/routes.test.tsx`; hooks mocked with `vi.mock('../api/hooks.js', …)`.
- **Commits**: small, focused, English, `type(scope): subject` (e.g. `feat(web): add OrgLayout hub container`).
- **Verification at every commit**: `pnpm typecheck && pnpm lint && pnpm test` green; `pnpm test:heldout` unchanged (api-side, must not be touched by this plan).

## Review Focus

The five failure modes the spec implies that no single task's tests fully exercise, most likely first. Each is pinned to the task that owns it.

1. **Legacy deep links rotting** — `/assessments/:id` must redirect to the org-scoped report even though the old URL carries no `orgId` (it is resolved from the fetched record, with loading and not-found states), and every internal link written for the old shape must land on the new one. → Task 2 (redirect component with loading/not-found) + Task 5 (internal links updated).
2. **The graph unmounting during panel navigation** — the whole point of the hub is that the topology never disappears; a naive `<Outlet/>` swap re-renders the tree and loses pan/collapse state. → Task 7 pins it: the composition test asserts the *same DOM element* (`toBe(topologyHeading)`) is present after panel open and after close.
3. **Garbage in the URL** (`?node=unknown`, `services/:serviceId` that is not in the topology) must degrade to "servicio no encontrado" + close, never a broken screen or crash. → Task 4 (invalid-id behavior driven by the topology's known nodes).
4. **Dead nav links returning** — the current sidebar links to `/proposals`, which has no route. The nav and the route table must stay in lockstep. → Task 3 test asserts every `NAV_ITEMS` target resolves to a real route (table ↔ nav consistency), and Task 2 deletes `Proposal.tsx`.
5. **Context not actually flowing** — "Evaluar PR" must open the assessment form with the selected service's repo preselected; a form that ignores `?repo=` recreates the "three separate apps" feeling. → Task 5 (preselection test) + Task 7 (composition test of the whole demo flow).

---

## File Structure

| File | Responsibility |
|---|---|
| Create `packages/web/src/routes/OrgLayout.tsx` | Hub container: persistent topology + chat + flow actions + panel `<Outlet/>` + empty state. Absorbs `Org.tsx`. |
| Create `packages/web/src/routes/LegacyAssessmentRedirect.tsx` | `/assessments/:id` → fetch record → redirect to `/orgs/:orgId/assessments/:id` (loading/not-found states). |
| Create `packages/web/src/components/ContextPanel.tsx` | Sliding right drawer for light details; close navigates back to the hub URL. |
| Create `packages/web/src/components/FlowActions.tsx` | Next-step action bar (Configurar workspace / Evaluar PR / Ver evaluaciones) carrying context via URL. |
| Create `packages/web/src/components/AssessmentForm.tsx` | Minimal PR-assessment form (repo, base, head) with `?repo=` preselection. |
| Create `packages/web/src/components/OrgSwitcher.tsx` | Sidebar block: current org name + link back to the org picker. |
| Modify `packages/web/src/router.tsx` | New route table exported as `routes: RouteObject[]`; redirects; catch-all. |
| Modify `packages/web/src/components/AppShell.tsx` | Real nav only (Topología / Evaluaciones / Workspaces), org-aware; renders `OrgSwitcher`. |
| Modify `packages/web/src/components/TopologyView.tsx` | Add optional `onSelect(nodeId, kind)` on node click (backward compatible). |
| Modify `packages/web/src/routes/Service.tsx` | Panel content (service + `EvidencePanel`), invalid-id degradation. |
| Modify `packages/web/src/routes/Assessments.tsx` | Org-scoped list + links + embedded `AssessmentForm`. |
| Modify `packages/web/src/routes/WorkspaceDetail.tsx` | Drop the duplicated org-level `TopologyView`. |
| Delete `packages/web/src/routes/Proposal.tsx` | Orphan, unrouted (arrives for real in subproject 6). |
| Tests | `OrgLayout.test.tsx`, `LegacyAssessmentRedirect` cases in `routes.test.tsx`, `ContextPanel.test.tsx`, `AppShell.test.tsx`, `AssessmentForm.test.tsx`, `demo-flow.heldout.test.ts` (composition) |

---

### Task 1: OrgLayout hub container (absorbs Org.tsx)

**Files:**
- Create: `packages/web/src/routes/OrgLayout.tsx`
- Delete: `packages/web/src/routes/Org.tsx`
- Test: `packages/web/src/routes/OrgLayout.test.tsx`
- Modify: `packages/web/src/routes/routes.test.tsx:15,36-43` (imports `Org` today — switch to `OrgLayout`)

**Interfaces:**
- Consumes: `TopologyView`, `TopologyViewData` (`packages/web/src/components/TopologyView.tsx:30,76` — props `{ data: TopologyViewData; height?: number }`), `ChatPanel` (`{ messages: ChatMessage[]; onSend: (text: string) => void; loading: boolean }`), `useParams`/`Outlet` from react-router-dom.
- Produces (for Tasks 2, 4, 5): `export function OrgLayout(): React.ReactElement` — renders the hub for `/orgs/:orgId` with an `<Outlet/>` slot; `export const SAMPLE_TOPOLOGY: TopologyViewData` (moved from `Org.tsx:7-22`, exported because Tasks 4–5 need the known-node list).

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/routes/OrgLayout.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgLayout, SAMPLE_TOPOLOGY } from './OrgLayout.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHub(initialEntry = '/orgs/acme') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orgs/:orgId" element={<OrgLayout />}>
          <Route path="probe" element={<p>panel-slot</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrgLayout hub', () => {
  it('shows the org heading, topology and chat on one screen', () => {
    renderHub();
    expect(screen.getByRole('heading', { name: /acme/i })).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBeTruthy();
    expect(SAMPLE_TOPOLOGY.nodes.length).toBeGreaterThan(0);
  });

  it('renders nested routes in the panel slot', () => {
    renderHub('/orgs/acme/probe');
    expect(screen.getByText('panel-slot')).toBeTruthy();
  });

  it('shows the empty-state CTA when the topology has no data', () => {
    render(
      <MemoryRouter initialEntries={['/orgs/acme']}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgLayout emptyTopology />}>
            <Route path="probe" element={<p>panel-slot</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /configurar workspace/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @parallax/web run test -- src/routes/OrgLayout.test.tsx`
Expected: FAIL with `Cannot find module './OrgLayout.js'`.

- [ ] **Step 3: Create OrgLayout (move Org content) and delete Org.tsx**

Create `packages/web/src/routes/OrgLayout.tsx` (content moved from `Org.tsx:1-88`, plus the empty state and the slot):

```tsx
import type * as React from 'react';
import { useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { type ChatMessage, ChatPanel } from '../components/ChatPanel.js';
import { TopologyView, type TopologyViewData } from '../components/TopologyView.js';

export const SAMPLE_TOPOLOGY: TopologyViewData = {
  nodes: [
    { id: 'orders', label: 'orders', kind: 'service', parent: null },
    { id: 'billing', label: 'billing', kind: 'service', parent: null },
    { id: 'reports', label: 'reports', kind: 'service', parent: null },
    { id: 'platform', label: 'platform', kind: 'service', parent: null },
  ],
  edges: [
    { source: 'billing', target: 'orders', label: 'customer_id', kind: 'consumes' },
    { source: 'reports', target: 'orders', label: 'created_at', kind: 'consumes' },
    { source: 'platform', target: 'billing', label: 'invoice_id', kind: 'consumes' },
  ],
};

export function OrgLayout({
  emptyTopology = false,
}: {
  emptyTopology?: boolean;
}): React.ReactElement {
  const { orgId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const topology: TopologyViewData = emptyTopology ? { nodes: [], edges: [] } : SAMPLE_TOPOLOGY;

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    // Subproject 5: call the QueryAgent API
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Analyzing "${text}"… Found ${topology.nodes.length} services. orders is the central service with billing and reports as consumers.`,
        },
      ]);
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
          Organization
        </div>
        <h1 className="text-2xl font-bold">{orgId}</h1>
      </div>

      {topology.nodes.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border">
          <div className="text-3xl mb-2">⬡</div>
          <div className="text-sm text-muted mb-4">
            No topology yet. Configure a workspace to see its services here.
          </div>
          <Link to="/workspaces" className="text-accent">
            Configurar workspace →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div
              className="rounded-xl p-4"
              style={{
                background: 'var(--color-surface, #171717)',
                border: '1px solid var(--color-border, #262626)',
                overflow: 'hidden',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">Service Topology</div>
                <div
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: 'var(--color-bg, #0a0a0a)',
                    color: 'var(--color-muted, #a3a3a3)',
                  }}
                >
                  {topology.nodes.length} services · {topology.edges.length} relations
                </div>
              </div>
              <TopologyView data={topology} />
            </div>
          </div>
          <div className="h-[600px]">
            <ChatPanel messages={messages} onSend={handleSend} loading={loading} />
          </div>
        </div>
      )}

      {/* Panel slot: Tasks 4+ wrap this in ContextPanel. */}
      <Outlet />
    </div>
  );
}
```

Delete `packages/web/src/routes/Org.tsx` and update `routes.test.tsx` to import `OrgLayout` instead of `Org` (the "Org shows the org id in heading" case renders `<OrgLayout />` under path `/orgs/:orgId` — the assertions stay valid).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (new file green; `routes.test.tsx` green after the import swap).

- [ ] **Step 5: Verify typecheck/lint, then commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/routes/OrgLayout.tsx packages/web/src/routes/OrgLayout.test.tsx packages/web/src/routes/routes.test.tsx
git rm packages/web/src/routes/Org.tsx
git commit -m "feat(web): add OrgLayout hub container"
```

---

### Task 2: Route table + legacy redirects + catch-all + delete Proposal

**Files:**
- Modify: `packages/web/src/router.tsx` (full rewrite of the table; export `routes`)
- Create: `packages/web/src/routes/LegacyAssessmentRedirect.tsx`
- Delete: `packages/web/src/routes/Proposal.tsx`
- Test: `packages/web/src/routes/router.test.tsx` (new)

**Interfaces:**
- Consumes: `OrgLayout` (Task 1), `Assessment`, `Assessments`, `Orgs`, `Service`, `Workspaces`, `WorkspaceDetail` (existing route components), `useAssessment(id: string | null): { data: { assessment: { orgId: string; id: string } } | null; isPending: boolean; isError: boolean }` (`packages/web/src/api/hooks.ts:32`).
- Produces (for Tasks 3, 7): `export const routes: RouteObject[]` — the single source of truth for the table (tests mount it with `createMemoryRouter(routes)`); `export function LegacyAssessmentRedirect(): React.ReactElement`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/routes/router.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const useAssessmentMock = vi.fn<() => unknown>(() => ({
  data: null,
  isPending: true,
  isError: false,
}));
vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: () => useAssessmentMock(),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return render(<RouterProvider router={router} />);
}

describe('route table', () => {
  it('sends / to the org picker', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('sends unknown routes to the org picker', () => {
    renderAt('/nope/nothing');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('keeps /assessments working via redirect to the org picker', () => {
    renderAt('/assessments');
    expect(screen.getByRole('heading', { name: /organizations/i })).toBeTruthy();
  });

  it('redirects /assessments/:id to the org-scoped report once the record loads', async () => {
    useAssessmentMock.mockReturnValueOnce({
      data: { assessment: { id: 'a_1', orgId: 'acme' } },
      isPending: false,
      isError: false,
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/assessments/a_1'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/acme/i)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/orgs/acme/assessments/a_1');
  });

  it('shows not-found for a legacy id that does not resolve', async () => {
    useAssessmentMock.mockReturnValueOnce({
      data: null,
      isPending: false,
      isError: true,
    });
    renderAt('/assessments/a_gone');
    expect(await screen.findByText(/assessment not found/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/web run test -- src/routes/router.test.tsx`
Expected: FAIL — `routes` is not exported from `../router.js` (and `createMemoryRouter` mounting has nothing to mount).

- [ ] **Step 3: Rewrite the router and add the legacy redirect**

Rewrite `packages/web/src/router.tsx`:

```tsx
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { LegacyAssessmentRedirect } from './routes/LegacyAssessmentRedirect.js';
import { OrgLayout } from './routes/OrgLayout.js';
import { Orgs } from './routes/Orgs.js';
import { Service } from './routes/Service.js';
import { WorkspaceDetail } from './routes/WorkspaceDetail.js';
import { Workspaces } from './routes/Workspaces.js';

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/orgs" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'workspaces/:id', element: <WorkspaceDetail /> },
      { path: 'orgs', element: <Orgs /> },
      {
        path: 'orgs/:orgId',
        element: <OrgLayout />,
        children: [{ path: 'services/:serviceId', element: <Service /> }],
      },
      { path: 'orgs/:orgId/assessments', element: <Assessments /> },
      { path: 'orgs/:orgId/assessments/:assessmentId', element: <Assessment /> },
      // Compatibilidad: los deep links viejos siguen vivos.
      { path: 'assessments', element: <Navigate to="/orgs" replace /> },
      { path: 'assessments/:assessmentId', element: <LegacyAssessmentRedirect /> },
      { path: '*', element: <Navigate to="/orgs" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
```

Create `packages/web/src/routes/LegacyAssessmentRedirect.tsx`:

```tsx
import type * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAssessment } from '../api/hooks.js';

// Compatibilidad: /assessments/:id no trae orgId — se resuelve del registro.
export function LegacyAssessmentRedirect(): React.ReactElement {
  const { assessmentId } = useParams();
  const { data, isPending, isError } = useAssessment(assessmentId ?? null);

  if (isPending) {
    return <p className="p-6 text-sm text-muted">Loading…</p>;
  }
  if (isError || !data?.assessment) {
    return <p className="p-6 text-sm text-error">Assessment not found</p>;
  }
  return (
    <Navigate to={`/orgs/${data.assessment.orgId}/assessments/${data.assessment.id}`} replace />
  );
}
```

Delete `packages/web/src/routes/Proposal.tsx` (orphan: nothing routes to it; it returns for real in subproject 6).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (router.test.tsx green; the old `routes.test.tsx` cases still pass — `/assessments/:id` renders `LegacyAssessmentRedirect`, whose not-found state keeps the "assessment not found" assertion valid; if that case mounts `Assessment` directly it is unaffected).

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/router.tsx packages/web/src/routes/LegacyAssessmentRedirect.tsx packages/web/src/routes/router.test.tsx
git rm packages/web/src/routes/Proposal.tsx
git commit -m "feat(web): restructure route table with legacy redirects"
```

---

### Task 3: AppShell — real nav + OrgSwitcher (nav ↔ table lockstep)

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx:4-10,20-60` (NAV_ITEMS + sidebar header)
- Create: `packages/web/src/components/OrgSwitcher.tsx`
- Test: `packages/web/src/components/AppShell.test.tsx` (new)

**Interfaces:**
- Consumes: `useOrgs(): { data: { orgs: unknown[] } | null; isPending: boolean; isError: boolean }` (`packages/web/src/api/hooks.ts:15`), `routes: RouteObject[]` (Task 2 — for the nav↔table consistency assertion).
- Produces (for Task 7): `export function OrgSwitcher(): React.ReactElement` — shows the current org and links back to `/orgs`; `export const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; icon: string }>` — base targets, made org-aware by the `targetFor` helper inside `AppShell` (consumed by the consistency test).

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/AppShell.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';
import { NAV_ITEMS } from './AppShell.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({
    data: { orgs: [{ id: 'acme', name: 'Acme Corp' }] },
    isPending: false,
    isError: false,
  }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return render(<RouterProvider router={router} />);
}

describe('AppShell navigation', () => {
  it('has no dead links: every nav target resolves to a real route', () => {
    for (const item of NAV_ITEMS) {
      const router = createMemoryRouter(routes, { initialEntries: [item.to] });
      render(<RouterProvider router={router} />);
      // Si el destino no existiera, el catch-all redirigiría a /orgs.
      expect(router.state.location.pathname).toBe(item.to);
      cleanup();
    }
    renderAt('/orgs');
    expect(screen.queryByRole('link', { name: /proposals/i })).toBeNull();
  });

  it('shows the org switcher inside an org and links back to the picker', () => {
    renderAt('/orgs/acme');
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByRole('link', { name: /todas las organizaciones/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/web run test -- src/components/AppShell.test.tsx`
Expected: FAIL — `NAV_ITEMS` is not exported with that shape, and the sidebar still shows "Proposals".

- [ ] **Step 3: Implement OrgSwitcher and rework the sidebar**

Create `packages/web/src/components/OrgSwitcher.tsx`:

```tsx
import type * as React from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useOrgs } from '../api/hooks.js';

type OrgSummary = { id: string; name?: string };

export function OrgSwitcher(): React.ReactElement | null {
  const match = useMatch('/orgs/:orgId/*') ?? useMatch('/orgs/:orgId');
  const orgId = match?.params.orgId;
  const { data } = useOrgs();
  const orgs = (data?.orgs ?? []) as OrgSummary[];
  const current = orgs.find((o) => o.id === orgId);
  if (!orgId) return null;

  return (
    <div className="px-3 py-2 mb-2 rounded-lg" style={{ background: 'var(--color-bg, #0a0a0a)' }}>
      <div className="text-xs text-muted">Organization</div>
      <div className="text-sm font-medium truncate">{current?.name ?? orgId}</div>
      <Link to="/orgs" className="text-xs text-accent" aria-label="Todas las organizaciones">
        Todas las organizaciones →
      </Link>
    </div>
  );
}
```

In `packages/web/src/components/AppShell.tsx`, replace `NAV_ITEMS` and the sidebar header block (`AppShell.tsx:4-10` and `:20-33`) with org-aware targets and the switcher:

```tsx
import type * as React from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { OrgSwitcher } from './OrgSwitcher.js';
import { ThemeToggle } from './Theme.js';

export const NAV_ITEMS = [
  { to: '/orgs', label: 'Topología', icon: '⬡' },
  { to: '/assessments', label: 'Evaluaciones', icon: '◉' },
  { to: '/workspaces', label: 'Workspaces', icon: '◈' },
] as const;
```

(inside `AppShell`, before the `{NAV_ITEMS.map(...)}` block:)

```tsx
        <OrgSwitcher />
```

and compute each link's target with the current org so the hub keeps its context:

```tsx
export function AppShell(): React.ReactElement {
  const location = useLocation();
  const { orgId } = useParams();
  const targetFor = (base: string): string => {
    if (base === '/assessments' && orgId) return `/orgs/${orgId}/assessments`;
    return base;
  };
  // …existing sidebar JSX, with `to={targetFor(item.to)}` and
  // active detection via `location.pathname.startsWith(item.to) || (orgId != null && item.to === '/orgs' && location.pathname.startsWith(`/orgs/${orgId}`))`
```

Note for the implementer: `useParams()` in `AppShell` sees `orgId` because `AppShell` is the parent route element of `orgs/:orgId` (React Router 6 merges parent params). Topología links to `/orgs` for non-org screens and to `/orgs/:orgId` when an org is active — implement `targetFor` accordingly (`if (base === '/orgs' && orgId) return `/orgs/${orgId}`;`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (AppShell tests green; existing route/component tests unchanged).

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/components/AppShell.tsx packages/web/src/components/OrgSwitcher.tsx packages/web/src/components/AppShell.test.tsx
git commit -m "feat(web): org-aware navigation and org switcher"
```

---

### Task 4: TopologyView onSelect + ContextPanel + Service as panel

**Files:**
- Modify: `packages/web/src/components/TopologyView.tsx:76-80,140-148` (add `onSelect` prop)
- Create: `packages/web/src/components/ContextPanel.tsx`
- Modify: `packages/web/src/routes/OrgLayout.tsx` (wrap `<Outlet/>` in `ContextPanel`)
- Modify: `packages/web/src/routes/Service.tsx` (panel content + invalid-id degradation)
- Test: `packages/web/src/components/ContextPanel.test.tsx`, `packages/web/src/routes/OrgLayout.test.tsx` (additions)

**Interfaces:**
- Consumes: `SAMPLE_TOPOLOGY` (Task 1) for the known-node list; `EvidencePanel` (`packages/web/src/components/EvidencePanel.tsx`).
- Produces (for Tasks 5, 7): `TopologyViewProps.onSelect?: (nodeId: string, kind: 'repo' | 'service' | 'endpoint') => void` — called on node click **in addition to** the existing collapse toggle, only when provided; `export function ContextPanel(props: { title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement`; `export function Service(): React.ReactElement` — renders `serviceId` details or "Servicio no encontrado" + close.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/src/routes/OrgLayout.test.tsx` and create `packages/web/src/components/ContextPanel.test.tsx`:

```tsx
// OrgLayout.test.tsx — additions
import { fireEvent } from '@testing-library/react';

  it('keeps the graph mounted while the panel slot is active', () => {
    renderHub('/orgs/acme/probe');
    const graph = screen.getByText(/service topology/i).closest('div')?.parentElement;
    expect(graph).toBeTruthy();
    // El hub completo (grafo + chat) sigue presente con el panel abierto.
    expect(screen.getByText('panel-slot')).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBeTruthy();
    expect(screen.getByText('panel-slot')).toBeTruthy();
  });

  it('rejects unknown service ids with a recoverable message', () => {
    renderHub('/orgs/acme/services/does-not-exist');
    expect(screen.getByText(/servicio no encontrado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeTruthy();
  });
```

```tsx
// packages/web/src/components/ContextPanel.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './ContextPanel.js';

afterEach(() => cleanup());

describe('ContextPanel', () => {
  it('renders title and children, and calls onClose', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ContextPanel title="Service orders" onClose={onClose}>
          <p>panel-body</p>
        </ContextPanel>
      </MemoryRouter>,
    );
    expect(screen.getByText('Service orders')).toBeTruthy();
    expect(screen.getByText('panel-body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/web run test -- src/components/ContextPanel.test.tsx src/routes/OrgLayout.test.tsx`
Expected: FAIL — `ContextPanel` module missing; unknown-service case renders the bare service heading instead of the recoverable message.

- [ ] **Step 3: Implement onSelect, ContextPanel, and the panel wiring**

In `packages/web/src/components/TopologyView.tsx`, extend the props and the `GraphCanvas` click handler (`TopologyView.tsx:140-148`):

```tsx
export function TopologyView({
  data,
  height = 560,
  onSelect,
}: {
  data: TopologyViewData;
  height?: number;
  onSelect?: (nodeId: string, kind: 'repo' | 'service' | 'endpoint') => void;
}): React.ReactElement {
  // …existing code…
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          labelType="all"
          theme={darkTheme}
          layoutType={layout}
          onNodeClick={(n) => {
            toggle(String(n.id));
            if (onSelect) {
              const source = data.nodes.find((d) => d.id === String(n.id));
              if (source) onSelect(source.id, source.kind);
            }
          }}
        />
```

Create `packages/web/src/components/ContextPanel.tsx`:

```tsx
import type * as React from 'react';

export function ContextPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <aside
      className="mt-6 rounded-xl p-4"
      style={{
        background: 'var(--color-surface, #171717)',
        border: '1px solid var(--color-border, #262626)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">{title}</div>
        <button type="button" onClick={onClose} className="text-xs text-accent">
          Cerrar ✕
        </button>
      </div>
      {children}
    </aside>
  );
}
```

In `packages/web/src/routes/OrgLayout.tsx`, replace the bare `<Outlet />` (Task 1 version) with the panel slot, and wire node selection into the URL so the flow actions can carry it (this closes the click → `?node=` → `?repo=` chain):

```tsx
import { ContextPanel } from '../components/ContextPanel.js';
// …imports gain `useNavigate`…

  const navigate = useNavigate();
  const { serviceId } = useParams();
  const [searchParams] = useSearchParams();
  const nodeId = searchParams.get('node');
  const selectedNode = nodeId != null ? SAMPLE_TOPOLOGY.nodes.find((n) => n.id === nodeId) : undefined;
  // …in the topology card, replacing <TopologyView data={topology} />:
              <TopologyView
                data={topology}
                onSelect={(id) => navigate(`/orgs/${orgId ?? ''}?node=${encodeURIComponent(id)}`)}
              />
  // …inside the return, replacing `<Outlet />`:
      {serviceId !== undefined && (
        <ContextPanel
          title={`Service ${serviceId}`}
          onClose={() => navigate(`/orgs/${orgId ?? ''}`)}
        >
          <Outlet />
        </ContextPanel>
      )}
```

Rewrite `packages/web/src/routes/Service.tsx` (invalid-id degradation against the known nodes):

```tsx
import type * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { SAMPLE_TOPOLOGY } from './OrgLayout.js';

export function Service(): React.ReactElement {
  const { serviceId, orgId } = useParams();
  const navigate = useNavigate();
  const known = SAMPLE_TOPOLOGY.nodes.some((n) => n.id === serviceId);

  if (!known) {
    return (
      <section>
        <h2>Servicio no encontrado</h2>
        <p className="text-sm text-muted">No existe «{serviceId}» en esta topología.</p>
        <button
          type="button"
          onClick={() => navigate(`/orgs/${orgId ?? ''}`)}
          className="text-accent"
        >
          Cerrar
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Service {serviceId}</h2>
      <EvidencePanel />
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (ContextPanel green; OrgLayout panel-slot and invalid-id cases green; everything else unchanged).

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/components/TopologyView.tsx packages/web/src/components/ContextPanel.tsx packages/web/src/components/ContextPanel.test.tsx packages/web/src/routes/OrgLayout.tsx packages/web/src/routes/Service.tsx packages/web/src/routes/OrgLayout.test.tsx
git commit -m "feat(web): contextual panel over the persistent topology"
```

---

### Task 5: FlowActions + AssessmentForm + org-scoped Assessments

**Files:**
- Create: `packages/web/src/components/FlowActions.tsx`
- Create: `packages/web/src/components/AssessmentForm.tsx`
- Modify: `packages/web/src/routes/OrgLayout.tsx` (insert `<FlowActions …/>` above the graph)
- Modify: `packages/web/src/routes/Assessments.tsx` (org-scoped links + embed the form)
- Test: `packages/web/src/components/AssessmentForm.test.tsx`, additions to `OrgLayout.test.tsx`

**Interfaces:**
- Consumes: `useCreateAssessment(): { mutate: (body: AssessmentRequest) => void }` (`packages/web/src/api/hooks.ts:44`), `useSearchParams` from react-router-dom, `SAMPLE_TOPOLOGY` (Task 1).
- Produces (for Task 7): `export function FlowActions(props: { orgId: string; selectedNode?: { id: string; kind: string } | undefined }): React.ReactElement` — three links; "Evaluar PR" carries `?repo=<selectedNode.id ?? ''>`; `export function AssessmentForm(props: { orgId: string; preselectedRepo?: string | undefined }): React.ReactElement` — controlled inputs repo/base/head + submit via `useCreateAssessment`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/components/AssessmentForm.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssessmentForm } from './AssessmentForm.js';

const mutateMock = vi.fn();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
vi.mock('../api/hooks.js', () => ({
  useCreateAssessment: () => ({ mutate: mutateMock }),
}));

describe('AssessmentForm', () => {
  it('preselects the repo from props and submits with the typed SHAs', () => {
    render(
      <MemoryRouter>
        <AssessmentForm orgId="acme" preselectedRepo="orders" />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText(/repo/i) as HTMLInputElement).value).toBe('orders');
    fireEvent.change(screen.getByLabelText(/base/i), {
      target: { value: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' },
    });
    fireEvent.change(screen.getByLabelText(/head/i), {
      target: { value: 'afece2321df86647a31d073a2e3cadb50e13d42e' },
    });
    fireEvent.click(screen.getByRole('button', { name: /evaluar/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      repo: 'orders',
      base: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
      head: 'afece2321df86647a31d073a2e3cadb50e13d42e',
      orgId: 'acme',
    });
  });
});
```

Append to `OrgLayout.test.tsx`:

```tsx
  it('flow actions carry the selected node context into the evaluation form', () => {
    renderHub('/orgs/acme?node=orders');
    const evaluar = screen.getByRole('link', { name: /evaluar pr/i });
    expect(evaluar.getAttribute('href')).toBe('/orgs/acme/assessments?repo=orders');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/web run test -- src/components/AssessmentForm.test.tsx`
Expected: FAIL — `AssessmentForm` module missing; the OrgLayout case fails because no Evaluar-PR link exists.

- [ ] **Step 3: Implement FlowActions, AssessmentForm, and wire them**

Create `packages/web/src/components/FlowActions.tsx`:

```tsx
import type * as React from 'react';
import { Link } from 'react-router-dom';

export function FlowActions({
  orgId,
  selectedNode,
}: {
  orgId: string;
  selectedNode?: { id: string; kind: string };
}): React.ReactElement {
  const repo = selectedNode?.kind === 'service' ? selectedNode.id : '';
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      <Link to="/workspaces" className="text-xs px-3 py-1.5 rounded-lg bg-surface border border-border">
        Configurar workspace
      </Link>
      <Link
        to={`/orgs/${orgId}/assessments?repo=${encodeURIComponent(repo)}`}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-fg"
      >
        Evaluar PR
      </Link>
      <Link
        to={`/orgs/${orgId}/assessments`}
        className="text-xs px-3 py-1.5 rounded-lg bg-surface border border-border"
      >
        Ver evaluaciones
      </Link>
    </div>
  );
}
```

Create `packages/web/src/components/AssessmentForm.tsx`:

```tsx
import type * as React from 'react';
import { useState } from 'react';
import { useCreateAssessment } from '../api/hooks.js';

export function AssessmentForm({
  orgId,
  preselectedRepo,
}: {
  orgId: string;
  preselectedRepo?: string;
}): React.ReactElement {
  const { mutate } = useCreateAssessment();
  const [repo, setRepo] = useState(preselectedRepo ?? '');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');

  return (
    <form
      className="rounded-xl p-4 bg-surface border border-border space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutate({ repo, base, head, orgId });
      }}
    >
      <div className="text-sm font-semibold">Nueva evaluación de PR</div>
      <label className="block text-xs text-muted">
        Repo
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="block text-xs text-muted">
        Base SHA
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="block text-xs text-muted">
        Head SHA
        <input
          value={head}
          onChange={(e) => setHead(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-sm"
        />
      </label>
      <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-fg">
        Evaluar
      </button>
    </form>
  );
}
```

In `OrgLayout.tsx`, render the flow bar above the topology grid. `selectedNode` is already derived from `?node=` in Task 4 — just pass it through:

```tsx
import { FlowActions } from '../components/FlowActions.js';
// …inside the return, above the topology grid:
      <FlowActions orgId={orgId ?? ''} selectedNode={selectedNode} />
```

In `Assessments.tsx`, scope the page to the org and embed the form (links change from `to={`/assessments/${a.id}`}` at `Assessments.tsx:47` to the org-scoped path). Both full pages (`Assessments` and `Assessment`) also gain the spec's context bar — a breadcrumb back to the hub:

```tsx
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AssessmentForm } from '../components/AssessmentForm.js';
// …
export function Assessments(): React.ReactElement {
  const { orgId } = useParams();
  const [searchParams] = useSearchParams();
  const preselectedRepo = searchParams.get('repo') ?? undefined;
  // …existing list code, with the context bar first:
  //   <Link to={`/orgs/${orgId ?? ''}`} className="text-xs text-accent">← Volver al hub de {orgId}</Link>
  //   <AssessmentForm orgId={orgId ?? ''} preselectedRepo={preselectedRepo} /> above the list
  //   and row links:  to={`/orgs/${orgId ?? ''}/assessments/${a.id}`}
```

In `packages/web/src/routes/Assessment.tsx`, add the same breadcrumb at the top of the report page (`<Link to={`/orgs/${orgId ?? ''}`}>← Volver al hub de {orgId}</Link>`, with `orgId` from `useParams()` — the route is org-scoped now).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (AssessmentForm green; OrgLayout flow-action case green; existing tests unchanged).

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/components/FlowActions.tsx packages/web/src/components/AssessmentForm.tsx packages/web/src/components/AssessmentForm.test.tsx packages/web/src/routes/OrgLayout.tsx packages/web/src/routes/Assessments.tsx packages/web/src/routes/OrgLayout.test.tsx
git commit -m "feat(web): flow actions carry context into the assessment form"
```

---

### Task 6: WorkspaceDetail drops the second graph canvas

**Files:**
- Modify: `packages/web/src/routes/WorkspaceDetail.tsx:17,103-134` (drop `TopologyView`/`TopologyLegend` from the "Contract topology" section)
- Test: `packages/web/src/routes/WorkspaceDetail.test.tsx` (new)

**Interfaces:**
- Consumes: `HierarchyTree` (stays — same data in tree form), `CodeGraphTree` (stays).
- Produces: nothing (cleanup task).

**Spec note (reality check):** this block is fed by *workspace* LAIN data (`topo?.topology`), not literally `SAMPLE_TOPOLOGY`. The approved spec decision stands — one graph canvas in the app, owned by the hub; `HierarchyTree` keeps the same data visible on this screen.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/routes/WorkspaceDetail.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDetail } from './WorkspaceDetail.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({ data: { orgs: [] }, isPending: false, isError: false }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: () => {} }),
  useWorkspace: () => ({
    data: { workspace: { id: 'ws1', name: 'Demo', lainUrl: null, repos: [] } },
    isPending: false,
    isError: false,
  }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

describe('WorkspaceDetail', () => {
  it('shows the repo trees but not a second topology canvas', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/ws1']}>
        <Routes>
          <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/contract topology/i)).toBeTruthy();
    expect(screen.queryByText(/service topology/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @parallax/web run test -- src/routes/WorkspaceDetail.test.tsx`
Expected: FAIL — the "Contract topology" section still renders a `TopologyView` canvas.

- [ ] **Step 3: Remove the graph canvas from WorkspaceDetail**

In `packages/web/src/routes/WorkspaceDetail.tsx`, replace the grid at lines 120-134 so only the tree side remains (and drop the now-unused `TopologyView`/`TopologyLegend` imports at line 17):

```tsx
            <div className="mt-2">
              <HierarchyTree nodes={topo?.topology?.nodes ?? []} edges={topo?.topology?.edges ?? []} />
            </div>
            {topo?.error && <p className="text-xs text-warning mt-2">LAIN error: {topo.error}</p>}
```

(Remove the `<div className="mt-2"><TopologyLegend /></div>` block and the loading canvas that wrapped `TopologyView`; keep `FilterBar`, `HierarchyTree`, `CodeGraphTree` and the stats row untouched.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (new case green; `TopologyView.test.tsx` untouched and still green).

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/web/src/routes/WorkspaceDetail.tsx packages/web/src/routes/WorkspaceDetail.test.tsx
git commit -m "refactor(web): single topology canvas, owned by the org hub"
```

---

### Task 7: Composition test — the demo flow end to end

**Files:**
- Test: `packages/web/src/routes/demo-flow.test.tsx` (new)
- Modify: nothing (verification task; failures here are fixed in the owning task's code)

**Interfaces:**
- Consumes: `routes` (Task 2), `FlowActions` (Task 5), `ContextPanel` (Task 4), `AssessmentForm` (Task 5), `SAMPLE_TOPOLOGY` (Task 1).

- [ ] **Step 1: Write the composition test**

Create `packages/web/src/routes/demo-flow.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../api/hooks.js', () => ({
  useOrgs: () => ({
    data: { orgs: [{ id: 'acme', name: 'Acme Corp' }] },
    isPending: false,
    isError: false,
  }),
  useAssessment: () => ({ data: null, isPending: true, isError: false }),
  useAssessmentList: () => ({ data: { assessments: [] }, isPending: false, isError: false }),
  useCreateAssessment: () => ({ mutate: vi.fn() }),
  useWorkspace: () => ({ data: null, isPending: true, isError: false }),
  useWorkspaces: () => ({ data: { workspaces: [] }, isPending: false, isError: false }),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('demo flow: one connected command center', () => {
  it('hub → service panel → close keeps the graph; Evaluar PR carries the repo context', () => {
    const { router } = renderAt('/orgs/acme');
    const topologyHeading = screen.getByText(/service topology/i);

    // 1. El panel de servicio abre SOBRE el grafo (que no se desmonta).
    fireEvent.click(screen.getByText('orders'));
    expect(screen.getByRole('heading', { name: /service orders/i })).toBeTruthy();
    expect(screen.getByText(/service topology/i)).toBe(topologyHeading);

    // 2. Cerrar el panel vuelve al hub, grajo intacto.
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(router.state.location.pathname).toBe('/orgs/acme');
    expect(screen.getByText(/service topology/i)).toBe(topologyHeading);

    // 3. "Evaluar PR" con contexto del nodo seleccionado lleva al formulario.
    fireEvent.click(screen.getByRole('link', { name: /evaluar pr/i }));
    expect(router.state.location.pathname).toBe('/orgs/acme/assessments');
    expect((screen.getByLabelText(/repo/i) as HTMLInputElement).value).toBe('orders');
  });
});
```

Note on step 3: it starts at `/orgs/acme` with no `?node=` — the FlowActions link then carries `?repo=` from the *selected node* state. To make the assertion deterministic, start the test at `/orgs/acme?node=orders` instead (the `?node=` param is what Task 5 reads), or click the `orders` node first (step 1 already does) and have `OrgLayout` update `?node=` on selection — implement whichever the Task 4/5 wiring made true and assert the form shows `orders`. The observable contract: **clicking a service and pressing Evaluar PR lands on the form with that repo filled**.

- [ ] **Step 2: Run the test to verify it fails against anything short of the full flow**

Run: `pnpm --filter @parallax/web run test -- src/routes/demo-flow.test.tsx`
Expected: any break in the chain (panel unmounts the graph, close loses context, form unpreselected) fails a named assertion.

- [ ] **Step 3: Fix any gaps the composition test exposes in the owning task's code**

Run: `pnpm --filter @parallax/web run test`
Expected: PASS (whole web package green).

- [ ] **Step 4: Full verification of the deliverable**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test && pnpm test:heldout
```
Expected: all green; held-out unchanged (3 tests, api-side).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/demo-flow.test.tsx
git commit -m "test(web): composition test for the connected demo flow"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-15-ui-hub-restructure.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Native**, because the 7 tasks are tightly sequential on shared surfaces (OrgLayout → routes → panel → actions) where each task's JSX refactors the previous one's file, and the spec is small and fully in-context — the composition test at the end is the real safety net. Does the plan capture what you want, and which approach should we use?
