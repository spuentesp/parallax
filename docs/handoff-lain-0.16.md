# Handoff: moving the Parallax installation to Lain 0.16.0

Date: 2026-11-22. Branch `spuentesp/fix-parallax-lain-dashboard` (4 local commits on top of `cf4d967`,
nothing pushed). Lain **0.16.0** was published 2026-11-22T15:55Z; its GitHub
release notes are empty, so everything below was measured, not read from a changelog.

## Status in one line

0.16.0 is compatible with Parallax as it is today (every call parsed by Parallax's own client and
Zod schemas, on two real federations) and fixes three of the items in `docs/lain-agent-report.md`.
The installation still points at **v0.15.0**: nothing has been bumped yet.

## What was verified (real 0.16.0 binary, SHA256-checked)

- `lain schema dump`: 100 tools, none added, none removed, same required arguments and property
  names as 0.15.0 for all 11 tools whose schema changed.
- Run through `packages/api`'s `createLainClient` (so the real Zod schemas) against **cluster A**
  (OpenShell, NemoClaw, NeMo-Fabric) and **cluster B** (NAT, NAT-UI, NAT-Examples):
  `listServices`, `getService`, `listContracts`, `getContract`, `listUnresolved`,
  `listServiceRefs`, `getCoverage` all returned and parsed. No schema rejections.
- Cluster A, 0.16.0 with `LAIN_INDEX_TIMEOUT=900`: all 3 repos `indexed`, each with a ledger
  (7 / 9 / 8 sensors). 203 contracts, 105 with a schema, 24 with bound consumers.
- Cluster B: all 3 repos `indexed` with a ledger. 24 contracts, 2 bound, 0 with a schema.

## What 0.16.0 changes for Parallax

| Report item | 0.15.0 | 0.16.0 |
|---|---|---|
| §3 live coverage ledger | "unavailable for live view" for every repo | per-repo ledger and sensors on the live view (**fixed**) |
| §7 `check_binding` root catch-all | accepted | new reason `catch_all_route` in the schema (**fixed**, reason present; not exercised live) |
| §2 GraphQL schemas | rarely present | `list_contracts`/`get_contract` document SDL arguments and results with list/non-null markers (**schema says fixed; not exercised**: neither cluster has GraphQL, Saleor not re-run) |
| glibc of the Linux binary | needs 2.43 (fails on Ubuntu 22.04 and 24.04) | needs **2.39**: runs on Ubuntu 24.04, **still fails on 22.04** (`GLIBC_2.38 not found`) |
| §1 `query_graph` federation edges | not queryable | not re-tested |

New in the 0.16 schema, additive but not yet used by Parallax: `provenance` on `list_unresolved`
candidates (`Generated`, `ConfiguredWrapper`, `FollowedWrapper`, `InferredWrapper`, now required in
that item), `ref` edges in `list_service_refs` and a `ref` value in the edge-kind enums,
`not_a_call` as an unresolved reason, `repo_path` on `list_services`/`get_service`,
nullable `analyzer_version` in `get_coverage`, `usage` on `Ref` nodes in `query_graph`,
and a `service` filter on `list_unresolved` that now also matches candidate endpoint services.

## What must be done

### Must do before relying on 0.16.0

1. **Saleor demo on 0.16.0: done 2026-11-22, passes** (repos from `parallax/test-repos`, RUNBOOK `repos.yaml`,
   `LAIN_INDEX_TIMEOUT=900`). All 3 repos `indexed` with a ledger (8 / 6 / 7 sensors). 669 contracts:
   graphql 448 (**all 448 have SDL schemas** with `!` / `[...]` markers, 315 bound), topic 82, table 124, http 15.
   The Parallax client parses every call; `getContract` works on query, mutation and consumer-read paths.
   Loose ends: 32 (1 `not_a_call`); `classifyLooseEnds` runs live: 18 dynamic, 12 test/tooling, 2 rejected.
   `pnpm -r test`: api 1133 and web 590 passing (fixtures; not against this live server).
   **Not done:** the dashboard screens were not opened in a browser, and `gate:graphql` still asserts 0.15.0.
2. **Reindex existing data dirs.** 0.15 → 0.16 may change the on-disk format; 0.16 reported
   "coverage ledger missing; reindex required" for repos that had no ledger yet. Not tested on a
   migrated 0.15 data dir (none was kept). `install.sh` already runs `lain reindex` when the installed
   version differs from `LAIN_VERSION`, but that path is untested on a real upgrade.
3. **Raise the index budget for big repos (done: `install.sh` default is now 900).** Under the default 60 s (`LAIN_INDEX_TIMEOUT`,
   `install.sh` default 60) OpenShell and NemoClaw were marked Degraded and reported as `failed`
   with `error: null`. With 900 they indexed. Saleor indexed in about 2 minutes earlier on 0.15, so
   check that the demo VM is not at the edge.
4. **Bump the pin** in `install.sh` (`LAIN_VERSION`, usage text, header comment), `README.md`,
   `deploy/RUNBOOK.md`, `deploy/.env.demo.example`, `docs/lain-tooling-inventory.md`,
   `test/lain-0.15-demo.ts` (rename) and the `demo:lain` script in `package.json`. Do this only
   after step 1 passes.
5. **VM OS: decided, Ubuntu 24.04** (runs the release binary; 22.04 would need the source build). `deploy/RUNBOOK.md`
   now says 24.04.

### Still unverified, in order of risk

- **`install.sh` end to end on a real VM:** systemd units, the relay, Docker, Caddy, workspace
  seeding. Only steps 1-6 ran in a container, with Docker stubbed. (The RUNBOOK says the compose
  stack was never tested either.)
- **HTTP contracts on cluster A, 290 -> 66: explained (re-ran 0.15.0 and 0.16.0 on the same repos).** Not tests:
  the 49 test-path providers are identical in both. All 224 lost contracts are OpenShell `sdk/go` (275 providers),
  every one `http:ANY /<Go error or format string>` (e.g. `/%w: cannot read %s: %v`, `/sandbox %q not found`).
  0.15 read those strings as routes; 0.16 no longer does. No real-looking route was lost, none was added.
  So 0.16 is the better sensor, and the 0.15 cluster-A HTTP baseline (290) was inflated by false positives.
- **Clean parse is not clean use.** `provenance` and `ref` parse but no Parallax code reads them. The engine
  reason `not_a_call` is now handled (`coverage/breakdown.ts` -> `outside`, `loose-ends/classify.ts` -> category
  `not_a_call`, with tests); not yet seen on live data.
- **The full test suites on 0.16.0:** only the probe was run, not `pnpm test` against a live server.

### Lain-side items that remain open (see `docs/lain-agent-report.md`)

§1 (`query_graph` bindings), §4-§6, §8-§13, plus two not yet in the report: a repo that times out
is reported `failed` with `error: null`, and the 60 s default index budget is too small for large
repos.

## Environment notes

- The `lain` MCP server configured for Claude Code points at a binary that no longer exists
  (`/data/agents/orca/workspaces/lain/booby/target/release/lain`), so it fails to connect. It is
  separate from the Parallax installation; fix the path or point it at a 0.16.0 binary.
- Probe script and downloaded binaries live in this session's scratchpad (not durable). To rebuild:
  `gh release download v0.16.0 -R spuentesp/lain -p 'lain-0.16.0-x86_64-unknown-linux-gnu.tar.gz' -p SHA256SUMS`,
  check with `sha256sum -c`, run `lain server --config <repos.yaml> --transport http --port <p>`
  with `LAIN_INDEX_TIMEOUT=900`, then call the Parallax client (`createLainClient`) against
  `http://localhost:<p>/mcp`.
