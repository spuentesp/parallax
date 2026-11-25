#!/usr/bin/env bash
# Fly entrypoint: Lain first (the API refuses to boot without it), then seed the two workspaces, then the API.
set -euo pipefail
# An engine that dies (the kernel kills it when an analysis of a new commit runs the machine out of
# memory) comes back by itself: restore from the baked checkpoint takes about a minute, the snapshots
# already built stay on disk. Without this the dead engine stayed dead, /api/health still said ok,
# and every new analysis failed with "lain call failed: fetch failed" until the machine was restarted.
# A crash loop (five exits within ten seconds each) stops the supervisor instead of spinning.
supervise() { # supervise <config> <port>
  local quick=0 started code
  while true; do
    started=$(date +%s)
    code=0
    # `|| code=$?` keeps `set -e` from ending the supervisor with the engine.
    lain server --config "/repos/$1" --transport http --port "$2" >> "/var/log/lain-$2.log" 2>&1 || code=$?
    echo "[supervisor] lain on :$2 exited with status $code at $(date -u +%FT%TZ)" | tee -a "/var/log/lain-$2.log"
    if [ $(( $(date +%s) - started )) -lt 10 ]; then quick=$((quick + 1)); else quick=0; fi
    if [ "$quick" -ge 5 ]; then
      echo "[supervisor] lain on :$2 keeps exiting right after it starts; giving up" | tee -a "/var/log/lain-$2.log"
      return 1
    fi
    sleep 3
  done
}
start_lain() { # start_lain <config> <port>; prints the supervisor's pid
  supervise "$1" "$2" > /dev/null &
  echo $!
}
echo "==> lain engines: cluster A on :9999, cluster B on :9998"
PID_A="$(start_lain repos-a.yaml 9999)"
PID_B="$(start_lain repos-b.yaml 9998)"

# The API's boot handshake ends with a list_services call; wait until the engine answers it (an engine that
# only accepts connections is still loading its graph).
wait_for() { # wait_for <port> <pid>
  for i in $(seq 1 300); do
    body="$(curl -s -m 8 -X POST "http://127.0.0.1:$1/mcp" \
      -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_services","arguments":{"snapshot":"live"}}}' || true)"
    [[ "$body" == *'"result"'* ]] && { echo "    :$1 ready after ~${i}s"; return 0; }
    kill -0 "$2" 2>/dev/null || { echo "lain on :$1 exited:"; tail -20 "/var/log/lain-$1.log"; exit 1; }
    sleep 1
  done
  echo "lain on :$1 not ready in 300s"; tail -20 "/var/log/lain-$1.log"; exit 1
}
wait_for 9999 "$PID_A"
wait_for 9998 "$PID_B"

cd /app
# Optional: build the snapshots of the pinned commits now, while the machine is idle, so that the first
# analysis of a pull request only has to index that pull request. Off by default: it holds about 1 GB
# more and uses CPU for a few minutes after every start.
if [ "${PARALLAX_WARM_SNAPSHOTS:-0}" = "1" ]; then
  echo "==> warming pinned snapshots in the background (PARALLAX_WARM_SNAPSHOTS=1)"
  node deploy/fly/warm-snapshots.mjs /repos/repos-a.yaml http://127.0.0.1:9999/mcp >> /var/log/warm-snapshots.log 2>&1 &
fi

echo "==> seeding workspaces"
pnpm --filter @parallax/api exec tsx scripts/seed-nvidia-demo.ts

echo "==> parallax api on :${PORT:-8080}"
exec pnpm --filter @parallax/api exec tsx src/index.ts
