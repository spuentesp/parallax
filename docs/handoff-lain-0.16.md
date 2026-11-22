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

1. **Re-run the Saleor demo on 0.16.0** (the reference dataset). Not done: the Saleor repos were
   not on this machine. Check `list_contracts` has schemas for the GraphQL operations (§2) and
   that the dashboard's Coverage, Contract detail and Inspector screens still render.
2. **Reindex existing data dirs.** 0.15 → 0.16 may change the on-disk format; 0.16 reported
   "coverage ledger missing; reindex required" for repos that had no ledger yet. Not tested on a
   migrated 0.15 data dir (none was kept). `install.sh` already runs `lain reindex` when the installed
   version differs from `LAIN_VERSION`, but that path is untested on a real upgrade.
3. **Raise the index budget for big repos.** Under the default 60 s (`LAIN_INDEX_TIMEOUT`,
   `install.sh` default 60) OpenShell and NemoClaw were marked Degraded and reported as `failed`
   with `error: null`. With 900 they indexed. Saleor indexed in about 2 minutes earlier on 0.15, so
   check that the demo VM is not at the edge.
4. **Bump the pin** in `install.sh` (`LAIN_VERSION`, usage text, header comment), `README.md`,
   `deploy/RUNBOOK.md`, `deploy/.env.demo.example`, `docs/lain-tooling-inventory.md`,
   `test/lain-0.15-demo.ts` (rename) and the `demo:lain` script in `package.json`. Do this only
   after step 1 passes.
5. **Pick the VM OS knowingly.** Ubuntu **24.04** now runs the release binary. Ubuntu **22.04**
   (what `deploy/RUNBOOK.md` says) still needs the source-build fallback in `install.sh` (about
   8 minutes on 12 cores / 15 GB in a container; the script warns 15-40 minutes on a 4 vCPU VM).
   Either move the RUNBOOK to 24.04 or accept the build.

### Still unverified, in order of risk

- **`install.sh` end to end on a real VM:** systemd units, the relay, Docker, Caddy, workspace
  seeding. Only steps 1-6 ran in a container, with Docker stubbed. (The RUNBOOK says the compose
  stack was never tested either.)
- **Unexplained drop in HTTP contracts on cluster A:** 290 on 0.15.0 against 66 on 0.16.0 (rpc 120
  and table 17 are identical). Test-file routes are still counted (100 of 250 providers sit under
  test/e2e/fixture paths), so it is not that. Find out whether 0.16.0 deduplicates or stopped
  counting something before trusting any 0.15 baseline numbers.
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
