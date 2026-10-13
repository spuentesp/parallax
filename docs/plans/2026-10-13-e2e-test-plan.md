# Parallax — E2E Test Plan

**Date:** 2026-10-13
**Goal:** Verify every component works end-to-end: API, UI, MCP, agent flow, and integrations.
**Stack:** Vitest (unit/integration), Playwright (UI E2E), custom smoke scripts.

---

## 1. Test Pyramid

| Layer | Tool | Scope | Count |
|---|---|---|---|
| Unit | Vitest | Individual functions, schemas, types | 55 shared + 70 api |
| Integration | Vitest + Fastify inject | API routes, plugins, DB, LainAdapter mock | included above |
| E2E API | Vitest + fetch | Full HTTP requests against running API | ~15 |
| E2E UI | Playwright | Browser: navigation, chat, topology, forms | ~10 |
| Smoke | Custom script | Full stack boot + health + MCP + web | 1 |
| Agent | Vitest + mocked Nemotron | QueryAgent LangGraph flow | ~5 |

---

## 2. E2E API Tests

### 2.1 Health & Metadata

| Test | Endpoint | Assert |
|---|---|---|
| Health returns OK | `GET /health` | `200`, `{status:"ok", version, lainAdapter, apiVersion, analyzerVersion}` |
| Health is public | `GET /health` without auth | `200` (no 401) |

### 2.2 Auth

| Test | Endpoint | Assert |
|---|---|---|
| Protected route without token | `GET /orgs` | `401` |
| Protected route with invalid token | `GET /orgs` + `Bearer invalid` | `401` |
| Protected route with valid token | `GET /orgs` + `Bearer t` | `200` |
| Insufficient scope | `POST /orgs` + `Bearer ro` (read-only) | `403` |
| Malformed header | `GET /orgs` + `Basic xyz` | `401` |

### 2.3 Orgs

| Test | Endpoint | Assert |
|---|---|---|
| List orgs returns empty array | `GET /orgs` | `200`, `{orgs:[]}` |
| Create org returns 501 | `POST /orgs` | `501`, `{code:"NotImplemented", doc:"https://..."}` |
| Get org by id returns 501 | `GET /orgs/abc` | `501`, `{code:"NotImplemented"}` |

### 2.4 Assessments

| Test | Endpoint | Assert |
|---|---|---|
| Create assessment returns 501 | `POST /assessments` | `501` |
| Invalid body returns 400 | `POST /assessments` + `{}` | `400`, Problem Details |
| Get assessment returns 501 | `GET /assessments/a_1` | `501` |
| Get assessment events returns 501 | `GET /assessments/a_1/events` | `501` |

### 2.5 Proposals & Publications

| Test | Endpoint | Assert |
|---|---|---|
| Create proposal returns 501 | `POST /proposals` | `501` |
| Get proposal returns 501 | `GET /proposals/p_1` | `501` |
| Create publication returns 501 | `POST /publications` | `501` |

### 2.6 Query Agent

| Test | Endpoint | Assert |
|---|---|---|
| Query without Nemotron returns fallback | `POST /api/query` | `200`, answer mentions "topología de ejemplo" |
| Query with Nemotron returns answer | `POST /api/query` + `NEMOTRON_TOKEN` | `200`, answer is non-empty |
| Query returns topology | `POST /api/query` | `200`, `topology.nodes` is array |
| Query validates body | `POST /api/query` + `{}` | `400` |

### 2.7 MCP HTTP/SSE

| Test | Endpoint | Assert |
|---|---|---|
| Initialize returns server info | `POST /mcp` | `200`, `serverInfo.name === "parallax"` |
| Tools list returns 4 product tools | `POST /mcp` tools/list | `parallax_explore`, `parallax_assess_pr`, `parallax_get_assessment`, `parallax_get_evidence` |
| Tool call returns JSON-RPC 2.0 | `POST /mcp` tools/call | `jsonrpc: "2.0"`, `id` matches |
| Session ID is returned | `POST /mcp` initialize | `mcp-session-id` header present |

### 2.8 Web Bundle

| Test | Endpoint | Assert |
|---|---|---|
| Index.html serves | `GET /` | `200`, contains `<!doctype html>` |
| JS bundle serves | `GET /assets/index-*.js` | `200`, `text/javascript` |
| Path traversal rejected | `GET /assets/../../etc/passwd` | `400` or `404`, no `root:` in body |
| SPA fallback serves index | `GET /orgs` (non-API) | `200`, contains `<!doctype html>` |

---

## 3. E2E UI Tests (Playwright)

### 3.1 Navigation

| Test | Action | Assert |
|---|---|---|
| Root redirects to /orgs | `page.goto('/')` | URL is `/orgs` |
| Orgs page shows heading | `page.goto('/orgs')` | `h1` contains "Organizations" |
| Org page shows org ID | `page.goto('/orgs/org_demo')` | `h1` contains "org_demo" |
| Assessments link works | Click "Assessments" | URL is `/orgs/org_demo/assessments` |

### 3.2 TopologyView

| Test | Action | Assert |
|---|---|---|
| TopologyView renders | `page.goto('/orgs/org_demo')` | `div[data-testid="topology-view"]` exists |
| TopologyView has canvas | `page.goto('/orgs/org_demo')` | `canvas` element exists inside topology |
| TopologyView is not empty | `page.goto('/orgs/org_demo')` | `canvas` has non-zero dimensions |

### 3.3 ChatPanel

| Test | Action | Assert |
|---|---|---|
| ChatPanel renders | `page.goto('/orgs/org_demo')` | Input placeholder "Pregunta arquitectónica…" exists |
| Empty state shows hint | `page.goto('/orgs/org_demo')` | Text "Pregunta algo como" is visible |
| Send button is disabled when empty | `page.goto('/orgs/org_demo')` | Button "Enviar" is disabled |
| Typing enables send | Type "hello" | Button "Enviar" is enabled |
| Sending adds user message | Type "test" + click Send | User message bubble appears |
| Loading state shows | Send message | "Investigando…" appears |
| Response appears | Wait 3s | Assistant message appears |

### 3.4 CoverageBadge

| Test | Action | Assert |
|---|---|---|
| Badge shows "sin datos" | `page.goto('/orgs/org_demo/assessments/a_1')` | Badge contains "sin datos" |
| Badge is red | `page.goto('/orgs/org_demo/assessments/a_1')` | Badge has red background |

### 3.5 Assessment View

| Test | Action | Assert |
|---|---|---|
| Assessment page shows ID | `page.goto('/orgs/org_demo/assessments/a_1')` | Text "a_1" is visible |
| Assessment shows state | `page.goto('/orgs/org_demo/assessments/a_1')` | "Estado y contenido" is visible |

---

## 4. Integration Tests

### 4.1 API + Web Bundle

| Test | Action | Assert |
|---|---|---|
| API serves web bundle | `GET /` | Returns HTML that references `/assets/*.js` |
| JS bundle is loadable | `GET /assets/index-*.js` | Returns JS, `Content-Type: text/javascript` |
| SPA routes work | `GET /orgs/org_demo` | Returns HTML (SPA fallback) |

### 4.2 API + LainAdapter Mock

| Test | Action | Assert |
|---|---|---|
| Health shows mock adapter | `GET /health` | `lainAdapter === "mock"` |
| ListServices returns fixture data | Via LainAdapter mock | 4 services: orders, billing, reports, platform |
| DiffContracts returns FieldRemoved | Via LainAdapter mock | `customer_id` in changes |

### 4.3 API + QueryAgent

| Test | Action | Assert |
|---|---|---|
| Query returns topology | `POST /api/query` | `topology.nodes.length >= 0` |
| Query returns answer | `POST /api/query` | `answer` is non-empty string |
| Query handles empty lain results | `POST /api/query` | Answer mentions "No services" or similar |

---

## 5. Smoke Test

Single script that boots everything and verifies the full chain:

```
1. Build web bundle
2. Start API with mock lain
3. GET /health → 200
4. GET / → 200 (HTML)
5. GET /assets/*.js → 200 (JS)
6. POST /mcp initialize → 200 (serverInfo)
7. POST /mcp tools/list → 4 product tools
8. POST /api/query → 200 (answer + topology)
9. GET /orgs → 200 (with auth)
10. GET /orgs → 401 (without auth)
```

---

## 6. Agent Tests

| Test | Action | Assert |
|---|---|---|
| QueryAgent plan step | Mock Nemotron planner | Plan is non-empty array |
| QueryAgent query_lain step | Mock LainAdapter | Discovered services is populated |
| QueryAgent analyze step | Mock Nemotron worker | Answer is non-empty string |
| QueryAgent curate step | Mock discovered services | TopologyView has nodes |
| QueryAgent full flow | Real Nemotron + mock lain | Returns answer + topology |
| QueryAgent handles missing NEMOTRON_TOKEN | No token | Returns fallback answer |

---

## 7. Test File Structure

```
packages/api/test/
├── config.test.ts              ✓ 5 tests
├── lain-adapter-types.test.ts  ✓ 4 tests
├── lain-adapter-mock.test.ts   ✓ 11 tests
├── lain-adapter-client.test.ts ✓ 5 tests
├── lain-adapter-plugin.test.ts ✓ 2 tests
├── auth.test.ts                ✓ 6 tests
├── error-handler.test.ts       ✓ 4 tests
├── db.test.ts                  ✓ 1 test
├── server.test.ts              ✓ 2 tests
├── assessment-worker.test.ts   ✓ 9 tests
├── routes-orgs.test.ts         ✓ 3 tests
├── routes-stubs.test.ts        ✓ 7 tests
├── mcp-tools.test.ts           ✓ 3 tests
├── app-static.test.ts          ✓ 4 tests
├── smoke.test.ts               ✓ 4 tests
└── e2e-api.test.ts             ← NEW: full HTTP tests

packages/web/src/
├── api/client.test.ts          ✓ 2 tests
├── components/CoverageBadge.test.tsx  ✓ 3 tests
├── components/TopologyView.test.tsx   ✓ 2 tests
├── components/components.test.tsx     ✓ 3 tests
├── routes/routes.test.tsx              ✓ 3 tests
└── e2e/                                ← NEW: Playwright tests
    ├── navigation.spec.ts
    ├── topology.spec.ts
    ├── chat.spec.ts
    └── assessment.spec.ts
```

---

## 8. Execution

```bash
# Unit + integration
pnpm test

# E2E API
pnpm --filter @parallax/api test e2e

# E2E UI (needs running API)
pnpm --filter @parallax/web test:e2e

# Smoke (full stack)
pnpm smoke

# All together
pnpm test && pnpm --filter @parallax/web build && pnpm smoke
```

---

## 9. Success Criteria

- [ ] All unit/integration tests pass (139 current)
- [ ] All E2E API tests pass (~15 new)
- [ ] All E2E UI tests pass (~10 new)
- [ ] Smoke test passes
- [ ] No test requires network access (except optional Nemotron tests)
- [ ] CI runs all tests in < 5 minutes
