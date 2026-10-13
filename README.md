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
cp .env.example .env     # fill in PARALLAX_TOKENS, LAIN_URL, NEMOTRON_TOKEN
```

## Run (dev mode)

```bash
pnpm dev:api             # api on :8080 (stdio MCP by default)
pnpm dev:web             # web on :5173 with Vite dev server proxying /api → :8080
pnpm dev:mcp             # stdio MCP entrypoint
```

The api uses `LAIN_ADAPTER=mock` by default. To point at a real lain server:

```bash
LAIN_ADAPTER=real LAIN_URL=http://localhost:9999/mcp pnpm dev:api
```

## Use of Nemotron and Token Factory

Parallax is built for the **Coding and Agentic Engineering** track. The Nemotron investigator uses:

- **Nemotron 3 Super 120B-A12B** (`nvidia/nemotron-3-super-120b-a12b`) for the supervisor role — decomposition and structured planning.
- **Nemotron 3_5 Lightning** (`nvidia/Nemotron-3_5-Lightning`) for the worker role — many short calls, "execution layer" for always-on, long-running agents.
- **Nemotron 3 Ultra 550B-A55B** (`nvidia/Nemotron-3-Ultra-550b-a55b`) for heavy reasoning when budget allows.

All three are consumed through **Nebius Token Factory** (`NEMOTRON_TOKEN` env). The investigator loop respects a hard budget (8 tool calls, 120s per query) and persists every explanation with `revision` and `prompt_version` so the work is auditable.

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

## Roadmap

This is **subproject 1 of 7**. See `docs/superpowers/specs/2026-10-13-parallax-foundation-design.md` for the full scope and the seven subprojects.

| Subproject | Status |
|---|---|
| 1 — Foundation & Scaffolding | this repo, in progress |
| 2 — LainAdapter & Fixture (G0+G1) | awaits lain PRs #317/#318 merge |
| 3 — Assessment Worker & Persistencia (G2) | planned |
| 4 — Map UI & MCP de producto (G2) | planned |
| 5 — Nemotron Investigator (G3) | planned |
| 6 — PR Flow, Publicación & Demo (G4) | planned |
| 7 — Post-MVP (P1) | post-hackathon |

## License

MIT — see `LICENSE`.
