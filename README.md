# Parallax

> Architectural intelligence center built on [lain](https://github.com/spuentesp/lain).
> Submitted to the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) — Coding and Agentic Engineering track.

Parallax turns an organization's multi-repo service topology into a navigable command center. Architects see contracts, consumers, and coverage. AI agents query the same data through an MCP server. PRs are evaluated against a structural baseline with evidence-backed findings.

## What it does

- **Org-wide service map** built on lain's federated code graph (multi-repo, cross-repo blast-radius).
- **PR impact assessment** that compares snapshots base vs. head, with findings classified by the motor (`Verified | NeedsInvestigation | NoKnownImpact`).
- **Investigator powered by NVIDIA Nemotron** (via Nebius Token Factory): tool-calling loop with budget, persists explanations with revision, never promotes the motor's classification.
- **MCP server** for AI agents (Claude Code, Codex, Cursor). Both stdio (local) and HTTP/SSE (remote) transports.
- **Web SPA** served by the same api at `/app/*`.

## Architecture

```
┌─ host (Nebius AI Cloud, production) ────────────────────────────────────┐
│                                                                        │
│  lain (MCP server, port 9999)        ── reads repos, federated graph  │
│     ↑                                                              │   │
│  parallax api (Fastify, port 8080)  ── LainAdapter, AssessmentWorker │   │
│     ├─ MCP HTTP/SSE transport (port 8080/mcp)                        │   │
│     ├─ REST API (/orgs, /assessments, /proposals, /publications)     │   │
│     ├─ Web bundle (/app/*)                                           │   │
│     └─ SQLite (data/parallax.db)                                     │   │
│                                                                        │
│  parallax mcp (stdio entrypoint, optional) — for local agents        │   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

The Nemotron investigator runs as a **Nebius Serverless Job** (bounded: 8 tool calls, 120s).

## Stack

- TypeScript 7.0.2, Node 24.21.0 (LTS), pnpm 12.11.2
- Fastify 5.12.7, Zod 4.6.7, `fastify-type-provider-zod` 7.0.0
- `@modelcontextprotocol/sdk` 1.32.1
- Drizzle 0.45.4, `better-sqlite3` 13.0.3
- Vite 8.3.4, React 19.3.0, React Router 8.4.0, TanStack Query 5.104.2
- Vitest 5.0.4, Biome 2.5.15

## Setup

```bash
nvm use                  # or ensure Node 24.21.0+
corepack enable          # if pnpm is not installed
pnpm install
cp .env.example .env     # fill in PARALLAX_TOKENS, LAIN_URL, NEBIUS_TOKEN
```

## Run (dev mode)

```bash
pnpm dev:api             # api on :8080 (stdio MCP by default)
pnpm dev:web             # web on :5173 with Vite dev server proxying /api → :8080
pnpm dev:mcp             # stdio MCP entrypoint
```

The api uses `LAIN_ADAPTER=mock` by default. Use
[Lain v0.11.0](https://github.com/spuentesp/lain/releases/tag/v0.11.0) for the
GraphQL provider and binding fixes. Start its HTTP server with your workspace's
`repos.yaml`; Parallax loads the `contracts` package when the server starts with
the default core profile.

```bash
lain server --config /path/to/repos.yaml --transport http --port 9999
```

Large Saleor workspaces also need the
[indexing performance patch](patches/lain-0.11.0-indexing-performance.patch).
The published v0.11.0 binary repeatedly validates entire SDL documents and
recompiles HTTP tree-sitter queries, fixed router-prefix regexes and bundled
WebSocket and event idioms per source file. Field-access analysis also copies
the graph for each file. The patch reuses this setup across a scan. To build the patched
engine from a v0.11.0 checkout:

```bash
git apply /path/to/parallax/patches/lain-0.11.0-indexing-performance.patch
cargo test --lib server::sensors::
cargo build --release --bin lain --bin lain-git-sidecar
./target/release/lain server --config /path/to/repos.yaml --transport http --port 9999
```

Point Parallax at that server:

```bash
LAIN_ADAPTER=real LAIN_URL=http://localhost:9999/mcp pnpm dev:api
```

## Use of Nemotron and Token Factory

Parallax is built for the **Coding and Agentic Engineering** track. The Nemotron investigator uses:

- **Nemotron 3 Super 120B-A12B** (`nvidia/nemotron-3-super-120b-a12b`) for the supervisor role — decomposition and structured planning.
- **Nemotron 3_5 Lightning** (`nvidia/Nemotron-3_5-Lightning`) for the worker role — many short calls, "execution layer" for always-on, long-running agents.
- **Nemotron 3 Ultra 550B-A55B** (`nvidia/Nemotron-3-Ultra-550b-a55b`) for heavy reasoning when budget allows.

All three are consumed through **Nebius Token Factory** (`NEBIUS_TOKEN` env). The investigator loop respects a hard budget (16 tool calls by default, 120s per query) and persists every explanation with `revision` and `prompt_version` so the work is auditable.

## Project structure

```
parallax/
├─ packages/
│  ├─ shared/   DTOs, schemas, domain types (lain mirror + Parallax types)
│  ├─ api/      Fastify HTTP + MCP HTTP/SSE + LainAdapter + SQLite
│  ├─ mcp/      stdio MCP entrypoint (delegates to api)
│  └─ web/      Vite + React Router 8 SPA
├─ docs/        specs and plans
├─ design/      source design document
└─ .github/     CI
```

Testing follows an anti-reward-hacking protocol: property-based and model-based
tests (`test/prop/`), a held-out composition suite (`test-heldout/`) owned by a
red-team agent, and a mutation gate over each PR diff (run locally, not in CI). See
`docs/testing/red-team-protocol.md`.

## Release checks

Run the local checks with `pnpm test`, `pnpm test:heldout`, `pnpm typecheck`,
`pnpm lint`, and `pnpm build`.

The integration gates use a real Lain server. The contracts fixture needs the
repos and commits listed in `test-repos/contracts-fixture/repos.yaml`:

```bash
lain server --config test-repos/contracts-fixture/repos.yaml --transport http --port 9997
LAIN_URL=http://localhost:9997/mcp DATABASE_PATH=/tmp/parallax-release-g2.db \
  NEMOTRON_WORKER_MODEL=nvidia/nemotron-3-super-120b-a12b pnpm gate:release
```

`gate:release` checks contracts and evidence, persisted assessments and recovery,
code graph expansion (including the 0.11 `edges` and `paths` output), and the
investigator. Its G2 runner recreates `DATABASE_PATH`, so use a disposable DB.
G3 reads `NEBIUS_TOKEN` from the environment or `.env` for live model calls;
without a token it reports that those calls were skipped. Scripted model checks
still run against the real Lain fixture.

The live model gate passed with Nemotron Super as the worker on 2026-10-21.
The default Lightning worker timed out in that run; the command above selects
the tested model without changing the application default.

The GraphQL release gate needs only Git and the release binary. It creates
small committed source repos in a temporary directory, boots Lain with the
core profile, verifies the ambiguity before configuration, applies the advisor's
binding YAML verbatim, and checks the automatic dependency after suppressing
copied providers. It cleans up the servers and temporary repos when it exits.

```bash
LAIN_BIN=/path/to/lain-0.11.0 pnpm gate:graphql
```

For Saleor, apply the advisor's `provides_graphql: false` entry to the
`saleor-dashboard` service in the Lain configuration and restart/reindex. Keep
`NEXT_PUBLIC_SALEOR_API_URL` on the `saleor-api` provider. Then run:

```bash
LAIN_URL=http://localhost:9999/mcp pnpm gate:saleor
```

This gate waits for all repos to finish indexing, then checks the provider
catalog, resolved storefront operations, GraphQL binding YAML, and the
`storefront → endpoint → saleor-api` path returned by Parallax. The default
indexing deadline is 15 minutes; set `LAIN_INDEX_TIMEOUT_MS` for a larger
workspace. Other unresolved calls remain visible.

The PR evaluation extension has a read-only listing API. The web picker and
webhook/status automation remain in the
[PR evaluation design](docs/superpowers/specs/2026-10-20-pr-evaluation-design.md).
The status-writing credential and reporting defaults still need a decision
before implementation.

## License

MIT — see `LICENSE`.
