# Lain 0.16.0 against the agent report

Date: 2026-11-23. Engine: the v0.16.0 release binary (SHA256-checked), `lain 0.16.0`. The release
notes are empty, so every row below was measured, not read from a changelog.

Data: **Saleor** (saleor, saleor-dashboard, storefront; the `test-repos` checkouts) and **cluster A**
(OpenShell at `d4e32263eb45`, NemoClaw at `37f1e4cb9942`, NeMo-Fabric at `4fdf65a4b4c9`: the commits the
report used, re-cloned from GitHub because the earlier checkouts were deleted). Cluster B (NAT) was not
re-indexed. The section numbers are those of `docs/lain-agent-report.md`.

| § | Report item | 0.16.0 | How it was checked | What Parallax does with it |
|---|---|---|---|---|
| 1a | `query_graph` cannot see federation bindings | **Fixed** | `find Function name="graphql-call:query:checkout"` then `connect edge=Binds` returns the Saleor `query:checkout` provider node and one edge with `confidence`, `kind`, `source` (the report's acceptance criterion) | Query page |
| 1b | No grouping by property, no aggregates | **Fixed** | `group by` accepts `repo`, `service`, `resolution`, `provenance`, `confidence`, `consumer.*`, `provider.*`, `edge.*`; `sort by` accepts `count` / `call_sites` after a group | Query page |
| 1c | Unknown `filter` fields silently ignored | **Fixed** | `filter {"bogus":1}` is an error naming the accepted keys (`repo, resolution, provenance, usage, confidence, path, type, label, name`) | The adapter now keeps that text instead of "unparseable content" |
| 1d | No per-step counts | **Fixed** | `"explain": true` on the query returns `[{op, nodes, edges}]`; `meta.truncated` and `matched_before_limit` flag a cut | Query page shows the count after each step |
| 1 | (still open) `repo_id` is required in a federation | **Not fixed** | `query_graph` without `repo_id` answers "requires scoping: multiple repos" | Parallax asks once per repo and merges the answers |
| 2 | GraphQL contracts rarely have a schema | **Fixed** | 448 of 448 Saleor GraphQL contracts have an SDL schema with `!` and `[...]` markers (`productCreate`: `ProductCreateInput!`, `[ProductError!]!`, `Product?`) | Contract detail already showed it; now it has data |
| 3 | Live coverage ledger has no per-repo sensors/skips | **Fixed** | `get_coverage live` returns `sensors`, `languages`, `skips`, `unresolved` per repo, no `error` | Coverage page: index health by repo, blind spots |
| 4 | Rust wrapper gRPC clients not followed | **Not fixed** | `get_contract` for `GetDraftPolicy`, `SubmitPolicyAnalysis`, `ReportPolicyStatus`, `ReportEndpointStatus` still shows 0 bound consumers | Nothing to do on our side |
| 5 | Rust std methods read as RPC stubs | **Fixed** | No `rpc-call:rust:*:unwrap`/`map_err` among cluster A's 192 unresolved items (`rpc_stub_unknown` left: 6, all `server_reflection_info`) | The Parallax rule in `loose-ends/classify.ts` is now redundant but harmless; left in place |
| 6 | Host in a variable with a literal default not seen as external | **Fixed for the case present** | New `url_defaults` field; the `SPIRE_JWKS_URI` default host is listed under `external`. The report's `portal.nousresearch.com` site is not in these commits, so that exact site was not re-run | The Coverage page caveat now says a variable host is resolved when it has a literal default |
| 7 | `check_binding` accepts root catch-all routes | **Reason added** | `catch_all_route` exists in the engine (checked at tag v0.16.0). No site in this data produces it; none of the catch-all candidates on cluster A came back `valid:true` any more (they fail with `same_service` or `not_a_consumer`) | **Latent crash fixed**: Parallax's reason enum lacked it, so such an answer would have thrown a Zod error. Now accepted, and a site whose only offers are catch-alls is "no candidate" |
| 8 | Calls inside one service counted as unresolved | **No longer seen** | Parallax's classifier on cluster A: 210 loose ends, 0 in the "inside one service" class (was 52 on 0.15 data) | None |
| 9 | Symbols resolved by name only | **Fixed** | `get_cross_repo_blast_radius` with the ambiguous `resolve_checkout` returns an error listing the candidate symbols, not data | None; `code-links.ts` still refuses ambiguous names itself |
| 10 | `list_service_refs` with suggestions takes ~35 s | **Not reproduced** | 0.1 s on Saleor with `suggestions:true`. The original case was the NAT cluster, not re-indexed, so this is not a like-for-like comparison | None |
| 11 | `target_service` rarely set on unresolved items | **Improved** | Saleor 18 of 32 (was 3 of 33); cluster A 49 of 192 | The "could match" count still also uses `candidates` |
| 12 | `UnsupportedLanguage` skips list a `.py` file | **Cannot evaluate** | The live ledger reports no skips for any repo on either dataset | None |
| 13 | `OrmDynamicQuery` volume | **Fixed** | `summary.orm_dynamic_query.directories` and each unresolved reason's `locations.directories` group the sites by directory (Saleor: 1,760 sites; `saleor/graphql/product/filters` 108 is the largest) | Coverage page "Known blind spots" |
| 14 | Release binary needs glibc 2.43 | **Improved** | Needs 2.39: runs on Ubuntu 24.04 (an `install.sh` run in a 24.04 container confirmed it), not on 22.04 | RUNBOOK targets 24.04 |

## Other differences seen

- **HTTP contracts, cluster A: 290 on 0.15.0, 66 on 0.16.0.** All 224 that disappeared are `http:ANY /<Go
  error or format string>` from OpenShell's `sdk/go` (for example `/%w: cannot read %s: %v`). 0.15 read
  those strings as routes. The test-path providers are identical in both versions, no real route was lost.
- **Cluster A unresolved items by reason: 161 of 192 are `not_a_call`.** The engine now says so itself; Parallax
  maps that reason to "not a gap".
- **Lain only answers loopback `Host` headers** (403 otherwise), on 0.15.0 and 0.16.0. The deploy had to change
  (see the 0.2.0 release notes).
- The engine's `complete` flag is `false` on fully indexed workspaces: it means "will not claim complete
  coverage while unresolved sites remain" (Saleor: 32 unresolved consumers, 1,842 sites it cannot see into).

## Not measured

§4's first-hand repro beyond the four RPCs, §10 on the NAT cluster, cluster B in general, GraphQL `provenance`
values on wrapper-derived unresolved candidates (none occur in this data), `diff_contracts` end to end (needs two
pinned snapshots at different commits).
