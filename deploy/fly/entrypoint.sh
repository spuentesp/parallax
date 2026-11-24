#!/usr/bin/env bash
# Fly entrypoint: Lain first (the API refuses to boot without it), then seed the two workspaces, then the API.
set -euo pipefail
start_lain() { # start_lain <config> <port>
  lain server --config "/repos/$1" --transport http --port "$2" > "/var/log/lain-$2.log" 2>&1 &
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
echo "==> seeding workspaces"
pnpm --filter @parallax/api exec tsx scripts/seed-nvidia-demo.ts

echo "==> parallax api on :${PORT:-8080}"
exec pnpm --filter @parallax/api exec tsx src/index.ts
