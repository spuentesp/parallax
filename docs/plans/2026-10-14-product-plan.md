# Parallax — Product Plan for Nebius x NVIDIA Hackathon

**Date:** 2026-10-14
**Deadline:** 2026-10-30 10:00 PT (16 days)
**Product:** Architectural command center for organizational code topology

---

## 1. Product Vision

**Parallax is the central command center for organizational code architecture.**
LAIN is the engine. Parallax consumes LAIN and makes it visual, interactive,
and intelligent.

### What Parallax does

| Capability | Description | Judge criterion |
|---|---|---|
| **Topology visualization** | See complete org topologies: between repos AND within repos. Code, components, relationships. | Design (25%) |
| **Architecture Q&A** | Ask "what microservices serve this use case?", "what lacks CI?", "what protocols does this org use?" — Nemotron answers with evidence. | Quality of the Idea (25%) |
| **MCP for agents** | External agents (Claude, Codex) query Parallax for architecture insights. | Technological Implementation (25%) |
| **CI/PR comments** | When connected to CI, comment on PRs when changes impact non-obvious elements. | Potential Impact (25%) |

### The architecture

```
┌─ Parallax (product) ──────────────────────────────────────────┐
│  UI: Topology graph · Chat Q&A · Code view · Workspace mgmt   │
│  API: REST + MCP HTTP/SSE                                     │
│  Agent: LangGraph + Nemotron (via Token Factory)              │
│  DB: SQLite (workspaces, repos, assessments, events)          │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP (13 contract + 22 core tools)
                              ▼
┌─ LAIN (engine) ──────────────────────────────────────────────┐
│  • Code graph: 91K nodes / 232K edges (Saleor)               │
│  • Protocol sensors: GraphQL 7,549 · proto 346               │
│  • Blast radius · call chains · co-change · semantic search   │
│  • Federated: multi-repo + multi-service workspaces           │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Priority

### P0 — Core product (must ship)

| # | Feature | What it does | Story |
|---|---|---|---|
| 1 | **Workspace management UI** | Create workspaces, add repos with URIs (local `./path` or web `https://github.com/...`), configure LAIN. | "As an architect, I configure my org's workspaces in Parallax." |
| 2 | **Real topology from LAIN** | Replace fixture topology with live data from LAIN: services, consumers, endpoints, protocols. | "I see my org's real service topology." |
| 3 | **Architecture Q&A with Nemotron** | Ask questions like "what microservices serve this use case?" and get answers grounded in LAIN data. | "I ask Parallax architectural questions and get evidence-backed answers." |
| 4 | **MCP tools for agents** | 4 product tools that external agents can call: `parallax_explore`, `parallax_assess_pr`, `parallax_get_assessment`, `parallax_get_evidence`. | "My coding agent asks Parallax about architecture." |

### P1 — Demo polish (should ship)

| # | Feature | What it does |
|---|---|---|
| 5 | **PR impact comments** | When connected to CI, comment on PRs when changes impact non-obvious elements. |
| 6 | **Code view** | Browse files, see git blame, view contract schemas. |
| 7 | **Assessment dashboard** | List past assessments, filter by org/status, see coverage. |

### P2 — Stretch (nice to have)

| # | Feature | What it does |
|---|---|---|
| 8 | **Multi-model Nemotron** | Super for planning, Lightning for execution, Ultra for deep analysis. |
| 9 | **LangSmith tracing** | Visual trace of Nemotron calls (model, latency, tokens, cost). |
| 10 | **ExploreAgent** | Auto-discover architecture when a new repo is added. |

---

## 3. Architecture Q&A — The Killer Feature

This is what makes Parallax a product, not a LAIN dashboard. The agent
understands architecture questions and answers with evidence from LAIN.

### Example questions and how they map to LAIN tools

| Question | LAIN tools used | Answer shape |
|---|---|---|
| "What microservices serve customer data?" | `list_services`, `get_service`, `get_blast_radius` | Topology + narrative |
| "What lacks CI?" | `list_services`, `find_anchors`, git analysis | List of repos without CI config |
| "What communication protocols does this org use?" | `list_services`, `get_coverage` | Protocol breakdown (GraphQL 7549, gRPC 346, HTTP) |
| "What breaks if I change customer_id in orders?" | `diff_contracts`, `trace_impact`, `get_service` | Impact graph + affected consumers |
| "What's the authentication flow?" | `search_org`, `find_symbol`, `get_call_chain` | Call chain + code refs |
| "Where do we have duplicate functionality?" | `list_services`, `find_anchors`, `get_service` | Overlap analysis |

### The agent flow (LangGraph)

```
[user question] → [planner] → [tool_call lain] → [analyze] → [curate] → [respond]
                       ↑                          ↓ (need more)
                       └──────────────────────────┘
```

- **planner** (Nemotron Super 120B): decomposes question into LAIN queries
- **tool_call**: executes via LainAdapter (13 contract + 22 core tools)
- **analyze** (Nemotron Lightning): interprets results, decides if more exploration needed
- **curate**: filters to what matters (top-K by relevance, fan-out threshold)
- **respond**: natural language + TopologyView + evidence

### Curation (what makes the graph readable)

Not the whole codebase — only what matters to the question:
- Top-K services by relevance to the question
- Fan-out threshold for edges
- Focus by service/symbol mentioned in the question
- Protocol breakdown when asked about communication

---

## 4. Workspace Management

Parallax is the **control plane**. Users configure workspaces in the UI.
LAIN consumes that config.

### Data model

```typescript
Workspace {
  id: string;
  name: string;           // "Saleor", "Online Boutique"
  description?: string;
  repos: Repo[];
}

Repo {
  id: string;
  workspaceId: string;
  uri: string;            // "https://github.com/saleor/saleor.git" or "./repos/saleor"
  sha?: string;           // pinned SHA for reproducibility
  local?: string;         // local path when URI is web
}
```

### UI

- `/workspaces` — list of workspaces with repo counts
- `/workspaces/:id` — workspace detail: repos, services, topology
- `/workspaces/new` — create workspace form (name, add repos with URIs)
- `/workspaces/:id/repos/new` — add repo form (URI, SHA, local path)

### LAIN integration

Parallax generates `repos.yaml` from its DB and passes it to LAIN:

```yaml
data_dir: /var/parallax/lain-data/<workspace-id>
repos:
  - id: saleor
    source:
      type: workspace_dir
      path: /var/parallax/repos/saleor
services:
  - name: saleor-api
    repo: saleor
    paths: ["saleor"]
```

---

## 5. Timeline (16 days to deadline)

| Day | Focus | Deliverable |
|---|---|---|
| 1-2 (Oct 14-15) | Workspace mgmt UI + LAIN config generation | Create workspaces in UI, see them in topology |
| 3-4 (Oct 16-17) | Real topology from LAIN + code view | Topology shows real services/contracts, code browser |
| 5-7 (Oct 18-20) | Architecture Q&A with Nemotron | Ask "what microservices serve X?" and get evidence-backed answer |
| 8-9 (Oct 21-22) | MCP tools for agents | External agents can query Parallax |
| 10-11 (Oct 23-24) | PR impact comments + CI integration | Comment on PRs with impact analysis |
| 12-13 (Oct 25-26) | Demo polish + assessment dashboard | Smooth demo story, past assessments |
| 14-15 (Oct 27-28) | Testing + E2E + bug fixes | All tests green, demo runs clean |
| 16 (Oct 29-30) | Freeze, record video, submit | ≤3min video on YouTube, Devpost submission |

---

## 6. Demo Story (175 seconds)

| Time | Screen | What judge sees |
|---|---|---|
| 0-20s | Workspace list | Two workspaces: Saleor (3 repos) + Online Boutique (11 services) |
| 20-50s | Topology view | Real service graph with relationships, protocols visible |
| 50-90s | Ask "What microservices serve customer data?" | Nemotron analyzes LAIN data, returns topology + narrative |
| 90-120s | Ask "What protocols does this org use?" | Protocol breakdown: GraphQL 7549, gRPC 346, HTTP 328 |
| 120-150s | Show PR impact | Diff between two SHAs, impact on cross-repo consumers |
| 150-175s | MCP tool call | External agent queries Parallax via MCP, gets topology |

---

## 7. Judging Criteria Alignment

| Criterion (25% each) | How Parallax wins |
|---|---|
| **Technological Implementation** | LAIN integration (9 tools, 13 contract + 22 core), Nemotron via Token Factory, LangGraph orchestration, SQLite persistence, MCP server, real-time topology |
| **Design** | Modern UI (Tailwind + reagraph + dark/light), command center aesthetic, smooth demo flow |
| **Potential Impact** | Real org (Saleor, Online Boutique), real architecture questions, PR impact analysis — solves real problems for real teams |
| **Quality of the Idea** | "The model proposes, the system certifies" — Nemotron + LAIN evidence. Architecture Q&A grounded in code, not hallucinated. Non-obvious use of Token Factory for agentic code investigation. |

---

## 8. Success Criteria

- [ ] User can create workspaces in UI with repo URIs (local + web)
- [ ] LAIN indexes the configured workspaces automatically
- [ ] Topology view shows real services/contracts/protocols
- [ ] Architecture Q&A answers with evidence from LAIN
- [ ] MCP tools work for external agents
- [ ] PR impact comments work when CI is connected
- [ ] Demo runs in ≤175 seconds
- [ ] All tests pass (159 current + new)
- [ ] Deployed on Nebius AI Cloud DevPod
- [ ] Public GitHub repo with MIT license
- [ ] YouTube video ≤3 minutes
- [ ] Devpost submission completed
