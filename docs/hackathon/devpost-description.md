# Devpost submission text (copy into the form)

**Track:** Coding and Agentic Engineering (developer tools). Alternative if you prefer: Best Apps and Agents.

## Tagline
An architecture command center that turns a multi-repo org into a map anyone can navigate — and an AI investigator whose claims are checked against the code.

## Inspiration
Every large engineering org has the same problem: the knowledge of how things connect lives in a few people's heads. A new engineer assigned to a part of the stack they don't know, an architect trying to understand a service mesh that grew organically, a team that needs to "de-silo" — they all end up asking around, reading five repos, and still not knowing what depends on what.

## What it does
Parallax builds an explorable map of an organization's architecture from its code:

- **A hierarchical map**: repos → services → endpoints → code (files, functions), loaded lazily so it scales. Relationships between services are drawn solid when the static analysis proves them and dashed (fainter = less sure) when they are inferred. You can filter by either, or by contract kind (HTTP, GraphQL, topics…).
- **"Who consumes this?"** Select any endpoint and see the services that use it, across repos, with how sure the engine is.
- **An investigator you can talk to.** Ask a question in plain language. A Nemotron agent explores the code through the analysis engine's tools, then answers. Every relationship it asserts is **re-verified by the engine** — confirmed, contradicted, or unverifiable — and the answer can drive the map straight to the subgraph that backs it.
- **PR impact.** Assess a pull request against the other repos that consume what it changes, with the engine deciding the facts and the model only explaining them.

The point is not another chatbot over code: the model never decides what is true. The static-analysis engine does; the model explains and navigates.

## How we built it
- **Nemotron on Nebius Token Factory.** The investigator uses Nemotron 3 Super (planning / structured decomposition) and Nemotron 3.5 Lightning (fast worker calls) through the Token Factory OpenAI-compatible API, as a tool-calling loop with a hard budget (tool calls and wall-clock) and a persisted, auditable record of each explanation (model, prompt version, tool calls, citations). Nemotron 3 Ultra is configurable for heavier reasoning.
- **Engine-verified claims.** The agent finishes with a typed `submit_answer` (prose + claims). Relationship claims are adjudicated by the engine (`get_service`), and only verified claims can produce a "show on map" target.
- **Static analysis engine (Lain).** Provides the federated, multi-repo code graph and service/contract bindings, with the distinction between deterministic and heuristic bindings that the map preserves.
- **Stack.** TypeScript, Fastify, SQLite, React, Cytoscape (compound nodes) with our own stable layout, an MCP server for coding agents, ~1,400 tests.

## Challenges
Keeping the model honest. Early on the investigator "rediscovered" findings the engine already had and sometimes promoted an inference to a fact. We changed the contract: the engine's findings go in, the model explains by id, the backend composes every fact, and anything the model claims is re-checked. We also had to make a large graph readable: lazy loading, roll-up of collapsed nodes into counted relationships, and progressive disclosure of dense edges.

## Accomplishments
A map where "how sure are we?" is visible on every line; an agent whose claims carry the engine's verdict; and a clean separation between facts (engine) and explanation (model).

## What we learned
That the most useful thing an AI agent can do over a codebase is not to answer, but to answer *and show what backs the answer*.

## What's next
Cross-org "what changed this week" digests from merged PRs; ownership/domain metadata so questions like "which services belong to sales" resolve to teams, not just names; persistent cache across restarts; an MCP tool for the same map views.

## Nebius / NVIDIA usage
- NVIDIA Nemotron 3 Super and Nemotron 3.5 Lightning (Ultra configurable), served via **Nebius Token Factory**.
- Deployed on **Nebius AI Cloud**. <!-- confirm: Serverless Endpoint / VM -->

## Feedback on Nebius Token Factory and NVIDIA tools
<!-- Fill with your real experience before submitting — see docs/hackathon/feedback-notes.md for prompts. -->

## Testing instructions
Open: `<DEMO_URL>/orgs/ws_saleor?token=<READ_ONLY_TOKEN>` (read-only; signs you in automatically). If prompted for an access token, paste `<READ_ONLY_TOKEN>`. Try: *"Which services consume the checkout API, and from which repos?"* then click **Show on map**.
