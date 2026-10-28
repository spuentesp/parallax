# Conversation memory, orientation and knowledge sources — plan

**Date:** 2026-10-28
**Status:** proposed. Phases 1–3 are scoped for the hackathon deadline (Oct 30, 10:00 PT); phase 4 is design only.
**Scope:** `packages/api` (conversations, briefing, knowledge interface), `packages/web` (thread, orientation screen), `packages/shared` (DTOs).

## 1. Why

The product is *the brain over a deterministic engine*: Lain knows what the code does; Parallax lets a person explore it, ask about it, and verify every answer. Two gaps stop that from working for the case that matters most — **a new engineer who must change something that spans repos**:

1. **No orientation.** The user lands on a map. The model is told what the workspace contains (the "workspace map" block in its prompt) but the *person* is not.
2. **No memory.** Each question is independent: "and the dashboard?" means nothing. A newbie works by narrowing — general → specific — and needs the thread.

Longer term, an organization's knowledge is not only code: wikis, ADRs, runbooks. That knowledge must be usable **without weakening the one property that makes Parallax trustworthy** (facts come from the engine, not the model).

## 2. The use case that drives everything (also the demo)

*"I'm new. I need to add a delivery note to checkout, and it crosses repos. Where do I need to be careful?"* — on Saleor (API, dashboard, storefront).

The ladder the product must support, general → specific:

| # | Question (as the user would ask it) | What the answer must be built from |
|---|---|---|
| 1 | What repos are there and what does each do? | orientation briefing (deterministic) |
| 2 | Where does checkout live, and who talks to it? | map + `consumers_of` → verified relations, focus on map |
| 3 | Which operations does the storefront use for checkout? the dashboard? | endpoints per consumer, evidence ids |
| 4 | Which files in the storefront call `checkoutLinesUpdate`? | evidence ids → file:line, "View source" |
| 5 | If I change that mutation, who else breaks? | `trace_impact` consumers across repos, with provenance |
| 6 | What am I not seeing? | coverage / unresolved: unindexed repos, inferred-only links |

Acceptance for the whole plan: this six-step session runs on the live Saleor workspace, follow-ups work without restating context, every relation claimed is engine-verified, and the final answer names the **repos and files** to be careful with.

## 3. Phase 1 — Conversation memory (target: ~½ day)

### Model
New tables (migration `drizzle/0003_conversations.sql`, mirrored in `db/schema.ts`):

- `conversation(id, owner, workspace_id, title, created_at, updated_at)`
- `turn(id, conversation_id, seq, question, answer, status, claims_json, evidence_json, focus_json, model, created_at)` with `UNIQUE(conversation_id, seq)`

`owner` is a **hash of the access token** (never the token). One token = one person's threads. Guidance for the demo: one token per judge, not one shared token.

### API
- `POST /api/query` gains optional `conversationId`. Absent → a new conversation is created and its id returned. Present → must belong to the caller (`owner`) and workspace, else 404 (not 403: don't confirm existence).
- `GET /api/conversations?workspaceId=` (mine), `GET /api/conversations/:id` (turns), `DELETE /api/conversations/:id`.
- Read-only tokens may converse (it is the demo); they cannot touch anything else.
- Limits: `QUERY_RATE_LIMIT_PER_HOUR` already applies; add max turns per conversation (default 50) and max conversations per owner (default 100), oldest evicted.

### What the model sees
The investigator receives `history`, inserted between the system prompt and the new question:

- **Last N turns verbatim** (N = 4): question + final answer.
- **Verified facts ledger**: the relation claims the engine *verified or contradicted* in earlier turns, as short lines (`saleor-dashboard → saleor-api: verified, 593 uses`). This is the part that makes follow-ups cheap and consistent, and it is engine output, not model prose.
- **Older turns** collapsed into one short summary line each (question + one-sentence outcome), generated deterministically from stored claims, **not** by the model (no extra model call, no drift).
- Hard cap on history tokens; drop oldest first. The workspace-map block is still injected every turn.

Memory never relaxes verification: every turn's claims are re-adjudicated by the engine; the ledger is context, not evidence, and the prompt says so.

### Web
- The hub assistant becomes a **thread** (loaded from the server, survives reload), with "New conversation" and a list of mine.
- Each answer keeps its engine verdicts and "Show on map".
- Follow-up chips under an answer (deterministic: next-hop questions such as "what else does X depend on?").

### Tests (AGENTS.md rules apply: real write path, mock only at the process edge)
- Turn written by `POST /api/query`, read back by `GET /api/conversations/:id` (write-then-read).
- Isolation: another token cannot read, continue or delete a conversation (404).
- History assembly is a pure function: ordering, truncation, ledger lines, token cap; the scripted model receives exactly the expected messages.
- A contradicted claim from turn 1 appears in the ledger as contradicted, not as a fact.

## 4. Phase 2 — Orientation (target: a few hours)

A **deterministic briefing**, no model, from the cached map graph (`GET /api/workspaces/:id/map/briefing`):

- Repos with the services they contain, endpoint counts, contract kinds.
- Cross-repo relationships summarized (`dashboard → api ×593 deterministic; dashboard → storefront ×8 inferred`).
- The "hubs": most-consumed services/endpoints.
- What is **not** known: unreviewed repos, repos configured but not indexed, inferred-only links. (INV 3: a gap is shown, never zero.)
- Freshness (`generatedAt`, stale).

UI: first thing shown in the assistant and a "Briefing" panel on the map. Below it, **starter questions generated from the graph** (templates over real names: "Who consumes `<hub>`?", "What does `<repo>` depend on?", "What would break if `<top endpoint>` changed?"). Clicking one asks it.

Optional (only if time remains): a single Nemotron call that turns the *same* briefing into two readable sentences per repo, clearly labelled as generated, never replacing the deterministic text.

Tests: briefing built from a real topology (fake engine at the transport edge); every number traceable to the graph; unindexed repos appear under "not known".

## 5. Phase 3 — The guided session as demo (target: with the deployment dry run)

- Run the six-step ladder on the live workspace; record actual answers; fix prompt/tool gaps that appear (this is how the text-tool-call and truncation bugs were found).
- Add the file-level step: answers carry `file:line` evidence ids; the UI renders them as links that open the source view. If an answer cannot name a file, it says so.
- Output: the script for the video (docs/hackathon/video-script.md) and a regression test that replays the ladder against a scripted model + fixture engine.

## 6. Phase 4 — Knowledge sources, RAG and a knowledge graph (design only for now)

**Principle:** documentation is *context*, code facts are *evidence*. They are labelled differently everywhere.

| | Observed (engine) | Documented (knowledge source) |
|---|---|---|
| Origin | static analysis of the code | wiki page, ADR, runbook, README |
| Verification | engine adjudicates every claim | none — shown with source and link |
| UI label | solid / "verified" | "documented · <source>" with a link |
| Can contradict the other? | yes — and that is a feature ("docs say A, code shows B") | |

**Interface** (defined now so connectors are plug-ins; no ingestion built before the deadline):

```ts
interface KnowledgeSource {
  id: string;                       // "saleor-docs"
  search(query: string, opts: { limit: number }): Promise<KnowledgeHit[]>;
}
interface KnowledgeHit { title: string; url: string; snippet: string; score: number; sourceId: string; updatedAt?: number }
```

The investigator gets one extra read tool, `search_docs`, whose results are marked `documented` and cannot be used as the anchor of a relation claim (only the engine can verify those).

**Retrieval:** SQLite **FTS5** (BM25) over chunked pages first — no vector DB, no new service. Embeddings (Token Factory) only if search quality needs them.

**Knowledge graph:** grows from the ids we already have. Nodes = engine nodes (repo/service/endpoint/symbol) + document entities; edges = `documents` links created by exact name match (service names, endpoint keys, repo names), each carrying its provenance (`engine` | `doc-match` | `inferred`). Same solid/dashed visual language: doc-match links are dashed until a human confirms.

**Candidate first connectors:** a docs folder in a repo (markdown), a GitHub wiki, Confluence/Notion export. Choose by what the first design partner actually uses.

## 7. Local vs remote

- **Hackathon: one hosted instance, multiuser by token.** Required (a demo URL), simplest to operate. Conversations are per token; no accounts.
- **Self-hostable by design:** the same image runs privately. Every dependency is a URL (`LAIN_URL`, `NEMOTRON_BASE_URL`), so an organization can run Lain and its own Nemotron inside its network. SQLite file = all state (workspaces, conversations); backup is a file copy.
- **Privacy note to state plainly:** with the hosted model, code *metadata and snippets the tools return* are sent to Token Factory. Raw repositories are not uploaded; Lain runs next to the code.
- Out of scope: desktop app, SSO, per-user accounts/roles, multi-tenant isolation beyond token-scoped conversations.

## 8. Schedule against the deadline (Oct 30, 10:00 PT = 14:00 GMT-3)

| Block | Work | Done when |
|---|---|---|
| A | Phase 1 backend: tables, `conversationId`, history assembly, isolation tests | six-step ladder keeps context across turns via API |
| B | Phase 1 web: thread, new/list conversations | thread survives reload |
| C | Phase 2 briefing + starter questions | first screen orients a newcomer |
| D | Phase 3: run the ladder live, fix gaps, record numbers | script validated end to end |
| E | **Deployment dry run on the Nebius VM** (runbook) | judge link works, Nemotron answers, rate limit on |
| F | Video recording, Devpost text, feedback section | submitted |

Blocks E and F are **reserved**: if A–D slip, cut C's optional model summary and D's polish, not E/F.

## 9. Risks

- **Model variance.** Answers differ run to run (one run contradicted 2 claims). Mitigation: verdicts are visible per claim; the ladder is rehearsed; prompt/tool fixes found by running it for real.
- **History bloat / drift.** Mitigation: ledger from engine output, deterministic summaries, hard token cap.
- **Shared judge token** → shared threads. Mitigation: one token per judge; document it in the testing instructions.
- **Deployment untested.** The Docker image/compose were not run in the dev environment; the dry run (E) is mandatory.
- **Lain dependency.** The demo needs Lain 0.13.0 and an indexed Saleor next to Parallax (cold index ≈ 2 min on a dev machine).

## 10. Out of scope (stated so it is not promised)

Cross-org activity digests ("what changed this week"), team/ownership metadata, doc ingestion, vector search, write-back to Lain's configuration, accounts and roles.
