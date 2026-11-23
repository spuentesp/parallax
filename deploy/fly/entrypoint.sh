#!/usr/bin/env bash
# Fly entrypoint: Lain first (the API refuses to boot without it), then seed the two workspaces, then the API.
set -euo pipefail
LAIN_PORT="${LAIN_PORT:-9999}"
echo "==> lain server on :${LAIN_PORT}"
lain server --config /repos/repos.yaml --transport http --port "$LAIN_PORT" > /var/log/lain.log 2>&1 &
LAIN_PID=$!

for i in $(seq 1 180); do
  code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${LAIN_PORT}/mcp" || true)"
  [[ "$code" != "000" ]] && { echo "    lain answers (HTTP $code) after ~${i}s"; break; }
  kill -0 "$LAIN_PID" 2>/dev/null || { echo "lain exited:"; tail -20 /var/log/lain.log; exit 1; }
  sleep 1
done

cd /app
echo "==> seeding workspaces"
pnpm --filter @parallax/api exec tsx scripts/seed-nvidia-demo.ts

echo "==> parallax api on :${PORT:-8080}"
exec pnpm --filter @parallax/api exec tsx src/index.ts
