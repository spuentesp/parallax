# Report for the Lain agent: what the Parallax dashboard needs from Lain

**From:** the Parallax dashboard work (branch `spuentesp/fix-parallax-lain-dashboard`)
**To:** an agent or maintainer working on Lain
**Lain measured:** 0.15.0 (`analyzer_version` `0.15.0+03387656d81d81a1+c10`), HTTP transport, `live` view
**Builds on:** `docs/lain-0.15-engine-findings.md` (same author). This report contains all of its
items (§4-§10 here) and adds the query, schema, ledger and symbol-identity findings (§1-§3, §9, §11-§13).

Everything below was measured on real indexes, not inferred. Where something is a hypothesis it
says **(hypothesis)**; where I could not test it it says **(not verified)**.

---

## 0. How to read this

Parallax is a dashboard over Lain. A design reference (10 screens) says what the dashboard should
show. For each screen I checked whether Lain provides the data. The result is that Lain already
has most of it, and the gaps cluster in three places that **block a screen** (§1-§3), a set that
**makes shown numbers wrong or noisy** (§4-§9), and a few smaller items (§10-§13).

A note on an earlier statement of mine: I had told the dashboard's owner that the Query screen had
"no backend". That was wrong. `query_graph` has the same `find -> connect -> filter -> group -> sort
-> limit` shape the screen draws, but it cannot express that screen's query (§1).

### Summary

| # | Priority | Issue | Blocks |
|---|---|---|---|
| 1 | **P1** | `query_graph` cannot see federation bindings; no aggregation; unknown filter fields silently ignored | Query screen |
| 2 | **P1** | GraphQL contracts rarely have a schema; response only; weak field types | Contract detail |
| 3 | **P1** | Live coverage ledger has no per-repo sensors/skips (pinned snapshot only) | Coverage |
| 4 | P2 | Rust wrapper gRPC clients are not followed (0 bound consumers) | accuracy |
| 5 | P2 | Rust std methods (`unwrap`, `map_err`) read as RPC stubs | noise |
| 6 | P2 | Variable host with a literal default is not seen as external | noise |
| 7 | P2 | `check_binding` accepts root catch-all routes | wrong suggestions |
| 8 | P2 | Calls inside one service are counted as unresolved | headline number |
| 9 | P2 | Symbols are resolved by name only (co-change / cross-repo) | wrong attribution |
| 10 | P3 | `list_service_refs` with `suggestions` costs ~35 s regardless of `limit` | latency |
| 11 | P3 | `target_service` is rarely set on unresolved items | "could match" counts |
| 12 | P3 | `UnsupportedLanguage` skip lists a `.py` file as a sample | **(hypothesis: bug)** |
| 13 | P3 | `OrmDynamicQuery` volume (5,384 in Saleor) | blind-spot reporting |

---

## 1. `query_graph` cannot answer the Query screen's question (P1)

### What the screen needs
```
find     kind = HttpClientCall                       412 nodes
connect  via = Consumes, SendsHttp  to = HttpRoute   318 edges
filter   resolution != unresolved · repo != target   246 edges
group    by = (consumer repo, provider service)       31 groups
sort     by = call_sites desc
limit    10
```
with a running count after every step and a table of `consumer | provider | kind | call sites | resolution`.

### 1a. Federation bindings are not in the queryable graph  (the blocker)
`get_contract` for `graphql:query:checkout` (service `saleor`) lists 5 bound consumers in
`storefront`. The consumer node exists in `query_graph`, and so does the provider node, but the
consumer has **no edges of any kind**:

```text
repo_id=storefront  find Function name="graphql-call:query:checkout"   -> 5 nodes
  + connect (no edge filter) direction=both depth=1                    -> 0 nodes, 0 edges
  + connect edge=Binds / CallsGraphql / Consumes, both                 -> 0 / 0 / 0
repo_id=saleor      find name="query:checkout" path="schema.graphql"   -> 1 node (Module)
```
`describe_schema` lists the edge types `Binds`, `Consumes`, `SendsHttp`, `CallsHttp`,
`RouteMatches`, `CallsGraphql`, `CrossRepoSameSymbol`, but connecting from 78 storefront
`HttpClientCall` nodes along `Binds`, `SendsHttp`, `CallsHttp`, `RouteMatches` and `Consumes` each
returns 0 nodes. So the contract layer (what `get_contract`/`get_service` show) and the code graph
(what `query_graph` shows) are separate, and a graph query cannot cross services.

**Suggested change:** materialise the joiner's bindings as queryable edges (consumer node ->
`Binds` -> provider endpoint node) in the graph `query_graph` runs on, or give the contract layer
its own query tool. **Acceptance:** the query above, `find Function name="graphql-call:query:checkout"`
then `connect edge=Binds depth=1`, returns the Saleor `query:checkout` provider node and one edge
carrying the binding's provenance (`confidence`, `kind`, `source`).

### 1b. No grouping by property, no aggregates, no sorting by an aggregate
```text
{"op":"group","by":"repo"}         -> Error: unknown variant `repo`, expected one of `type`, `label`, `name`
{"op":"sort","by":"call_sites"}    -> Error: unknown variant `call_sites`, expected one of `name`, `type`, `label`
```
`group` takes only `type|label|name`, `sort` only `name|type|label`, and neither aggregates (count).
**Suggested change:** `group` by any node property (`repo`, `path` prefix, edge/neighbour property)
or by a pair, with a `count` aggregate, and `sort` by that aggregate.

### 1c. Unknown `filter` fields are silently ignored  (a bug, whatever the rest)
```text
find type=HttpClientCall (no limit)                          -> 78 nodes
+ filter {"resolution":{"not":"unresolved"}}                 -> 78 nodes   (ignored)
+ filter {"bogus":123}                                       -> 78 nodes   (ignored)
+ filter {"name":{"glob":"GET /fr*"}}                        -> 1 node     (applied)
```
`filter` accepts `type`/`name`/`label`. Anything else is dropped without an error, so a typo or an
unsupported property returns the **unfiltered** set while looking like a success. `group` and
`sort` do reject unknown values, so the behaviour is inconsistent.
**Acceptance:** an unknown filter key returns an `invalid_argument` error naming the key and the
accepted ones.

### 1d. No per-step counts
The reference shows a count after each step. With an explicit `limit` the result's `meta` is only
`{exec_us, nodes_visited}` (here `nodes_visited: 78`, not the matched total). The docs mention
`meta.matched_before_limit`, but it did not appear with an explicit `limit`. **Suggested change:**
optional `explain: true` returning `[{op, nodes, edges}]` per step.

### 1e. Property filters the screen needs
`repo`, and a binding's `resolution`/provenance, are not filterable (see 1c). Needed alongside 1a.

---

## 2. GraphQL contracts rarely have a schema, and what exists is thin (P1)

Saleor, `list_contracts` (`has_schema`) then `get_contract`:

| kind | with schema / total |
|---|---|
| `graphql:mutation` | 6 / 382 |
| `graphql:query` | 14 / 182 |
| `graphql:subscription` | 0 / 27 |
| `http` | 0 / 10 |
| `topic` | 0 / 164 |
| `table` | 0 / 124 |

So **20 of 565 GraphQL contracts (3.5%)** have a schema. On the OpenShell cluster 322 endpoints have
none (`get_coverage.schemaless_endpoints`), on the NAT cluster 24.

I read `get_contract` for every GraphQL contract that has a schema (those 20): every schema had
`direction: "response"`; there were **no `request`/argument schemas**. Field types over those 20
schemas (170 fields): `unknown` 68, `array` 38, `string` 36, `boolean` 16, `integer` 12 (40% unknown;
no GraphQL type names like `ID`, `JSONString` or an object type).

**Why it matters:** the Contract screen shows a signature
`checkoutComplete(checkoutId: ID, paymentData: JSONString, redirectUrl: String): CheckoutComplete`
and a field table with types and "who reads it". Without request schemas there is no signature; with
3.5% coverage most contracts show no fields at all; with `unknown` types the table is vague.

**Suggested change:** derive schemas from the provider's `schema.graphql` for every
query/mutation/subscription (the schema file is in the index: Saleor's `query:checkout` is a
`Module` node at `saleor/graphql/schema.graphql:1262`), emit `request` as well as `response`, and
use the SDL type names. **Acceptance:** for `graphql:mutation:checkoutComplete`, `get_contract`
returns a `request` schema listing `checkoutId`, `paymentData`, `redirectUrl` with their SDL types
and a `response` schema, and `has_schema` is true for >= 95% of Saleor's GraphQL contracts.

---

## 3. Per-repo coverage ledger is missing on the live view (P1)

The Coverage screen draws, per repo, **sensors that ran** and **skipped files**, plus blind spots.

`get_coverage {"snapshot":"live"}` -> per-repo `error: "coverage ledger unavailable for live view;
prepare a pinned snapshot"`, with partial `sensors` (`{"sql_tables":124}` for saleor, `{}` for the
dashboard) and no skips.

After `prepare_snapshot {}` (works on shallow clones; pins HEAD; about 75 s for the three Saleor
repos) and `get_coverage {"snapshot":"snap_..."}`, the same call returns exactly what the screen
needs:

```text
saleor            sensors {dynamic_dispatch:14, entry_points:336, field_reads:56, graphql:1371,
                           http_clients:46, sql_tables:790, websocket:1}  languages [python]
                  skips      [{reason:UnsupportedLanguage, count:4371, sample_paths:[...]}]
                  unresolved [{reason:OrmDynamicQuery, count:5384, sample_ids:[...]}]
saleor-dashboard  sensors {... graphql:4302, http_clients:239, frontend_values:13 ...}
                  skips UnsupportedLanguage 2665 · unresolved FrontendValueUnclassified 26
storefront        skips UnsupportedLanguage 478  · unresolved FrontendValueUnclassified 20
```

So the data exists; it is gated on a pinned snapshot, which costs a second index pass.
**Suggested change:** serve the ledger on the live view (it is computed during live indexing), or
make the snapshot cheap to create/refresh incrementally. **Acceptance:** `get_coverage live` returns
`sensors`, `languages`, `skips` and `unresolved` per repo with no `error`.

---

## 4. Rust wrapper gRPC clients are not followed (P2)

Five OpenShell call sites call RPC-named methods on a hand-written wrapper,
`openshell_core::grpc_client::CachedOpenShellClient` (`crates/openshell-core/src/grpc_client.rs:1851`),
whose methods (e.g. `submit_policy_analysis`, `:2313`) issue the real generated call:

```text
crates/openshell-supervisor-network/src/policy_local.rs:1130   session.client.get_draft_policy(...)
crates/openshell-supervisor/src/lib.rs:2017, :2063             client.submit_policy_analysis(...)
crates/openshell-supervisor/src/lib.rs:4027                    report_policy_status
crates/openshell-supervisor/src/lib.rs:4036                    report_endpoint_status
```
Evidence: all four RPCs are in `proto/openshell.proto` and in the contract index
(`rpc:openshell.v1.OpenShell/GetDraftPolicy` etc.), but `get_contract` shows **0 bound consumers**
for each; `list_unresolved` reports the sites as `rpc_stub_unknown` with no candidate;
`check_binding` for the name-matched key returns `valid:false, reasons:["not_a_consumer","method_mismatch"]`,
so a `bindings:` entry cannot repair it. The opt-in `accessors` (receiver type / method / return
type) in `rust-grpc.yaml` does not apply: the wrapper's own methods are the RPC names.

**Suggested change (either):** follow the wrapper method into its body and attribute the consumer at
the generated call; or add a config mapping a wrapper type's methods to RPCs (like `http_clients`).
**Acceptance:** those 5 sites become bound consumers of the 4 RPCs.

Repro data: OpenShell at commit `d4e32263eb45` (the commit in the unresolved items' `consumer`),
nemoclaw `37f1e4cb9942`, nemo-fabric `4fdf65a4b4c9`; config uses `services:` for each repo.

## 5. Rust std methods read as RPC stubs (P2)

`rpc-call:rust:41945:unwrap`, `...:2312:unwrap`, `...:23715:unwrap` and one `map_err` appear as
`rpc_stub_unknown` (6 sites in OpenShell). `src/server/sensors/patterns/rust-grpc.yaml` has
`deny_methods: [clone, ready, send_compressed, accept_compressed, max_decoding_message_size,
max_encoding_message_size]`. **Suggested change:** add `unwrap, expect, unwrap_or, unwrap_or_else,
unwrap_or_default, unwrap_err, expect_err, map_err`. **Acceptance:** no `rpc-call:rust:*:unwrap` in
`list_unresolved`. (Parallax currently classifies these itself; that rule can then be removed.)

## 6. A host held in a variable with a literal default is not seen as external (P2)

`agents/hermes/host/tool-gateway-broker.ts:375, :497, :667` call `${PORTAL_BASE_URL}/api/oauth/...`
where `const PORTAL_BASE_URL = process.env.NOUS_PORTAL_BASE_URL || "https://portal.nousresearch.com"`.
`get_coverage.external` lists literal external hosts (`collector.test` 7 calls, `agent-server.test`,
`example.com`) and those are not counted as unresolved; these three are, because the host is an
identifier. The federation config has no way to declare an external service (`services`,
`http_clients`, `bindings`, `provides`, `host_aliases`, `databases`, `schemas`, `generic_keys`).
**Suggested change:** resolve `const X = process.env.Y || "<literal>"` to the literal default
(flagged as a default). **Acceptance:** `portal.nousresearch.com` appears in `external`.

## 7. `check_binding` accepts root catch-all routes (P2)

For the three portal sites above (an **external** call), `check_binding` returns `valid:true` for
`nemo-fabric http:POST /` and `openshell http:ANY /` (and `openshell http:ANY /token` for two). None
is correct. **Suggested change:** a distinct verdict or reason (`catch_all_route`) for a root
catch-all, or do not offer it as a candidate. **Acceptance:** `check_binding` on those sites does
not return a plain `valid:true`.

## 8. Calls inside one service are counted as unresolved (P2)

On the OpenShell cluster, 324 loose ends: 227 test/tooling, and **52** product-code sites whose
candidates `check_binding` rejects with **only** `same_service`. They inflate `list_unresolved` and the
headline. **Suggested change:** report them as an internal class, or leave them out of
`unresolved_consumers`. **Acceptance:** `get_coverage.unresolved_consumers` excludes
same-service-only rejections (or exposes them separately).

## 9. Symbols are resolved by name only (P2)

Saleor has 8 symbols named `resolve_checkout`. `get_coupling_radar` and
`get_cross_repo_blast_radius` take `symbol` as a name and `repo_id`; without a path or id they
attribute the answer to a different symbol. Observed: `get_cross_repo_blast_radius` for a function
named `chat_completions` returned `answer_scope: "ambiguous_target"` **and** 224 leaves (e2e tests,
yaml) as if it were an answer. `get_coupling_radar` does accept a node uuid; the cross-repo tool
should too, and `find_symbol` should be the documented way to get it.
**Suggested change:** accept a node `id`/`path` in `get_cross_repo_blast_radius`; never return leaves
when `answer_scope` is `ambiguous_target`. **Acceptance:** an ambiguous name returns an error
listing the candidates, not data.

## 10. `list_service_refs` with `suggestions: true` costs about 35 s whatever the limit (P3)

Own server, fresh index (NAT cluster):

| call | time |
|---|---|
| `outcome:unknown`, no suggestions, `limit:1000` | 0.6 s |
| `suggestions:true`, `limit` 3 / 10 / 30 / 60 | 34.4 / 35.6 / 35.0 / 35.5 s |

A client with a 30 s timeout and 2 retries re-sends the same job. On a long-lived server, after
several such requests `list_service_refs` stopped answering for a while, even without suggestions
(it recovered later); I did not establish that the repeats caused it. The suggestions cover
references outside the returned `items` page, and in this data they were for **already resolved**
refs (`localhost` -> `nat`), i.e. route matches. **Suggested change:** cache the suggestion index
between calls, or document the cost and that suggestions are independent of `limit`.

## 11. `target_service` is rarely set on unresolved items (P3)

Saleor: 33 unresolved, 3 with `target_service`, 15 with `candidates`. Anything wanting "unresolved
calls that could match service X" has to use `candidates`. Question: is `list_unresolved`'s
`service` filter keyed on `target_service` or on candidates? **(not verified)**

## 12. `UnsupportedLanguage` skips list a Python file **(hypothesis: bug)**

In the pinned ledger, Saleor's `skips[UnsupportedLanguage]` (count 4371) has `sample_paths`
beginning with `saleor/webhook/validators.py`, a Python file, while `languages` is `[python]`. Either
the reason is per-sensor and mislabelled, or the count includes files it should not. **(not verified)**

## 13. `OrmDynamicQuery` volume (P3)

Saleor's ledger reports **5,384** `OrmDynamicQuery` unresolved sites, against 33 loose ends. It is
the largest blind-spot class and the dashboard's "Known blind spots" list would be dominated by it.
Question: is that expected, and is there a way to group it (by file/app) so a UI can summarise it?

---

## What Parallax already works around (coordinate before removing)

- Classifies `rpc-call:rust:*:(unwrap|expect|unwrap_or*|unwrap_err|expect_err|map_err)` as "not a call",
  and `server_reflection_info` as external (rules in `packages/api/src/loose-ends/classify.ts`).
- Marks recommendations whose target is a root catch-all with a caution (§7).
- Counts an unresolved call as "could match service X" if X is `target_service` **or** among `candidates` (§11).
- Refuses co-change / cross-repo answers when a symbol name is not unique, and discards
  `ambiguous_target` answers (§9) (`packages/api/src/code-links.ts`).

## What I could not verify

- `diff_contracts` end to end: it needs two pinned snapshots at different commits, and every checkout
  I had is a shallow clone (1 commit). `prepare_snapshot` itself works.
- Whether §1a also holds without `repo_id` or through a federated query path.
- Co-change (`get_coupling_radar`) on any checkout except this repo (the only one with history).

## Reproduction

Saleor (3 repos, shallow clones): saleor `487885d437fe`, saleor-dashboard `eb1118714c39`,
storefront `a6e357a575c6`. Config (`repos.yaml`):

```yaml
data_dir: /path/to/federation
max_concurrent_indexers: 3
repos:
  - {id: saleor,           source: {type: workspace_dir, path: /path/to/saleor}}
  - {id: storefront,       source: {type: workspace_dir, path: /path/to/storefront}}
  - {id: saleor-dashboard, source: {type: workspace_dir, path: /path/to/saleor-dashboard}}
services:
  - {name: saleor,           repo: saleor, env: [SALEOR_API_URL, NEXT_PUBLIC_SALEOR_API_URL, API_URI]}
  - {name: storefront,       repo: storefront,       provides_graphql: false}
  - {name: saleor-dashboard, repo: saleor-dashboard, provides_graphql: false}
```
```bash
lain server --config repos.yaml --transport http --port 9999     # cold index about 2 min
mcp() {  # usage: mcp <tool> '<json args>'
  curl -s -X POST localhost:9999/mcp -H 'Content-Type: application/json' \
    -H 'Accept: application/json,text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}
mcp load_package '{"package":"raw"}'                                # exposes query_graph
# §1c  (compare with the unfiltered count)
mcp query_graph '{"repo_id":"storefront","query":{"ops":[{"op":"find","type":"HttpClientCall"}]}}'
mcp query_graph '{"repo_id":"storefront","query":{"ops":[{"op":"find","type":"HttpClientCall"},{"op":"filter","bogus":123}]}}'
# §1a
mcp query_graph '{"repo_id":"storefront","query":{"ops":[{"op":"find","type":"Function","name":"graphql-call:query:checkout"},{"op":"connect","direction":"both","depth":1}]}}'
# §1b
mcp query_graph '{"repo_id":"storefront","query":{"ops":[{"op":"find","type":"HttpClientCall"},{"op":"group","by":"repo"}]}}'
# §2
mcp list_contracts '{"snapshot":"live","limit":500}'      # has_schema per item
mcp get_contract   '{"snapshot":"live","key":"graphql:query:exportFile","service":"saleor"}'
# §3
mcp get_coverage   '{"snapshot":"live"}'
mcp prepare_snapshot '{}'        # then poll get_snapshot until state=ready
mcp get_coverage   '{"snapshot":"snap_<id>"}'
```
The OpenShell/NAT numbers (§4-§8, §10) come from the NVIDIA eval clusters (`cluster-a`: OpenShell +
NemoClaw + NeMo-Fabric; `cluster-b`: NeMo-Agent-Toolkit + UI + examples), same Lain version.
