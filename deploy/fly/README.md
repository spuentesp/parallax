# Fly.io demo (the two NVIDIA clusters)

App `marbled-river-9619` (region gru), one machine, 8 GB / 4 shared CPUs (`shared-cpu-4x`, no swap),
`min_machines_running = 1`.
Image: `Dockerfile.fly` = Ubuntu 24.04 + Lain v0.16.3 (release binary, sha256-checked) + Parallax + six NVIDIA repos
cloned at pinned commits (`clone-repos.sh`, LFS not smudged so the worktrees are clean).

## Why the image looks like this
- **One Lain per cluster** (`repos-a.yaml` on :9999, `repos-b.yaml` on :9998): a single federation would show both
  clusters' services in both workspaces. `seed-nvidia-demo.ts` points `ws_cluster_a`/`ws_cluster_b` at their engine.
- **`bake.sh` runs `lain prewarm` for each cluster at build time** (needs Lain >= 0.16.1). `lain server` re-indexes
  everything on every start unless a startup checkpoint exists. `prewarm` publishes it and fails the build, with the
  reason, if it cannot. Without the baked checkpoint, a cold start on shared CPUs spends minutes indexing and the
  API's boot handshake times out. A start that does not restore it logs `federation startup cache miss: <reason>`.
  The checkpoint needs clean worktrees, which is why the clone script sets `GIT_LFS_SKIP_SMUDGE=1`, and prewarm must
  use the same config paths and `LAIN_*` environment as the server (the Dockerfile sets them before the bake).
- **`bake.sh` also bakes the snapshot cache** (on by default; `--build-arg BAKE_SNAPSHOTS=0` turns it off). It starts
  each engine briefly and prepares the snapshot of the pinned commits (`bake-snapshots.mjs`), then stops it. A PR
  analysis snapshots every workspace repo, the non-PR ones at their pin; with the bake, and Lain >= 0.16.2 reusing
  cached entries, only the PR repo's base and head are indexed at runtime. The build fails if an engine does not
  restore the prewarmed checkpoint or a snapshot record is not saved as `ready`. This makes
  `PARALLAX_WARM_SNAPSHOTS` unnecessary. The cache is keyed by the Lain build, so it is rebuilt with every bump.
- The graphs live in `/lain-data-a` and `/lain-data-b`, **not** on the `/data` volume (the mount would hide them).
- `entrypoint.sh` waits for each engine to answer `list_services` before starting the API (it refuses to boot without Lain).

## Build, push, deploy (the remote Fly builder is too small to index, so build locally)
```
podman build -f Dockerfile.fly -t parallax-fly .
fly auth token | podman login registry.fly.io -u x --password-stdin
podman tag parallax-fly registry.fly.io/marbled-river-9619:deployment-<tag>
podman push registry.fly.io/marbled-river-9619:deployment-<tag>
fly deploy --image registry.fly.io/marbled-river-9619:deployment-<tag> -a marbled-river-9619 --config fly.toml --strategy immediate --yes
```
Secrets (set once, `fly secrets set ... -a marbled-river-9619`): `PARALLAX_TOKENS`, `NEBIUS_TOKEN`, `TAVILY_TOKEN`,
`QUERY_RATE_LIMIT_PER_HOUR`. Keep `PARALLAX_TOKENS` unchanged so shared links keep working.

## Roll back
`fly releases -a marbled-river-9619`, then `fly deploy --image <the old release's image> ...`. v27 (Lain 0.16.3, before
the explain and consumer-count fixes, 2026-11-28) is `registry.fly.io/marbled-river-9619:deployment-20261127-v0163`. v26 (Lain 0.16.2,
2026-11-25) is `registry.fly.io/marbled-river-9619:deployment-20261125-v0162`. v19 (the 0.1.0 / Lain 0.13
build of 2026-10-30) is `registry.fly.io/marbled-river-9619:deployment-01M671FR27VQFRKNZHNESBMWX4`.

## Gotchas
- The free Fly trial kills machines after 5 minutes; the account needs a card on file.
- A restart takes ~1 minute before the first answer; the health check has a 6-minute grace period.
- Memory: both engines + API sit around 2.1 GB at rest. 8 GB is the most Fly offers on shared CPUs; with Lain
  0.16.2 it holds an analysis of a new pull request, but with little room for a series of them (see below).

## Memory: what an analysis of a new commit costs

**Lain 0.16.3 (deployed 2026-11-28, v27).** Same recipe on this image (4 GB cap, whole container, engine A,
#4995 then #6003): settled 1.6 GB, peaks **2.7 GB** and **3.0 GB**, 2.3 GB at rest after both, no engine
restarted. 0.16.3 returns freed C-heap and allocator memory after every snapshot build and index job, and the
gRPC consumer sensor no longer holds every Rust parse tree at once. The 0.16.1/0.16.2 history below is kept
for reference.

Measured by running the deployed image under podman with a 4 GB RAM cap (swap allowed) and sampling the
cgroup's `memory.current + memory.swap.current` every 2 s; the engine's own log lines say what it was doing.

| Moment | Lain 0.16.1 (2026-11-25) | Lain 0.16.2 (2026-11-26) |
|---|---|---|
| Started, graph restored from the baked checkpoint | about 1.7 GB (cluster A engine 1.2 GB) | about 2.6 GB |
| After the pinned snapshots are built (warm-up) | about 3.6 GB | not measured |
| Analysis of NVIDIA/OpenShell #4995 (a base that is not the pinned commit) | peaks near 7.3 GB, killed on Fly | peaks at 5.6 GB, READY in under 3 min |
| Right after it, NVIDIA/OpenShell #6003 (another new base, 26 files) | not measured | peaks at 6.2 GB, PARTIAL (symbol limit), 2 min |
| At rest after both | not measured | about 5.1 GB |

Lain builds a snapshot of **every repository in the workspace** for each commit it has not seen (NemoClaw
alone is 6,653 files and 825k references), keeps up to `LAIN_SNAPSHOT_RESIDENT` (default 2, one for each end
of a diff) resident next to the live graph, and does not give all the memory back afterwards. The Fly machine
has 7.9 GB and no swap. On 0.16.1 an analysis of a new commit ended with the kernel killing the engine
(`Out of memory: Killed process … (lain)`). 0.16.2 (no per-commit re-indexing of cached repositories, one
snapshot worker pool per data dir) keeps two back-to-back analyses under that limit, with about 1.7 GB to
spare at the peak, and neither engine restarted. Whether a longer series stays under it was not tested: memory
at rest grew from 2.6 to 5.1 GB over the two. Things that do **not** help: `LAIN_SNAPSHOT_WORKERS=1` (peak
unchanged on 0.16.1), and `LAIN_INDEX_CACHE_MB` (that is an on-disk budget).

What the image does about it:

- **Lain 0.16.2** stops a snapshot job from re-indexing a repo commit that is already in the cache, gives
  each queued job to one worker only, and no longer rebuilds the live graph when only `.git` changed (the
  watcher is off here anyway).
- **`LAIN_SNAPSHOT_RESIDENT_IDLE_SECS=60`** drops a snapshot view nobody has used for a minute. Without it the
  views of the last analysis stay loaded and add about 1.2 GB to the next one.
- **The engines are supervised.** `entrypoint.sh` restarts an engine that dies, about 30 s later (tested by
  letting the kernel kill it). Before this a dead engine stayed dead, `/api/health` still said `ok`, and
  every new analysis failed with `lain call failed: fetch failed` until the machine was restarted. The
  panel, the tools and the stored analyses read cached data and never noticed.
- **`PARALLAX_WARM_SNAPSHOTS=1` (off by default)** builds the pinned snapshots in the background after
  start (about 3 minutes), so the first analysis of a pull request only has to index that pull request.
  It costs about 1 GB more at rest, which is why it is not on for the judges' machine.
- **The worker waits for a slow snapshot** (up to 15 minutes, asking Lain to wait 20 s per call). It used
  to ask for 60 s, longer than the adapter's 30 s HTTP timeout, so a slow build was reported as
  `exhausted retries` after about 100 s while Lain kept working. This does not help when Lain itself stops
  answering because the machine is out of memory.

To run many analyses of arbitrary pull requests safely you still want a machine with more memory (16 GB or
more), or to exclude a repository from the analysis (`excludeRepos`), which declares the coverage gap.

## Requesting an analysis (off by default)

`POST /api/pr-requests` (scope `request`) can start the analysis of a pull request: it fetches the PR's
commits into the checkout, then runs the normal assessment. It is limited to the repositories listed in
`PARALLAX_REQUEST_ALLOWLIST` (`owner/repo=workspaceId`, comma-separated), runs one analysis at a time for
the whole server, pauses ten minutes after a failure and accepts at most six requests per hour. **It is
disabled unless that variable is set, and the demo does not set it.**

Why it is off: see the memory section above. On Lain 0.16.1 one such analysis took the cluster A engine to
7.4 GB on the 8 GB demo machine and the kernel killed it (NVIDIA/OpenShell #4995). On 0.16.2 the same
analysis peaks at 5.6 GB in a local run with the same cap, but memory at rest grows with each new base commit, so it
is still off on the judges' machine. Turning it on is a decision, not a fix.
