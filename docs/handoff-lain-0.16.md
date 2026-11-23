# Handoff: moving the Parallax installation to Lain 0.16.0

Date: 2026-11-22. Branch `spuentesp/fix-parallax-lain-dashboard` (4 local commits on top of `cf4d967`,
nothing pushed). Lain **0.16.0** was published 2026-11-22T15:55Z; its GitHub
release notes are empty, so everything below was measured, not read from a changelog.

## Status in one line

0.16.0 is compatible with Parallax as it is today (every call parsed by Parallax's own client and
Zod schemas, on two real federations) and fixes three of the items in `docs/lain-agent-report.md`.
The pin was bumped to **v0.16.0** after the Saleor run passed (see below).

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
   **Screens checked** (Parallax API `LAIN_ADAPTER=real` + web dev server against this 0.16.0 index, headless
   Chromium screenshots): Map (structure tree, graph with edges), Contracts (669 endpoints), Contract detail
   (`productCreate`: typed fields `ProductCreateInput!`, `[ProductError!]!`, `Product?`, who reads each), Coverage
   (3 of 3 repos ready, 32 unresolved, `not_a_call 1` chip, "221 endpoints have no schema" = 669 - 448). All render.
   Inspector also checked (Playwright + Chromium against the container-served bundle, no console errors):
   service panel shows 659 endpoints, consumers with proven bindings, and the scope note.
2. **Reindex existing data dirs.** 0.15 → 0.16 may change the on-disk format; 0.16 reported
   "coverage ledger missing; reindex required" for repos that had no ledger yet. Not tested on a
   migrated 0.15 data dir (none was kept). `install.sh` already runs `lain reindex` when the installed
   version differs from `LAIN_VERSION`, but that path is untested on a real upgrade.
3. **Raise the index budget for big repos (done: `install.sh` default is now 900).** Under the default 60 s (`LAIN_INDEX_TIMEOUT`,
   `install.sh` default 60) OpenShell and NemoClaw were marked Degraded and reported as `failed`
   with `error: null`. With 900 they indexed. Saleor indexed in about 2 minutes earlier on 0.15, so
   check that the demo VM is not at the edge.
4. **Bump the pin (done after the Saleor run; `demo:lain` now runs `test/lain-demo.ts`)** in `install.sh` (`LAIN_VERSION`, usage text, header comment), `README.md`,
   `deploy/RUNBOOK.md`, `deploy/.env.demo.example`, `docs/lain-tooling-inventory.md`,
   `test/lain-0.15-demo.ts` (rename) and the `demo:lain` script in `package.json`. Do this only
   after step 1 passes.
5. **VM OS: decided, Ubuntu 24.04** (runs the release binary; 22.04 would need the source build). `deploy/RUNBOOK.md`
   now says 24.04.

### Tested 2026-11-22 after the first pass

- **Upgrade from real 0.15 data: works.** 0.16 refuses a 0.15 data dir (`written by schema v5; this build expects
  v7. Run lain reindex`). After `lain reindex --config ...` (2m47 on cluster A, 12 cores; old graph kept as `.bak`)
  all 3 repos are `indexed` and the 203 contracts equal a fresh 0.16 index. The server needs a few more minutes
  after start before `get_coverage` leaves `not_ready`; `install.sh` waits via `LAIN_INDEX_TIMEOUT_SEC`.
  The warning text in `install.sh` still says "schema v4 -> v5"; make it version-neutral when bumping.
- **`gate:graphql` passes on 0.16.0** (with the version assert changed; the checked-in script still asserts 0.15.0).
- **The Dockerfile builds and runs under podman (6.1.4), the seed script and the access rules work** (no token 401,
  read-only token 403 on writes, live Saleor data).
- **FOUND and FIXED: the container could not reach Lain (both 0.15.0 and 0.16.0).** Lain answers `403` to any
  `Host` that is not loopback, so `host.docker.internal` through the socat relay failed at boot
  (`lain handshake returned HTTP 403`). Fix: both compose services use `network_mode: host`, `LAIN_URL` is
  `http://127.0.0.1:<port>/mcp`, Caddy proxies to `127.0.0.1:8080`, and the API gets a new `HOST` setting (compose sets
  `127.0.0.1`, default stays `0.0.0.0`) so port 8080 is not public. `install.sh` no longer installs socat, the bridge
  lookup or the `lain-relay` unit (it removes an old one on re-run). Tested under podman: image rebuilt, container
  on the host network answers on loopback only (the LAN IP is refused), seed works, read-only token 403 on writes,
  Caddy (host mode, high port) proxies the API and web bundle. **Not tested:** `install.sh` itself, ports 80/443
  and certificates, a Docker (not podman) daemon. Port 8080 must be free on the VM.

- **`install.sh` ran end to end in a throwaway Ubuntu 24.04 container (podman), exit 0, pin v0.16.0.** Real: apt
  packages, release download and SHA256 check, **the 0.16.0 binary runs on 24.04** (glibc 2.39), the Saleor clones,
  `repos.yaml`, the engine (no-systemd fallback) indexing all 3 repos, `.env` and token generation, the image
  build, the seed and cleanup commands, the control script. Stubbed: `docker` (a logging stub; the image build and
  compose were not real in that run, they were tested separately under podman, see above).
- **FOUND and FIXED by that run:** the index wait parsed `/health/index-status` assuming `"id"` before `"health"`,
  but Lain emits `{"health":"ready","id":"repo"}`; the `grep` never matched and, under `set -e` + `pipefail`,
  the installer aborted at line 574 right after the engine started. Now order-independent and non-fatal.
  (Likely hit on any Lain version; it was missed because earlier container runs never reached a live engine.)

### Still unverified, in order of risk

- **On a real VM (the only thing left):** systemd units (the container used the no-systemd fallback), a real Docker
  daemon, Caddy on 80/443 with a certificate, and the public HTTPS URL. (The RUNBOOK says the compose
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
