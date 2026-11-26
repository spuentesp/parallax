#!/usr/bin/env bash
# Publish each cluster's Lain startup checkpoint at image build time with `lain prewarm` (Lain >= 0.16.1).
# The next start (on Fly) then restores the graph instead of re-indexing for minutes, which would starve a
# 2-shared-CPU machine. prewarm fails the build, with the reason, if it cannot publish a checkpoint.
# It must run with the same paths the server will use (/repos/*.yaml, the data_dir inside them).
#
# Then, unless BAKE_SNAPSHOTS=0, it bakes the snapshot cache: each cluster's engine is started briefly and
# prepares the snapshot of its pinned commits (bake-snapshots.mjs), so a PR analysis only indexes the PR
# repo's base and head at runtime. Disable with `podman build --build-arg BAKE_SNAPSHOTS=0 ...`.
set -euo pipefail
lain prewarm --config /repos/repos-a.yaml
lain prewarm --config /repos/repos-b.yaml
echo "baked both startup checkpoints"

if [[ "${BAKE_SNAPSHOTS:-1}" == "0" ]]; then
  echo "BAKE_SNAPSHOTS=0: snapshot cache not baked"
  exit 0
fi

# The pinned commits are what clone-repos.sh checked out (seed-nvidia-demo.ts pins the same ones).
pins_json() { # pins_json <config>: {"<repo id>":"<HEAD sha of /repos/<id>>", ...}
  local out="" id
  for id in $(sed -n 's/^  - id: *//p' "/repos/$1"); do
    out+="${out:+,}\"$id\":\"$(git -C "/repos/$id" rev-parse HEAD)\""
  done
  echo "{$out}"
}

bake_cluster() { # bake_cluster <config> <port>
  local log="/tmp/bake-lain-$2.log" pid i body
  lain server --config "/repos/$1" --transport http --port "$2" > "$log" 2>&1 &
  pid=$!
  for i in $(seq 1 600); do
    body="$(curl -s -m 8 -X POST "http://127.0.0.1:$2/mcp" \
      -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_services","arguments":{"snapshot":"live"}}}' || true)"
    [[ "$body" == *'"result"'* ]] && break
    kill -0 "$pid" 2>/dev/null || { echo "lain ($1) exited:"; tail -30 "$log"; exit 1; }
    sleep 1
  done
  grep -q 'startup cache hit' "$log" || { echo "lain ($1) did not restore the prewarmed checkpoint:"; tail -30 "$log"; kill "$pid"; exit 1; }
  if ! node /usr/local/bin/bake-snapshots.mjs "http://127.0.0.1:$2/mcp" "$(pins_json "$1")"; then
    tail -30 "$log"; kill "$pid"; exit 1
  fi
  kill "$pid"; wait "$pid" 2>/dev/null || true
  rm -f "$log"
  # A record saved as pending/indexing makes Lain re-queue (re-index) all its repos at every boot.
  local dir rec
  dir="$(sed -n 's/^data_dir: *//p' "/repos/$1")"
  for rec in "$dir"/snapshots/snap_*.json; do
    grep -q '"state": *"ready"' "$rec" || { echo "snapshot record $rec not saved as ready:"; head -c 1500 "$rec"; exit 1; }
  done
}
bake_cluster repos-a.yaml 9999
bake_cluster repos-b.yaml 9998
echo "baked both snapshot caches"
