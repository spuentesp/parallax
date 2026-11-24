# Lain 0.15.0: findings from measuring Parallax's coverage on real clusters

Draft for the Lain side. Everything here was measured, not inferred; where something is
a hypothesis it says so. Data: the NVIDIA eval clusters (Cluster A: OpenShell + nemoclaw +
nemo-fabric; Cluster B: NeMo-Agent-Toolkit + UI + examples), Lain 0.15.0, `live` view.
All checkouts are shallow clones (1 commit), which matters for co-change only.

Headline: of Cluster A's 324 loose ends, 227 are test or tooling files and 52 are calls
inside one service. Real gaps in product code are 33 (about 8%). The items below are what
is left, ordered by how much of that is Lain's to fix.

---

## 1. Rust RPC sensor reads standard-library methods as RPC stubs

`rpc_stub_unknown` sites with no candidate included `.unwrap()` and `.map_err()`.

- Evidence: `rpc-call:rust:41945:unwrap`, `rpc-call:rust:2312:unwrap`,
  `rpc-call:rust:23715:unwrap`, and one `map_err`: 6 sites in OpenShell (5 `unwrap`
  family, 1 `map_err`).
- Cause (from the source): `src/server/sensors/patterns/rust-grpc.yaml` has
  `deny_methods: [clone, ready, send_compressed, accept_compressed,
  max_decoding_message_size, max_encoding_message_size]`. `Option`/`Result` methods are
  not on it, so they pass as RPC candidates.
- Suggested change: add `unwrap, expect, unwrap_or, unwrap_or_else, unwrap_or_default,
  unwrap_err, expect_err, map_err` to the default `deny_methods`.
- Parallax currently works around it with a narrow classification rule (only
  `rpc_stub_unknown`, only Rust, only those names).

## 2. Wrapper clients around a generated gRPC client are not followed

Five OpenShell call sites call RPC-named methods on a hand-written wrapper, not on the
generated client:

- `crates/openshell-supervisor-network/src/policy_local.rs:1130` `session.client.get_draft_policy(...)`
- `crates/openshell-supervisor/src/lib.rs:2017` `client.submit_policy_analysis(...)` (and `:2063`)
- `crates/openshell-supervisor/src/lib.rs:4027` `report_policy_status`, `:4036` `report_endpoint_status`

The receiver is `openshell_core::grpc_client::CachedOpenShellClient` (`grpc_client.rs:1851`);
its methods, e.g. `submit_policy_analysis` at `grpc_client.rs:2313`, issue the real
generated call.

- The engine knows all four RPCs (`rpc:openshell.v1.OpenShell/GetDraftPolicy`,
  `SubmitPolicyAnalysis`, `ReportPolicyStatus`, `ReportEndpointStatus`), but
  `get_contract` shows **0 bound consumers** for each: the supervisor -> gateway
  dependency is not captured at all.
- `check_binding` for the name-matched key rejects each with
  `["not_a_consumer", "method_mismatch"]`, so a `bindings:` entry cannot repair it either.
- `accessors` in `rust-grpc.yaml` does not apply: it maps an accessor's return type to a
  generated client type, but here the receiver's own methods are the RPC names.
- Suggested change (either): follow the wrapper method into its body and attribute the
  consumer at the generated call; or add an opt-in config mapping a wrapper type's methods
  to RPCs, like the existing `http_clients` registry but for gRPC.

## 3. A host held in a variable with a literal default is not seen as external

Three nemoclaw sites (`agents/hermes/host/tool-gateway-broker.ts:375, :497, :667`) call
`${PORTAL_BASE_URL}/api/oauth/...` where

```ts
const PORTAL_BASE_URL = (process.env.NOUS_PORTAL_BASE_URL || "https://portal.nousresearch.com")
```

- `get_coverage.external` lists literal external hosts (`collector.test`,
  `agent-server.test`, `example.com`) and those calls are not counted as unresolved. These
  three are, because the host is an identifier.
- Suggested change: resolve `const X = process.env.Y || "<literal>"` to the literal default
  (flagged as a default) so the host can be classified as external.
- The federation config has no way to declare an external service (`services`,
  `http_clients`, `bindings`, `provides`, `host_aliases`, `databases`, `schemas`,
  `generic_keys`), so there is no config workaround.

## 4. `check_binding` accepts catch-all routes for almost any call

For the same three portal sites, `check_binding` returns `valid: true` for
`nemo-fabric http:POST /` and `openshell http:ANY /` (and `openshell http:ANY /token` for
two of them). The call is to an external portal, so none is correct.

- Parallax now marks recommendations whose target is a root catch-all
  (`http:<METHOD> /`) with a caution and does not preselect them.
- Suggested change: report a lower-confidence or distinct verdict for a root catch-all
  (e.g. a reason such as `catch_all_route`), or do not offer it as a candidate.

## 5. `rpc_stub_unknown` counts calls inside one service as unresolved

52 of Cluster A's product-code sites have candidates that `check_binding` rejects with
**only** `same_service`: the call is inside one service, not across services. They show up
in `list_unresolved` and in the headline count. Reporting them as an internal class (or
omitting them) would make `unresolved_consumers` closer to the real gap.

## 6. `list_service_refs` with `suggestions: true` costs about 35 s whatever the limit

Measured on Cluster B (own server, fresh index):

| call | time |
|---|---|
| `outcome: unknown`, no suggestions, `limit: 1000` | 0.6 s |
| `suggestions: true`, `limit` 3 / 10 / 30 / 60 | 34.4 / 35.6 / 35.0 / 35.5 s |

- A client with a 30 s timeout and retries re-sends the same 35 s job. After several such
  requests, `list_service_refs` stopped answering for a while on a long-lived server, even
  without suggestions, and recovered later (0.3 s). That sequence is what was observed; I
  did not establish that the repeated requests caused it.
- The suggestions covered references that were not in the `items` page, and in this data
  they were for already-resolved refs (`localhost` -> `nat`), i.e. route matches, not
  candidates for unresolved hosts.
- Suggested change: cache the suggestion index between calls, or document the cost and the
  fact that suggestions are independent of `limit`.

---

For completeness, the 17 `rpc_stub_unknown` sites with no candidate that are not `unwrap`
family were: 6 `server_reflection_info` (standard gRPC reflection; Parallax classifies it
as external), the 5 wrapper calls in section 2, and 6 sites for methods that appear in no
`.proto` (`set_workspace` x2, `poll_settings`, `refresh_installed_extension_credentials`,
`extension_credentials_for`, `workspace`) and may not be RPCs at all (not verified).
