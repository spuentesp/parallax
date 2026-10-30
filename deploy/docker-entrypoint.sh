#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  Parallax All-in-One Cloud Entrypoint"
echo "=========================================="

mkdir -p /var/log

# Performance optimization: file watcher and commit sync are disabled in static container environment
export LAIN_DISABLE_FILE_WATCHER=1
export LAIN_DISABLE_COMMIT_SYNC=1

# 1. Start Lain federation server in background
if [ -x "/usr/local/bin/lain" ] && [ -f "/repos/repos.yaml" ]; then
  echo "==> Starting Lain federation server on port 9999 in background..."
  cd /repos
  /usr/local/bin/lain server --config /repos/repos.yaml --transport http --port 9999 > /var/log/lain.log 2>&1 &
  LAIN_PID=$!
  echo "    Lain started with PID $LAIN_PID"
else
  echo "==> Running with external or mock Lain."
fi

# 2. Seed / sync database with EXACTLY the two NVIDIA workspaces (ws_cluster_a & ws_cluster_b)
cd /app
export LAIN_URL="${LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_A_LAIN_URL="${CLUSTER_A_LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_B_LAIN_URL="${CLUSTER_B_LAIN_URL:-http://127.0.0.1:9999/mcp}"

echo "==> Ensuring database at ${DATABASE_PATH:-/data/parallax.db} has strictly the 2 NVIDIA workspaces..."
pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts || {
  echo "Warning: workspace seeding returned non-zero."
}

# 3. Start Parallax web & API server immediately so Fly proxy connects instantly
echo "==> Starting Parallax server on port ${PORT:-8080}..."
exec pnpm --filter @parallax/api exec tsx src/index.ts
