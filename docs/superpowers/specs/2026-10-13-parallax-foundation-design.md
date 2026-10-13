# Parallax — Foundation & Scaffolding

**Date:** 2026-10-13
**Status:** Validated design, ready for implementation plan
**Scope:** Subproject 1 of 7 in the Parallax roadmap
**Source spec:** `design/Parallax_Diseno.docx` (v0.2, 2026-10-13)
**Base dependency:** [lain](https://github.com/spuentesp/lain) at the commit pinned by PR #319 (`0abcd968fd78cc807b829e6877455eef616232c7`); PR #317 and #318 must be merged before subproject 2 starts.

---

## 1. Context and framing

Parallax is an **architectural intelligence center** — a server that runs alongside lain and exposes an organization's service topology, contract graph, and PR impact through a web UI (for architects) and an MCP server (for AI agents). Local development is a means to an end; production is a deployed server behind HTTPS that the organization accesses by URL.

The full product decomposes into seven subprojects (see Appendix A). This spec covers **Subproject 1: Foundation & Scaffolding** — the terrain every other subproject builds on. Subproject 1 is executable today, without waiting for the lain PRs to merge, because it integrates lain through a typed contract and a mock implementation.

### What this subproject delivers

- A monorepo with four packages (`shared`, `api`, `mcp`, `web`), pnpm workspaces, TypeScript strict, Biome, Vitest, GitHub Actions.
- A domain layer in `shared` that defines the DTOs the rest of the system uses (mirror of the lain contract + Parallax's own types).
- An initial SQLite schema for the seven tables the design mandates.
- A Fastify HTTP server with route stubs that return honest `501 Not Implemented` errors and a `/health` endpoint that is fully functional.
- An MCP server with the four product tools, transportable over stdio (dev) and HTTP/SSE (deploy), with the wrapper layer that lets the same code serve both.
- A React SPA shell with the routes, navigation, and placeholder components. The map is a placeholder — real graph rendering lives in subproject 4.
- A `LainAdapter` interface, a fully-functional mock backed by realistic fixtures, and a real-client stub that compiles but raises `NotImplementedError` until subproject 2 fills it in.
- A smoke test that validates the full chain (api boots → LainAdapter mock → /health → mcp tools/list) end-to-end without a real lain binary.

### What this subproject explicitly does NOT deliver

The full list of out-of-scope items lives in §7. The headline exclusions: real lain integration, AssessmentWorker logic, the real service map, Nemotron integration, the PR-URL flow, publication, decision history.

---

## 2. Architecture and stack

### 2.1 Repository layout

```
parallax/
├─ .github/workflows/ci.yml
├─ .gitignore
├─ .nvmrc                          # 26.11.1
├─ .node-version                   # 26.11.1
├─ biome.json
├─ package.json                    # workspace root
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ vitest.workspace.ts
├─ README.md
├─ docs/
│  ├─ architecture.md
│  └─ runbook.md
└─ packages/
   ├─ shared/                      # DTOs, schemas, domain types (no deps)
   ├─ api/                         # Fastify HTTP + SSE + MCP http-sse
   ├─ mcp/                         # MCP server entrypoint (stdio)
   └─ web/                         # Vite + React Router 8 SPA
```

### 2.2 Package responsibilities and dependencies

- **`shared`** — Pure types. No runtime dependencies beyond `zod` (for schema validation of DTOs). All other packages depend on `shared`.
- **`api`** — Fastify HTTP server. Owns the SQLite database, the `LainAdapter` selection (mock or real), the auth plugin, and serves the `web` bundle as static assets. Depends on `shared`.
- **`mcp`** — MCP server entrypoint. Exposes the four product tools. Talks to the api over HTTP using a typed client. Depends on `shared`. The HTTP/SSE transport for the same tools lives in `api` so a single MCP process can be reached over either transport.
- **`web`** — Vite + React Router 8 + TanStack Query SPA. No SSR. Depends on `shared` for response types. Talks to the api over HTTPS.

### 2.3 Stack (versions pinned to current releases, October 2026)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 26.11.1 |
| Language | TypeScript | 7.0.2 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Package manager | pnpm | 12.11.2 |
| HTTP server | Fastify | 5.12.7 |
| Schema validation | Zod | 4.6.7 |
| Fastify schema integration | `fastify-type-provider-zod` | 7.0.0 |
| React | React | 19.3.0 |
| Web build | Vite | 8.3.4 |
| Router | React Router | 8.4.0 (data routers) |
| Data fetching | TanStack Query | 5.104.2 |
| MCP SDK | `@modelcontextprotocol/sdk` | 1.32.1 |
| SQLite driver | `better-sqlite3` | 13.0.3 |
| ORM | Drizzle | 0.45.4 |
| Tests | Vitest | 5.0.4 |
| Lint + format | Biome | 2.5.15 |
| CI | GitHub Actions | — |

### 2.4 Server-first deployment model

Parallax is a server, not a CLI. Production runs the same `api` and `mcp` binaries on a host (Nebius AI Cloud for the demo; on-prem for production), behind a reverse proxy with HTTPS. The web bundle is served by the api at `/app/*`.

Local development (`pnpm dev`) is dev mode: it runs the same binaries on `localhost` so a developer can iterate. Stdio MCP transport is the dev default. In production, the same MCP server runs behind HTTP/SSE so agents over the network can connect.

The MCP transport is selected by env: `PARALLAX_MCP_TRANSPORT=stdio|http-sse` (default `http-sse`). Both transports compile in this subproject; the smoke test verifies both are wired correctly.

---

## 3. Shared domain and database

### 3.1 DTOs in `packages/shared`

Two layers. Lain types are a strict mirror of the motor contract; domain types are Parallax's own model.

**`lain/` — Mirror of the lain contract**

- `tools.ts` — The nine tools from `design/Parallax_Diseno.docx` §7: `list_services`, `get_service`, `prepare_snapshot`, `get_snapshot`, `diff_contracts`, `trace_impact`, `get_coverage`, `resolve_evidence`, `read_source`. Each tool exports its args and response schema.
- `enums.ts` — `FindingClass = "Verified" | "NeedsInvestigation" | "NoKnownImpact"`, `EdgeType = "confirmed" | "heuristic"`, `LainView = "live" | \`snapshot:${string}\``.
- `findings.ts` — `LainFinding`, `LainChangeType`, `Binding`, `Match`.
- `coverage.ts` — `LainCoverage`, `RepoOmission`, `Truncation`.
- `evidence.ts` — `LainEvidence`, `LainEvidenceRef`.

These types are coupled to `analyzerVersion`. A bump in the lain analyzer requires a corresponding bump in the type and a regression of the mock.

**`domain/` — Parallax's own types**

- `ids.ts` — Branded types: `AssessmentId`, `EvidenceId`, `ExplanationId`, `OrgId`, `ProposalId`, `SnapshotId`. Type-safe, never interchangeable.
- `org.ts` — `Org` (`id`, `name`, `createdAt`), `OrgManifest` (repos with resolved commits, declared services, `configVersion`).
- `assessment.ts` — `Assessment` with the seven-state machine (`QUEUED | SNAPSHOTTING | ANALYZING | EXPLAINING | READY | PARTIAL | FAILED | CANCELLED`), `inputDigest` (UNIQUE, basis for idempotency), `baseId`, `headId`, `manifest`, timestamps.
- `finding.ts` — `Finding` with stable identity, `changeDetected`, `classification: FindingClass` (the motor's class — never promoted by the model), `consumers[]`, `evidenceRefs[]`.
- `evidence-ref.ts` — `EvidenceRef` with `repo`, `sha`, `path`, `range`, `view`, `source`, `evidenceId`. Resolvable before it is cited (P INV 1).
- `coverage.ts` — `Coverage` with `reposReviewed[]`, `reposOmitted[]` (each with cause), `refsUnresolved[]`, `truncated[]`. Omits are never hidden (P INV 3).
- `architecture-proposal.ts` — `ArchitectureProposal` with `objetivo`, `opciones[]` (each with `supuestos[]`, `evidencias[]`, `acciones[]`). Advisory until a human adopts it. Hypotheses never modify the observed map (P INV 6).
- `publication.ts` — `Publication` with `target`, `state` (`PENDING | CONFIRMED | UNCERTAIN`), `marker`, `remoteId`.

### 3.2 Database schema (initial migration)

Seven tables. The migration file is `packages/api/drizzle/0000_init.sql`.

```sql
CREATE TABLE org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE assessment (
  id TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL UNIQUE,    -- P INV 4
  status TEXT NOT NULL,
  base_id TEXT,
  head_id TEXT,
  manifest_json TEXT NOT NULL,
  engine_json TEXT,
  coverage_json TEXT,
  org_id TEXT NOT NULL REFERENCES org(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_assessment_status ON assessment(status);
CREATE INDEX idx_assessment_org ON assessment(org_id);

CREATE TABLE explanation (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  revision INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(assessment_id, revision)        -- P INV 2
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  view_id TEXT NOT NULL,                 -- P INV 1
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  path TEXT NOT NULL,
  range_json TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX idx_evidence_assessment ON evidence(assessment_id);

CREATE TABLE job_step (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  step TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  artifact_hash TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(assessment_id, step, attempt)  -- P INV 5
);

CREATE TABLE event (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(assessment_id, seq)
);

CREATE TABLE publication (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  target TEXT NOT NULL,
  state TEXT NOT NULL,
  marker TEXT NOT NULL,
  remote_id TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(assessment_id, target)         -- P1
);
```

The migration runs automatically on api boot. In this subproject the schema exists and the tables are reachable; no business logic inserts anything yet.

---

## 4. API, MCP, and Web skeletons

### 4.1 API surface (`packages/api`)

**REST routes** (Fastify with `fastify-type-provider-zod`):

| Method | Path | Subproject 1 behavior |
|---|---|---|
| `GET` | `/health` | `200` with `{status: "ok", version, lainAdapter: "mock"\|"real", apiVersion, analyzerVersion}` |
| `GET` | `/orgs` | `200` with `[]` |
| `POST` | `/orgs` | `501` Problem Details |
| `GET` | `/orgs/:orgId` | `501` |
| `POST` | `/assessments` | `501` |
| `GET` | `/assessments/:id` | `501` |
| `GET` | `/assessments/:id/events` | `501` (SSE wiring exists but the endpoint is not subscribed yet) |
| `POST` | `/proposals` | `501` |
| `GET` | `/proposals/:id` | `501` |
| `POST` | `/publications` | `501` |
| `GET` | `/app/*` | Serves the built web bundle (production); 404 in dev where Vite serves it |

**Fastify plugins** (registered in order during `buildApp`):

- `db` — Opens `data/parallax.db` with `better-sqlite3`, runs migrations on boot, decorates `fastify.db` with the Drizzle client.
- `lain-adapter` — Selects mock or real implementation per `LAIN_ADAPTER` env, decorates `fastify.lain`. The real client fails fast at boot if `LAIN_URL` is unreachable.
- `auth` — Bearer-token authentication. See §4.4.
- `error-handler` — Maps `ZodError` to `400`, `LainCallError` to its code, anything else to `500` with `traceId`. All responses follow RFC 7807 Problem Details.

**MCP HTTP/SSE transport** (also under `packages/api/src/mcp/`):

The four product tools are exposed at `POST /mcp` (JSON-RPC) and `GET /mcp/sse` (event stream). The MCP SDK is wrapped in an internal transport abstraction so the same tool implementations serve both stdio (from `packages/mcp`) and HTTP/SSE (from `packages/api`). The HTTP/SSE transport is the default in production.

### 4.2 MCP server (`packages/mcp`)

The `mcp` package is the stdio entrypoint — what an agent launches when it connects locally. It registers the same four tools, then delegates each call to the api over HTTP using a typed client.

**Product tools:**

| Tool | Args | Subproject 1 behavior |
|---|---|---|
| `parallax_explore` | `{orgId, focus?, serviceId?}` | Calls `GET /orgs/:orgId`. Returns the result or `ApiEndpointNotImplemented` (typed error with `code` and `doc` URL pointing at this spec) if the api returns 501. |
| `parallax_assess_pr` | `{prUrl \| {repo, base, head}, orgId}` | Calls `POST /assessments`. Returns `ApiEndpointNotImplemented` with `doc` URL. |
| `parallax_get_assessment` | `{assessmentId}` | Calls `GET /assessments/:id`. Returns result or typed error. |
| `parallax_get_evidence` | `{assessmentId, evidenceId}` | Calls `GET /assessments/:id` and extracts the evidence. Returns typed error if absent. |

The `api-client.ts` uses `fetch` with types imported from `packages/shared`. Bearer token from `PARALLAX_API_TOKEN` env (picks the first token in `PARALLAX_TOKENS` for dev).

### 4.3 Web shell (`packages/web`)

**Routes (React Router 8 data routers):**

| Path | Subproject 1 behavior |
|---|---|
| `/` | Redirect to `/orgs` |
| `/orgs` | Empty list with "no hay organizaciones" + a "Crear" button that shows a toast "no implementado en MVP" |
| `/orgs/:orgId` | Layout shell with sidebar, header, and a placeholder "ServiceMap" area |
| `/orgs/:orgId/services/:serviceId` | Stub detail with placeholder evidence panel |
| `/orgs/:orgId/assessments` | Empty table with "Sin assessments" |
| `/orgs/:orgId/assessments/:assessmentId` | Stub view with state machine visible, no content |
| `/orgs/:orgId/proposals/:proposalId` | Placeholder "ArchitectureProposal" |
| `/app/*` | Only relevant in dev when Vite serves the bundle; in production, the api serves the same paths |

**Data hooks (TanStack Query):** `useOrgs`, `useOrg`, `useAssessment`, `useAssessmentStream` (SSE — falls back to polling in subproject 1), `useProposal`. Hooks are typed against `shared` response types and handle loading/error states.

**Components (visually recognizable, functionally empty):**

- `<ServiceMap />` — empty grid with "Mapa de servicios" label (real graph in subproject 4).
- `<EvidencePanel />` — empty list with skeleton.
- `<AssessmentView />` — header with `assessmentId`, placeholder sections.
- `<CoverageBadge />` — receives `Coverage` and renders a colored badge. **In this subproject, the badge is always red "sin datos"** because real coverage does not exist yet. The badge never shows "all clear" when coverage is empty (P INV 3).

### 4.4 Authentication

Multi-token from MVP. The api reads `PARALLAX_TOKENS` (JSON array) from env:

```json
[
  { "token": "px_dev_abc", "orgId": "org_demo", "scopes": ["read", "write"] },
  { "token": "px_agt_xyz", "orgId": "org_demo", "scopes": ["read"] }
]
```

The auth plugin extracts the bearer token, looks it up, attaches `orgId` and `scopes` to the request, and rejects with `401` (no token / unknown token) or `403` (insufficient scope). The handler checks scope per route via a route-level config. Post-MVP this becomes OIDC; the schema is already shaped for the migration.

---

## 5. LainAdapter contract

The `LainAdapter` interface is what the api consumes; the mock implementation is what this subproject delivers; the real client (against a federated lain server) is a stub that fills in during subproject 2.

### 5.1 Interface (`packages/api/src/lain-adapter/types.ts`)

```typescript
export interface LainAdapter {
  readonly analyzerVersion: string;
  readonly apiVersion: '1';

  listServices(view: LainView, opts?: { repo?: string }): Promise<ListServicesResponse>;
  getService(view: LainView, req: GetServiceRequest): Promise<GetServiceResponse>;
  prepareSnapshot(req: PrepareSnapshotRequest): Promise<PrepareSnapshotResponse>;
  getSnapshot(req: GetSnapshotRequest): Promise<GetSnapshotResponse>;
  diffContracts(req: DiffContractsRequest): Promise<DiffContractsResponse>;
  traceImpact(req: TraceImpactRequest): Promise<TraceImpactResponse>;
  getCoverage(req: GetCoverageRequest): Promise<GetCoverageResponse>;
  resolveEvidence(req: ResolveEvidenceRequest): Promise<ResolveEvidenceResponse>;
  readSource(req: ReadSourceRequest): Promise<ReadSourceResponse>;
}
```

### 5.2 Design decisions

1. **Explicit `LainView` everywhere.** Every method takes a view (`"live"` or `"snapshot:<id>"`). The adapter does not infer. This is what guarantees P INV 1: every citation points to a concrete view.
2. **Pagination and caps are visible in the response.** Truncation is part of the response contract, never hidden. The mock and the real client both surface `truncated`, `cap`, and `cursor` faithfully.
3. **`apiVersion` and `analyzerVersion` are validated once at handshake** and exposed as adapter properties. A mismatch fails the adapter at boot, not silently.
4. **Errors are structured, not strings.** A `LainCallError` union with codes (`LainUnavailable`, `SnapshotNotReady`, `ApiVersionMismatch`, `AnalyzerVersionMismatch`, `ToolSchemaMismatch`, `IncompatibleView`). The Fastify `error-handler` maps each to a Problem Details response.
5. **The adapter does not know about SQLite or assessment.** It is a pure client of the lain motor. Persistence and orchestration live in `AssessmentWorker` (subproject 3).
6. **The real client is a stub.** `packages/api/src/lain-adapter/client.ts` defines the JSON-RPC transport, timeouts (10s normal, 60s waiting on `get_snapshot.ready`), and retry policy (only on `LainUnavailable`, with backoff). The actual `tools/call` and `tools/list` round-trip fills in during subproject 2. In this subproject, the stub raises `NotImplementedError` on the first call.

### 5.3 The mock

`packages/api/src/lain-adapter/mock.ts` reads from `packages/shared/test/lain-fixtures.ts` and responds. The fixtures cover the four services of the design's fixture (`orders`, `billing`, `reports`, `platform/shipping`, `platform/inventory`) and the two scenarios (`s1-remove-customer-id`, `s2-add-currency`). The mock:

- Validates `analyzerVersion` and `apiVersion` against the values declared in the fixture header.
- Returns `LainCallError` if args fail the Zod schema of the tool.
- Simulates `prepareSnapshot` with a 100ms timer; `getSnapshot` transitions `pending → ready`.
- Records calls in memory so the smoke test can assert ordering (e.g. `prepare_snapshot` precedes `get_snapshot`).

The mock is not production code. It is the safety net that lets subproject 1 verify type chains and error mapping without a lain binary.

### 5.4 The federated lain target

The adapter is configured by `LAIN_URL` — a single URL pointing at a lain server that has the organization's workspace configured. Example for the demo:

```
LAIN_URL=http://lain:9999/mcp
```

with the lain server having run:

```
lain workspaces create org-demo --members orders,billing,reports,platform
```

The adapter does not manage workspaces; it just queries whatever lain exposes. `listServices` accepts an optional `repo` filter, but the adapter itself does not know which repos exist — lain does.

---

## 6. Validation, CI, and developer experience

### 6.1 TypeScript

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `isolatedModules`, `verbatimModuleSyntax`. Each package extends with its own settings (`api` uses NodeNext, `web` adds DOM libs and `jsx: react-jsx`).

### 6.2 Biome

Single tool for lint and format. Config in `biome.json` enables Biome 2 schema, formatter at 100 cols, single quotes, trailing commas, semicolons. The linter enables the recommended ruleset plus `noUnusedImports` and `useImportType` as errors.

### 6.3 Vitest

`vitest.workspace.ts` aggregates the four packages. Each has a `vitest.config.ts` with `environment: node` (or `jsdom` for `web`), v8 coverage with a **60% threshold** for this subproject, and path aliases that match the package's tsconfig.

### 6.4 GitHub Actions

`ci.yml` runs on PR and on push to `main`. Steps: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm smoke`. Cached with `cache: pnpm`. The smoke step runs with `LAIN_ADAPTER=mock` — it never touches a real lain. Target runtime under 5 minutes.

### 6.5 Workspace scripts

`package.json` at the root exposes `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `build`, `dev:api`, `dev:web`, `dev:mcp`, `smoke`, `db:migrate`. `packageManager` and `engines` are pinned to the versions in §2.3.

### 6.6 `.gitignore`

Excludes `node_modules/`, `dist/`, `build/`, `coverage/`, `data/*.db*`, `.parallax/`, `.env`, `.env.local`, `**/*.tsbuildinfo`. The existing `.env` (with `NEMOTRON_TOKEN`) is already untracked; the gitignore keeps it that way.

---

## 7. Acceptance criteria and out of scope

### 7.1 User stories (subproject 1)

1. As an architect at the org, I open `https://parallax.internal/orgs/acme` and see the service map of my organization.
2. As an architect, I open the URL from any corp machine and the server recognizes me by token and shows me my org.
3. As an architect, I can `curl -H "Authorization: Bearer $T" https://parallax.internal/health` and get `{status: "ok", version, lainAdapter, apiVersion, analyzerVersion}`.
4. As an architect, I can `GET /orgs` and receive `[]` with `200`, confirming the API responds with its real contract when there is no data.
5. As an architect, I can `GET /orgs/abc` and receive RFC 7807 with `code: "NotImplemented"` and a `traceId`, so no endpoint hides "not yet" as "empty".
6. As an AI agent connected via MCP, I list the tools of Parallax and see `parallax_explore`, `parallax_assess_pr`, `parallax_get_assessment`, `parallax_get_evidence`.
7. As an AI agent connected via MCP, I invoke `parallax_explore` and receive a typed `ApiEndpointNotImplemented` error (no stack trace), so my reasoning loop can handle the gap.
8. As an architect, I open the web in the browser and see the shell of the app (sidebar, header, routes) so I can validate the visual architecture before data is wired.
9. As an architect, the `CoverageBadge` is red "sin datos" on any assessment view, so empty coverage is always visible (P INV 3).
10. As an architect, I open a PR and CI runs typecheck + lint + format + tests + build + smoke in under 5 minutes.
11. As an architect, I can see the seven tables (`org`, `assessment`, `explanation`, `evidence`, `job_step`, `event`, `publication`) created on a fresh api boot.
12. As an architect, I can run `pnpm smoke` and see the full chain `api boot → LainAdapter mock → /health 200 → mcp tools/list 4 tools → /orgs 200 []` all green, so I trust the type chain works end-to-end without a lain binary.
13. As an AI agent, I have a tool that returns a typed error with a `doc` link when the api endpoint is not implemented, so my loop can decide not to retry.

### 7.2 Acceptance checklist

- [ ] `pnpm install --frozen-lockfile` exits 0
- [ ] `pnpm typecheck` exits 0 with the strict config in §6.1
- [ ] `pnpm lint` (biome check) exits 0
- [ ] `pnpm format:check` (biome format) exits 0
- [ ] `pnpm test` exits 0, coverage ≥ 60% per package
- [ ] `pnpm build` exits 0 for `api`, `mcp`, `web`
- [ ] `pnpm smoke` exits 0: api boots, `/health` returns 200, MCP `tools/list` returns the four product tools, both stdio and HTTP/SSE transports are wired
- [ ] The seven tables exist in `data/parallax.db` after a clean boot
- [ ] The nine `LainAdapter` methods are typed (compile) and the mock responds to all nine from the fixture
- [ ] GitHub Actions CI runs the seven steps and is green in under 5 minutes
- [ ] No secrets are committed; `.env` and `data/` are gitignored
- [ ] The auth plugin rejects requests without a valid bearer token and routes respect the `scopes` config

### 7.3 Out of scope (later subprojects)

| Capability | Subproject |
|---|---|
| Real MCP client against a lain binary, handshake validation, `cursor`/`limit`/`truncated` handling, fixtures run against a real lain | **2 — LainAdapter & Fixture** |
| `AssessmentWorker` state machine, idempotency by `input_digest`, SSE event stream, recovery after restart | **3 — Assessment Worker & Persistencia** |
| `OrgProjection` (services as nodes, `consumers[].uses` as edges), real map visualization, change view with SHA and coverage | **4 — Map UI & MCP de producto** |
| Nemotron loop with tool-calling, budget (8 calls / 120s), `explanation` persistence with `revision` and `prompt_version`, `ArchitectureProposal` separated from findings | **5 — Nemotron Investigator** |
| GitHubAdapter, publication outbox with marker, 175s demo runbook, clean-host install, recording | **6 — PR Flow, Publicación & Demo** |
| Decision memory, assisted comparison of alternatives, real publication with reconciliation | **7 — Post-MVP (P1)** |

### 7.4 Risks

- **Biome 2 is a recent major.** Its config schema differs from 1.x; some online documentation may be stale. Mitigation: validate config in a scratch commit before locking the ruleset.
- **TypeScript 7.0.2 is a new major.** Subtle breaking changes in dependencies are possible. Mitigation: `pnpm install` on a clean checkout and report any failure before the plan is finalized.
- **React Router 8 + Vite 8** is a modern combination but not the most battle-tested. A bug in config could stall the web. Mitigation: the web in this subproject is structure only, no data logic.
- **Node 26** vs Nebius image. If the Nebius deployment image uses Node 24 LTS, `.nvmrc` needs adjustment before subproject 6. Mitigation: the api is portable across Node 24+ and the choice is reversible.
- **HTTP/SSE MCP in subproject 1** adds work versus deferring. If the deadline is tight, fallback is stdio-only in this subproject, HTTP/SSE in subproject 2.

---

## Appendix A — Decomposition of the full product

The design in `Parallax_Diseno.docx` covers a product that is too large for a single implementation plan. The decomposition is:

1. **Foundation & Scaffolding** — this spec.
2. **LainAdapter & Fixture (G0 + G1)** — Real lain integration, fixture execution, ground-truth validation.
3. **Assessment Worker & Persistencia (G2 part 1)** — State machine, idempotency, SSE.
4. **Map UI & MCP de producto (G2 part 2)** — Real graph, navigable map, change view.
5. **Nemotron Investigator (G3)** — Tool-calling loop, budget, explanation persistence.
6. **PR Flow, Publicación & Demo (G4)** — GitHubAdapter, outbox, demo runbook.
7. **Post-MVP (P1)** — Decision memory, comparison, hardened publication.

Order of dependencies: 1 → 2 → (3 ∥ 4) → 5 → 6 → 7. Subproject 3 and 4 can run in parallel from the day subproject 2 closes, sharing the `LainAdapter` but not the rest of their domains. Subprojects 5 and 6 are sequential by construction.

The lain PRs in flight (319, 317, 318) gate subproject 2 but not subproject 1.
