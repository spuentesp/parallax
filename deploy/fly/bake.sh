#!/usr/bin/env bash
# Run each Lain engine to completion once at image build time so it publishes its startup checkpoint
# ("federation startup cache: completed graph published"). The next start (on Fly) then restores the graph
# instead of re-indexing for minutes, which would starve a 2-shared-CPU machine.
set -euo pipefail
bake() { # bake <config> <port>
  lain server --config "/repos/$1" --transport http --port "$2" > "/tmp/bake-$2.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 1200); do
    grep -q "federation startup cache: completed graph published" "/tmp/bake-$2.log" && break
    kill -0 "$pid" 2>/dev/null || { echo "lain ($1) exited early:"; tail -20 "/tmp/bake-$2.log"; exit 1; }
    sleep 3
  done
  grep -q "completed graph published" "/tmp/bake-$2.log" || { echo "no checkpoint for $1:"; tail -20 "/tmp/bake-$2.log"; exit 1; }
  sleep 5; kill -TERM "$pid"; wait "$pid" 2>/dev/null || true
  echo "baked $1"
}
bake repos-a.yaml 9999
bake repos-b.yaml 9998
