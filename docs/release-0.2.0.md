# Parallax 0.2.0

Date: 2026-11-23. Engine: **Lain v0.16.0** (was v0.15.0). Measurements behind the engine claims are in
`docs/lain-0.16-remeasure.md`; the install handoff is `docs/handoff-lain-0.16.md`.

## What is new

- **Query page** (`/orgs/:id/query`, opened by the Query toggle in the ask bar, which was disabled). A pipeline
  editor over the engine's graph: `find`, `connect`, `filter`, `group`, `sort`, `limit`, with the engine's count
  after each step, results as a table or JSON, and copy as pipeline or cURL. Read-only: the API accepts only those
  six operations. Lain needs a `repo_id` in a federation, so the query runs once per repo and the API adds the
  answers up (`POST /api/workspaces/:id/graph-query`). A repo that fails is named in the scope instead of failing the
  query, and the engine's own "result was cut" flag is shown. Starting points are pipelines verified on Saleor.
- **Coverage page: index health and blind spots.** Per repo: state, languages, the sensors that ran with their counts,
  skipped files; then the blind spots by reason with the directories they cluster in (Saleor: 1,760
  `OrmDynamicQuery` sites, mostly under `saleor/graphql/product/filters`). When the engine says coverage is not
  complete, the page says why, with the engine's own numbers. All of this was already served by Lain 0.16 on the live
  view; Parallax read four of its fields.
- **`not_a_call` and `catch_all_route`** (new Lain reasons) are understood. On cluster A, 161 of 192 unresolved items
  carry `not_a_call`.
- **Lain 0.16.0 pinned** in `install.sh`, the RUNBOOK, the README and `gate:graphql`. The engine's release binary runs
  on Ubuntu 24.04; the target VM is now 24.04.

## Fixes

- **`packages/api/src/coverage/` was never committed.** A bare `coverage/` line in `.gitignore` matched the source
  directory, so `breakdown.ts` and `ledger.ts` were missing from the repository and a fresh clone could not start
  the API. The ignore rule now covers only report directories. This would have broken the real VM install.
- **The container could not reach Lain.** Lain answers 403 to any `Host` that is not a loopback address, so the app
  failed at boot through the bridge relay. Both compose services now use the host network, the app listens on
  `127.0.0.1` (new `HOST` setting) and Caddy proxies to `127.0.0.1:8080`. `install.sh` no longer installs socat or a
  relay unit (it removes the old one on re-run).
- **`install.sh` aborted right after the engine started**: it parsed the index status assuming a key order Lain does
  not use, and `set -e` killed the script. Now order-independent.
- **`check_binding` reason `catch_all_route` crashed the parser** (closed enum). Added; a site whose only offers are
  catch-all routes is classified "no candidate".
- **The adapter hid the engine's error text** ("unknown field `bogus`, expected one of ...") behind "unparseable
  content". It is now passed through.
- **Contracts page**: the "Dependencies & evidence" list showed every topology edge, including structural "exposes"
  edges (1,537 rows on Saleor against 441 real dependencies) and logged duplicate React keys. It lists real
  dependencies only.
- **Assessments pages and two buttons were in Spanish**; now English like the rest.
- `/api/health` and both MCP servers reported `0.1.0` regardless of the constant; they read `PARALLAX_VERSION`.

## Upgrading

- A Lain 0.15 data dir must be reindexed once: 0.16 refuses it (graph schema v5, expects v7) and says to run
  `lain reindex --config <repos.yaml>` (2m47 on cluster A with 12 cores; `install.sh` does it on upgrade). The server
  needs a few more minutes after starting before `get_coverage` leaves `not_ready`.
- Index budget: `LAIN_INDEX_TIMEOUT` now defaults to 900 s in `install.sh` (60 s marked big repos failed).
- Compose: `network_mode: host` for both services, so port 8080 must be free on the VM.

## Verified, and what was not

Verified in this release: the full test suite (api 1,169, web 605, shared 373, mcp 38, gates 55); typecheck; a clean
checkout of the branch (so the missing-files bug cannot recur unnoticed); the new screens against live Lain 0.16.0 on
Saleor in a browser (Coverage, Query, Contracts, Contract detail, Map, Inspector); the upgrade from real 0.15 data;
`gate:graphql`; the Dockerfile and compose behaviour under podman; `install.sh` end to end in an Ubuntu 24.04
container (with a stub `docker`).

**Not verified**: `install.sh` on a real VM (systemd units, a real Docker daemon, Caddy on 80/443 with a
certificate); "Ask the architecture" and any model-driven path (no Nebius token was available); evaluating a pull
request end to end; the new screens on cluster A or B data (only the API numbers were); nothing was pushed or
deployed by this work.

## Still open

- Lain: §4 (Rust wrapper gRPC clients), `query_graph` still needs `repo_id`.
- Parallax does not yet read `provenance` on unresolved candidates or the `ref` edges, and the Query page has no
  natural-language "Translate" box or saved views (the design shows both).
