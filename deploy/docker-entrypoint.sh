#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  Parallax All-in-One Cloud Entrypoint"
echo "=========================================="

# 1. Start Lain federation server if binary and config exist
if [ -x "/usr/local/bin/lain" ] && [ -f "/repos/repos.yaml" ]; then
  echo "==> Starting Lain federation server on port 9999..."
  cd /repos
  /usr/local/bin/lain server --config /repos/repos.yaml --transport http --port 9999 &
  LAIN_PID=$!
  echo "    Lain started with PID $LAIN_PID"

  echo "==> Waiting for Lain MCP endpoint to become responsive..."
  for i in $(seq 1 30); do
    if node -e "fetch('http://127.0.0.1:9999/mcp').then(r => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
      echo "    Lain federation server is ready!"
      break
    fi
    sleep 1
  done
else
  echo "==> Running with external or mock Lain."
fi

# 2. Seed database with workspaces (ws_cluster_a & ws_cluster_b)
cd /app
echo "==> Seeding workspaces..."
export LAIN_URL="${LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_A_LAIN_URL="${CLUSTER_A_LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_B_LAIN_URL="${CLUSTER_B_LAIN_URL:-http://127.0.0.1:9999/mcp}"

pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts || {
  echo "Warning: workspace seeding returned non-zero (database already initialized or partial)."
}

# 3. Start Parallax web & API server
echo "==> Starting Parallax server on port ${PORT:-8080}..."
exec pnpm --filter @parallax/api exec tsx src/index.ts
