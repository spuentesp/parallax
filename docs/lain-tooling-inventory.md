# Lain tooling inventory

Date: 2026-10-28. Lain **0.13.0** (live server loaded with every package: `list_packages` + `load_package` for each, then `tools/list`). Method and caveats at the end.

## Bottom line

- Lain exposes **97 tools** (90 on the live 0.13.0 server once every package is loaded; 7 more in the federation set that `docs/tool-schema.json` lists).
- Parallax references **34** of them in production code; **63** are not referenced at all.
- **Nothing in the adapter is fake.** Every wrapper was called against the live server with real arguments and returned data (results below). The implementation is real; the *coverage* is narrow.
- Until 2026-10-28 the investigator (the model that answers questions) could call only **9 Lain tools**, all from the contract view. It could not search code, find a symbol, follow a call or measure a change. It now has **24** (9 contract + 15 code, read-only, allowlisted).
- The product (map, assessments, advisor, native flow, contract remediation) uses **16** Lain tools. The code layer of the map uses only `query_graph` + snippets.

## Verified working against the live server (Saleor: 3 repos)

| Parallax wrapper | Lain tool | Result |
|---|---|---|
| `listServices` | `list_services` | OK |
| `getService` | `get_service` | OK (3.8 s, 660 KB: the heaviest call) |
| `listContracts` | `list_contracts` | OK |
| `getContract` | `get_contract` | OK |
| `listUnresolved` | `list_unresolved` | OK |
| `getCoverage` | `get_coverage` | OK |
| `traceImpact` | `trace_impact` | OK (28 paths for `graphql:query:products`) |
| `resolveEvidence` | `resolve_evidence` | OK |
| `readSource` | `read_source` | OK |
| `describeSchema` | `describe_schema` | OK |
| `queryGraph` | `query_graph` | OK |
| `getCodeSnippet` | `get_code_snippet` | OK |
| `explainSymbol` | `explain_symbol` | OK |
| `getCallSites` | `get_call_sites` | OK |
| `codeTool` (15 allowlisted) | `understand_repository`, `search_code`, `find_symbol`, `search_org`, `find_anchors`, `list_entry_points`, `get_context`, `get_call_chain`, `get_blast_radius`, `get_cross_repo_blast_radius`, `find_related`, `get_coupling_radar`, `explain_symbol`, `get_call_sites`, `get_code_snippet` | all OK |

Not smoke-tested here: `prepare_snapshot`, `get_snapshot`, `diff_contracts`, `check_binding` (they need pinned commits or a proposal; they are exercised by the assessment worker and advisor gates, `pnpm gate:saleor`, last recorded as passing in the handoff note) and `load_package` (called by the client at connect time).

## Operator performance controls

These variables belong to the **Lain server process**, not the Parallax MCP client. `install.sh` passes them through both the systemd unit and the no-systemd launch path.

| Control | Default | Effect |
|---|---|---|
| `LAIN_DISABLE_LSP` | `0` | `1` disables every Lain-spawned language server; indexing falls back to tree-sitter. |
| `LAIN_LSP_LEAN` | `0` | `1` keeps LSP with rust-analyzer's memory-saving profile, at the documented cost of symbol fidelity. |
| `LAIN_INDEX_TIMEOUT` | `60` | Per-repository indexing pipeline budget in seconds. |
| `LAIN_INDEX_TIMEOUT_SEC` | `1800` | Separate installer wait for the whole demo to become ready; it does not configure Lain. |

## Product + investigator (8)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `get_coverage` | PR assessments + investigator | What the view saw and what it could not resolve (§9.7). With an `endpoint`, `complete` reflects the could-match gate. |
| `get_service` | map topology (consumers, call sites) | Consumers of one service: endpoints, calling code, fields used, and the `used_by` walk that explains why each caller run |
| `list_contracts` | map topology (endpoints) | Endpoints the federation exposes, filterable by service, repo, and kind (http/topic). |
| `list_services` | map topology | Every service in the federation with its repo, paths, endpoint count and consumer counts. Works on `live` and named snap |
| `list_unresolved` | investigator; map "unresolved" counts | Every ambiguous and unresolved consumer with the candidate endpoints that could match (§9.7). |
| `read_source` | assessments + investigator | A bounded line range of a file at a view's commit (§10.7). Refuses secrets and binaries; reads snapshot content from the |
| `resolve_evidence` | assessments + investigator + claim verification | Check refs exist at their commit; return context. Bad refs are `exists: false` with a reason, never an error (§12). |
| `trace_impact` | PR assessments + investigator | Impact paths from an endpoint, field, or symbol (§5.2 + §12). Exactly one of endpoint/field/symbol is required. |

## Investigator (1)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `get_contract` | investigator | Providers, schema fields, and bound consumers for one endpoint (§12). |

## Investigator (added 2026-10-28) (15)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `explain_symbol` | map: source peek | Combines signatures, docstrings, and metrics into a human-readable architectural summary |
| `find_anchors` | — | Use this when asking 'what should I read first?': the most foundational, stable components by corpus-wide anchor score. |
| `find_related` | — | Graph neighbors, co-change partners, and (optional) semantic neighbors for a symbol in one call. Use this when an agent  |
| `find_symbol` | — | Returns every graph node matching `name`, optionally narrowed by `path_hint` (substring) and `type_filter` (function / s |
| `get_blast_radius` | — | Use this when you want to know what breaks if you change a symbol: direct and transitive dependents. For an exact A-to-B |
| `get_call_chain` | — | Use this when you need the exact call path between two symbols (`from` to `to`). Traces within one repository — pass `re |
| `get_call_sites` | — | Finds all callers of a given symbol |
| `get_code_snippet` | map: source peek | Reads a file with surrounding context around a specific line |
| `get_context` | — | One-call dossier for a symbol: definition, callers, callees, and source body excerpt. Use this when an agent says 'expla |
| `get_coupling_radar` | — | Use this when asking 'what changes together?': hidden coupling between files from historical git co-change. `find_relate |
| `get_cross_repo_blast_radius` | — | Use this when you want to know what breaks across repositories: resolve a symbol, traverse INCOMING Calls edges (its cal |
| `list_entry_points` | — | Use this when asking 'where does execution start?': main/App-style entry points and top-level routes. |
| `search_code` | — | Find code by name, intent, or pattern. `mode=lexical` (default) uses the graph name index and works without an embedding |
| `search_org` | — | Case-insensitive substring search across every repo's symbols (matched on name or path). Args: query (substring), limit  |
| `understand_repository` | — | One-call bootstrap context: repository identity, top anchors, entry points, capability states, and the intent->tool mapp |

## Product (no investigator access) (5)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `check_binding` | advisor (proposes repos.yaml bindings) | Validate a proposed consumer→endpoint link and emit the YAML for `repos.yaml#bindings` (§12). Pure; creates nothing. |
| `diff_contracts` | PR assessments | Provider and consumer changes between two snapshots, classified, with impact paths and coverage (§12). `live` is not all |
| `get_snapshot` | PR assessments | Read a snapshot's current state. The `snapshot` argument is required; same shape as `prepare_snapshot` returns. On `live |
| `prepare_snapshot` | PR assessments | Pin every repo to a commit, index once, reuse the result. Same inputs after ref resolution produce the same id (§8.4); ` |
| `query_graph` | map code layer (folders/files/symbols) | Execute a query against the graph using a JSON ops array |

## Wrapper exists, no caller (2)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `describe_schema` | — | Returns the graph schema (node types, edge types, example queries) for LLM session initialization |
| `load_package` | — | Opt a package (verify, arch, raw, notes, session, social, ops) into this session's tools/list, then refetch it. |

## Not used (66)

| Tool | Used for | What Lain says it does |
|---|---|---|
| `add_annotation` | — | Add an annotation (note / warning / todo / investigation / fix) targeting a symbol, file, repo, or edge. Body is 1..=409 |
| `architectural_observations` | — | Analyzes the codebase for architectural patterns, cross-boundary couplings, and high-fan-out modules |
| `assess_change` | — | Pre-edit impact assessment: direct + transitive dependents, untested dependents, co-change partners, and a one-line risk |
| `claim_files` | — | Announce intent to edit (or read) files/symbols. Returns `granted`, `conflicts` (other agents already holding an edit cl |
| `compare_modules` | — | Compares stability and coupling metrics between two modules |
| `debug_sleep` | — | Sleep for the given number of seconds (useful for testing job infrastructure). |
| `detect_overlap` | — | Detect symbol-level overlap between two git refs in a workspace. Args: base (required), head (defaults to HEAD), workspa |
| `explain_dispatch` | — | Synthesises static callers, heuristic edges, runtime edges, and co-change partners for a symbol and returns a single ver |
| `explore_architecture` | — | Returns a high-level tree of files and modules up to a specific depth |
| `find_dead_code` | — | Use this when asking 'what is unused?': nodes with zero incoming callers, test code excluded. |
| `find_untested_functions` | — | Identifies functions that may lack test coverage based on call graph analysis |
| `get_active_workspace` | — | Return the workspace the server is currently holding (the one whose repos were loaded). Errors with NoActiveWorkspace if |
| `get_agent_strategy` | — | Return the recommended tool sequence and quick-reference for working with Lain. |
| `get_anchor_score` | — | Returns the architectural stability score for a specific symbol |
| `get_audit_log` | — | Read the server's audit log (per-write events appended by the claim_files handler when a claim is granted). Args: since_ |
| `get_branch_status` | — | Shows current branch and git status |
| `get_capabilities` | — | Return the current repository capability states, freshness, and indexing progress. Warming states are retryable. |
| `get_commit_history` | — | Shows recent commit history with author and message |
| `get_context_depth` | — | Calculates layers of abstraction from the entry point for a symbol |
| `get_context_for_prompt` | — | Builds LLM-optimized context for a symbol with signature, docstring, and relationships |
| `get_coverage_summary` | — | Provides a structural estimate of code coverage based on call graph connectivity |
| `get_cross_runtime_callers` | — | Find all protocol-level callers for a symbol (HTTP routes, gRPC services, GraphQL resolvers) |
| `get_federation_health` | — | Aggregate health counts and total node/edge counts across the federation, plus a rough memory estimate. |
| `get_file_diff` | — | Shows uncommitted changes (staged and unstaged) |
| `get_health` | — | Return server health, node/edge counts, last enriched commit, and language-server availability. |
| `get_job_status` | — | Get the current status and output of a previously-spawned background job. |
| `get_layered_map` | — | Returns a 'slice' of the architecture at a specific depth from the entry point |
| `get_master_map` | — | Get a high-level Staleness Report showing when each module was last synced from LSP and Git |
| `get_pending_handoffs` | — | List open handoff notes from prior agents. Filters: scope (workspace / repo:<id> / agent_kind:<k>), since_unix_ms. Retur |
| `get_recent_activity` | — | Compact digest of the audit log: groups recent edit_landed events by path (default), agent, or hour and returns a count  |
| `get_reload_status` | — | Returns the current reload subsystem state: state (idle / rebuilding / failed), started_at, last_reload_at, last_error,  |
| `get_repo_info` | — | Get info about a single repository in the federation by id. |
| `get_server_status` | — | Returns the server's run-time status: pid, transport, port, started_at, last_sync_at, last_error, repo_count, workspace_ |
| `get_test_template` | — | Generates a test scaffold for a given function or type |
| `get_workspace` | — | Full detail on one workspace by name: description?, source?, members: [{repo_id, path, health}]. Errors with NotFound if |
| `get_workspace_graph` | — | Per-workspace graph for the dashboard. Returns {nodes: [...], edges: [...], truncated: bool}. Filters to Function/Method |
| `get_world_state` | — | Read-only companion to claim_files: returns the same WorldState shape (retracted symbols, overlay-delta changed_symbols  |
| `heartbeat` | — | Refresh the session. lain expires sessions 60 seconds after the last heartbeat. |
| `install_language_server` | — | Install one or more language servers. Pass a single `{language}` to install one extension, or `extensions: ['rs','py','g |
| `lain_intent` | — | Declare or update an intent (goal + scopes + status). The response carries the live coordination level (GREEN / YELLOW / |
| `leave_handoff_note` | — | Leave a workspace-scoped note for the next agent that registers. Stored as an open Note annotation; expires after 24h. B |
| `list_active_agents` | — | List agents currently connected. Set include_background=true to also see cron/CI agents. |
| `list_active_intents` | — | Per-agent activity feed: for each connected agent, returns intent {goal, scopes, status}, focus (most-recent observation |
| `list_annotations` | — | List annotations with optional filters: target (symbol / file / repo / edge), author, kind, status, limit (default 100). |
| `list_occupancy` | — | Show which agents are in a file or the whole workspace. Pass `path` to scope to one file, or omit it for everything. Eac |
| `list_packages` | — | The skill menu: every capability package with its pitch, level, why it is off by default, and its tools. |
| `list_recent_projects` | — | List projects the operator has used recently, with per-project workspace_count and repo_count pulled from each project's |
| `list_repos` | — | List every repository currently registered in the federation, with id, path, health, and graph stats. |
| `list_subagents` | — | List active subagents whose parent_session_id matches the caller's session. Args: session_token. Returns: { parent, suba |
| `list_workspaces` | — | List all known workspaces from workspaces.yaml. Returns [{name, description?, source?, member_count, is_active}]. |
| `my_claims` | — | List files this agent has claimed. |
| `navigate_to_anchor` | — | Finds the most foundational 'Anchor' node that controls a given leaf function |
| `register_agent` | — | Register this agent with lain. Returns an agent_id and session_token to use on every subsequent call. `kind` and `mode`  |
| `register_job_webhook` | — | Register a webhook URL to receive notifications when background jobs complete. |
| `release_files` | — | Release claims. Other agents get a notification. |
| `request_reload` | — | Schedule a hot-reload of repos.yaml and workspaces.yaml. The actual rebuild runs on a background task; the call returns  |
| `resolve_annotation` | — | Mark an open annotation as resolved by the calling agent (or by `resolved_by`). Returns { resolved: Annotation }. Annota |
| `run_build` | — | Runs cargo build (optionally release) and returns build output and status |
| `run_clippy` | — | Runs cargo clippy with optional auto-fix and returns lint results with architectural context on failure |
| `run_enrichment` | — | Triggers a full architectural scan and enrichment pass |
| `run_tests` | — | Runs cargo test with optional filter and returns test results |
| `suggest_refactor_targets` | — | Identifies 'God Objects' and high-debt refactor targets based on complexity and stability |
| `sync_state` | — | Forces a re-sync of the graph with the current Git HEAD state |
| `trace_dependency` | — | Recursively finds everything a symbol depends on |
| `unregister_agent` | — | Tear down an agent session: releases every claim, drops intent + activity entries, removes the presence session. |
| `who_am_i` | — | Resolve a session_token to the agent it belongs to, plus their current claims. |

## What is worth wiring next (from the unused set)

Ranked by what a new engineer or a reviewer would feel:

1. **`get_cross_runtime_callers`**: links a GraphQL operation / HTTP route to the code that implements it. This is the missing edge between the contract layer and the code layer on the map.
2. **`assess_change`** and **`find_untested_functions`**: pre-edit impact with *untested dependents* and co-change partners. It is the "risk" half of the onboarding task answer ("add a delivery note to checkout").
3. **`search_code` with `mode: semantic`**: needs the ~120 MB embedding model (`lain` reports `semantic_search: unavailable_optional`). The tool is already in the investigator's allowlist; it falls back to lexical.
4. **`get_health` / `get_capabilities` / `get_master_map`**: readiness and staleness per capability. The Repositories page could show "call graph ready, semantic search not installed, index N commits behind".
5. **`find_dead_code`**, **`architectural_observations`**, **`suggest_refactor_targets`**, **`compare_modules`**: "loose ends" and hotspots for the map (and the classifier planned for unresolved calls).
6. **`list_repos`**, **`get_repo_info`**, **`get_federation_health`**, **`get_workspace_graph`**: Parallax keeps its own repo/status model; these would replace parts of it. Low priority.

Not for Parallax: the coordination set (`register_agent`, `heartbeat`, `claim_files`, `lain_intent`, annotations, handoff notes, occupancy, audit log; ~25 tools) exists so several coding agents do not edit the same files. `run_build`, `run_tests`, `run_clippy` run Cargo and write to the repo. Parallax is read-only by design, so these stay out.

## Findings worth knowing

- **`describe_schema` has a wrapper and no caller.** It was useful only for exploring `query_graph` by hand (it lists node types, edge types and example queries).
- **Namespaces in the code graph are directories**, and `Contains` edges give the folder tree. Names repeat (many `components`), so Parallax compares nodes by id. Nodes carry a `test` label on functions and classes, which could replace the filename heuristic for hiding tests.
- **The engine's HTTP sensor reports route-like strings** (`http:ANY /click`, `/0`, `/14:00`, `/Action handler thrown`): `HttpRoute` nodes whose providers are `operandExclusions.test.ts:126` and `useSuppressClickAfterDrag.ts:33`. That is a Lain sensor false-positive class (event names and test data in browser code); Parallax now groups them separately and says why.
- **The inferred line `saleor-dashboard → saleor-storefront` is almost certainly spurious.** Its 8 uses are `HttpClientCall`s with *unbound host* (`GET /`) in `e2e/lib/docker.ts`, `scripts/fetch-local-schema.cjs`, `src/graphql/authFetch.ts`…, matched to the storefront's catch-all `http:ANY /` at confidence 0.6. These are calls to arbitrary hosts, not to the storefront. This is exactly the dangling-relationship case the loose-ends classifier should label.

## Native 0.13 integration added in this change

- `traceFlow` calls Lain's native `trace_flow` with endpoint, symbol, or table seeds, `breadth`/`depth`, direction, depth, and cap. It is available at `POST /api/workspaces/:id/trace/flow[/stream]` and as `parallax_trace_flow`. The opt-in web visualizer renders native paths, provenance, gaps, and truncation; the existing model-verified trace remains available.
- `applyContractContext` calls native `apply_contract_context` with `provides`, `host_aliases`, and `bindings`. Dry-run is the default. The write-scoped API and contract editor return Lain's YAML/apply response; atomic write, backup, re-join, and rollback belong to Lain, not a second Parallax store.
- `listServiceRefs` calls native `list_service_refs`, exposed at `GET /api/workspaces/:id/service-refs` and as `parallax_list_service_refs`. `GET /api/workspaces/:id/http-routes` exposes native HTTP provider discovery, including Next.js App Router `route.ts` files.
- The adapter handshake requires all 16 contract-package tools, so an older server fails explicitly instead of silently degrading the new workflows.
- Protocol, schema, API, MCP, and UI behavior is covered by tests. A live 0.13 server was not available in this checkout (the installed CLI is 0.12.1); run `LAIN_URL=http://localhost:9999/mcp pnpm demo:lain` for the real-server check. The demo prints the actual engine response and writes nothing.
- Lain supports Next.js **App Router** but explicitly not Pages Router. No disconnected local Pages parser is advertised as integrated; Pages support needs an upstream Lain sensor change.

## Method and caveats

- Live tool list: JSON-RPC `tools/call list_packages`, `load_package` for every package, then `tools/list` on the 0.13.0 server (90 tools). The 7 extra names come from `docs/tool-schema.json` (`list_workspaces`, `get_workspace`, `get_active_workspace`, `get_workspace_graph`, `list_repos`, `get_repo_info`, `get_federation_health`), which are not in `tools/list` for this configuration.
- Usage: a search of `packages/*/src` (tests, mocks, scripts excluded) for each tool name as a string or object key, then for each adapter method, the callers outside `lain-adapter/`. "Used for" is read from those call sites.
- The investigator list is `packages/api/src/agent/dispatcher.ts` + `agent/code-tools.ts`. `consumers_of` is a Parallax-side summary built on `get_service`, not a Lain tool.
- Lain's own descriptions are quoted from the server; they are not Parallax's claims.
