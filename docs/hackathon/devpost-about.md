# Devpost "About the project" (paste-ready)

Paste everything below the line into the Project Story field. Search for `TODO` before pasting: each one needs a real value or must be deleted.

---

## Inspiration

It started with a problem I kept hitting: **understanding blast radius in very large codebases**. It is a long-standing weakness of coding agents. To know what a change touches, you have to follow call chains across many repos, and doing that inside an LLM's context window fills it long before you are done. I started building Parallax to review those cross-repo call chains *without* dumping the code into the model.

Then Parallax took its real shape from something more personal: **every onboarding I have had, in every org, was unclear.** The knowledge of how things connect lives in a few people's heads, and you spend weeks hunting for the right expert. I wanted that to disappear. Instead of looking for the person who knows, you ask:

> *"I need to add logging and telemetry to the payment endpoint and its consumers. Where should I add this?"*

## What it does

Parallax is an architecture command center for multi-repo organizations. It builds an explorable map from the code itself:

- **A hierarchical map:** repos → services → endpoints → code (files and functions), loaded on demand so it scales. Solid lines are relationships the static analysis proves. Dashed lines are inferred, and fainter means less sure.
- **"Who consumes this?"** Select any endpoint and see the services that use it across repos, with how sure the engine is.
- **An investigator you can talk to.** Ask in plain language. A Nemotron agent explores the code through the analysis engine's tools, then answers. Every relationship it asserts is re-checked by the engine: **verified, contradicted, or unverifiable**. A verified answer can drive the map straight to the part of the architecture that backs it.
- **PR impact.** Assess a pull request against the repos that consume what it changes. The engine decides the facts, and the model only explains them.

The model never decides what is true. The static-analysis engine does. The model explains and navigates.

## How I built it

- **Nemotron on Nebius Token Factory.** The investigator uses Nemotron 3 Super for planning and Nemotron 3.5 Lightning for fast worker calls, through the Token Factory OpenAI-compatible API. It runs as a tool-calling loop with a hard budget on tool calls and wall-clock time. Each explanation is stored with its model, prompt version, tool calls and citations, so it can be audited. Nemotron 3 Ultra is configurable for heavier reasoning.
- **Engine-verified claims.** The agent finishes with a typed `submit_answer` (prose plus claims). Relationship claims are adjudicated by the engine, and only verified claims can produce a "show on map" target.
- **Static analysis engine (Lain)** provides the federated, multi-repo code graph and the service and contract bindings, keeping the difference between deterministic and heuristic bindings that the map shows.
- **Access control.** The app is token-gated: with no valid token nothing is shown, and reviewers get a read-only token. SSO is the intended path for internal use.
- **Stack:** TypeScript, Fastify, SQLite, React, Cytoscape with a custom stable layout, and an MCP server so coding agents can use the same graph.
- **Runs on Nebius AI Cloud.** TODO: confirm once deployed (VM or Serverless), or delete this line.

## Challenges

- **Keeping the model honest.** Early on, the investigator "rediscovered" findings the engine already had, and sometimes promoted an inference to a fact. I changed the contract: the engine's findings go in, the model explains by id, the backend composes every fact, and anything the model claims is re-checked.
- **Keeping large graphs readable.** Real services can have hundreds of endpoints. I solved it with lazy loading, roll-up of collapsed nodes into counted relationships, and progressive disclosure of dense edges.
- **Blast radius without the context window.** The agent has to answer questions about code it never reads in full. That meant giving it tools and a graph to query instead of text.

## What I learned

The most useful thing an AI agent can do over a codebase is not just to answer. It is to answer *and show what backs the answer*. Trust comes from the evidence, not from the model's tone.

## What's next

Cross-org "what changed this week" digests from merged PRs; ownership and domain metadata so a question like "which services belong to sales" resolves to teams, not just names; a persistent cache across restarts; and an MCP tool that exposes the same map views to coding agents.
