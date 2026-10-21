# Release validation, 2026-10-21

Engine: [Lain v0.11.0](https://github.com/spuentesp/lain/releases/tag/v0.11.0),
Linux x86_64 release binary. Archive SHA-256:
`e3487f2d7e2cfe1fa80b2e3f6f8816da8757d37c961590b97e8e2ed6de57258a`.

| Check | Result |
|---|---|
| G1: contract changes, coverage and source evidence | 26/26 |
| G2: persisted reports, recovery, HTTP/MCP parity, idempotency | 37/37 |
| Code graph, including release `edges` and `paths` | 21/21 |
| G3: investigator, real model tool calls and grounded BFF response | 34/34 with Nemotron Super as worker |
| GraphQL source fixture | Pass: ambiguity before configuration, advisor YAML round-trip as Confirmed, automatic dependency after `provides_graphql: false` |
| Unit suite, held-out suite, build and typechecks | Pass: 826 unit/property tests and 4 held-out tests; gate scripts also typecheck |
| Targeted adapter mutation check | 69/69 killed; no survivors or uncovered mutations in the selected ranges |
| Full Saleor cold index, patched local build | Pass: all three repos reviewed after 512 s; `pnpm gate:saleor` 4/4 checks (provider suppression, storefront GraphQL resolution, binding YAML, storefront → saleor-api dependency). Not yet run against the published 0.11.0 binary. |

The GraphQL fixture creates and commits actual schema/operation files, then
boots the release binary with the default core profile. It feeds the advisor's
binding YAML back through Lain's configuration loader and restarts the server.
No test inserts graph or assessment state by hand. `pnpm gate:graphql` repeats
this check with `LAIN_BIN` pointing at the release binary.

An earlier cold run against the published 0.11.0 binary stayed unreviewed after
more than 15 minutes; the readiness check failed before evaluating any empty
catalog as evidence. That run is superseded by the patched build below.

The full Saleor acceptance check then passed on the patched local build: a fresh
data directory, a release `lain` built from the working tree that contains the
indexing patch, and the API, dashboard and storefront checkouts from
`test-repos/workspaces.yaml`. All three repos were reviewed after 512 s, and
`pnpm gate:saleor` passed 4/4 checks with `provides_graphql: false` set on
`saleor-dashboard`. This is not yet a result for the published v0.11.0 binary,
because the patch is not in a release. Re-running the gate on a release that
includes the patch is the remaining step.

The local [indexing patch](../patches/lain-0.11.0-indexing-performance.patch)
addresses hot paths observed while profiling that cold run: whole-document
UTF-8 validation during SDL token probes, per-file HTTP query and prefix-regex
compilation, per-file WebSocket/event idiom compilation, and repeated graph
copies in field-access analysis. HTTP and event caches live within each scan
so configuration reloads retain their existing behavior. WebSocket detection
continues to use the immutable bundled registry. The patch applies cleanly to
the v0.11.0 tag; it is not part of the published release.

The patched sensor suite passes 411 tests. Regressions exercise a large SDL,
actual source-file scans, query override reloads, bounded compilation, and
field-access emissions with a single collection of graph call sites. No
held-out tests were changed.

Lightning timed out during live model validation. The G3 pass used
`NEMOTRON_WORKER_MODEL=nvidia/nemotron-3-super-120b-a12b`; explanations record the
effective model. A repeated catalog probe also exposed invalid generated
arguments, so the gate now explicitly requests `{}` and allows the model to
correct a rejected call before asking it to interpret a successful result.
Schema validation and the original budgets still apply.

The PR picker UI and webhook/status automation remain separate unfinished work
in the [PR evaluation design](superpowers/specs/2026-10-20-pr-evaluation-design.md).
No GitHub write integration has been added in this release validation change.
