# Fly.io demo (the two NVIDIA clusters)

App `marbled-river-9619` (region gru), one machine, 4 GB / 2 shared CPUs, `min_machines_running = 1`.
Image: `Dockerfile.fly` = Ubuntu 24.04 + Lain v0.16.0 (release binary, sha256-checked) + Parallax + six NVIDIA repos
cloned at pinned commits (`clone-repos.sh`, LFS not smudged so the worktrees are clean).

## Why the image looks like this
- **One Lain per cluster** (`repos-a.yaml` on :9999, `repos-b.yaml` on :9998): a single federation would show both
  clusters' services in both workspaces. `seed-nvidia-demo.ts` points `ws_cluster_a`/`ws_cluster_b` at their engine.
- **`bake.sh` runs each engine to completion at build time.** `lain server` re-indexes everything on every start unless
  a startup checkpoint exists, and only a complete `lain server` run writes it (`lain reindex` does not; see
  `src/cli/server.rs` in Lain). Without the baked checkpoint, a cold start on 2 shared CPUs spends minutes indexing and
  the API's boot handshake times out. With it, cold start is ~30 s here and nothing is re-indexed. The checkpoint needs
  clean worktrees, which is why the clone script sets `GIT_LFS_SKIP_SMUDGE=1`.
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
`fly releases -a marbled-river-9619`, then `fly deploy --image <the old release's image> ...`. v19 (the 0.1.0 / Lain 0.13
build of 2026-10-30) is `registry.fly.io/marbled-river-9619:deployment-01M671FR27VQFRKNZHNESBMWX4`.

## Gotchas
- The free Fly trial kills machines after 5 minutes; the account needs a card on file.
- A restart takes ~1 minute before the first answer; the health check has a 6-minute grace period.
- Memory: both engines + API sit around 2.1 GB at rest; 4 GB leaves room for the Ask path.
