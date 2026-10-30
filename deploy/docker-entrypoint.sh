#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  Parallax All-in-One Cloud Entrypoint"
echo "=========================================="

mkdir -p /var/log /data/lain-federation

# If persistent cache does not exist on /data, initialize from pre-baked image cache if available
if [ ! -f "/data/lain-federation/federated_graph.bin" ] && [ -d "/var/cache/lain-federation" ]; then
  echo "==> Initializing persistent Lain cache from image cache..."
  cp -a /var/cache/lain-federation/* /data/lain-federation/ || true
fi

# 1. Start Lain federation server if binary and config exist
if [ -x "/usr/local/bin/lain" ] && [ -f "/repos/repos.yaml" ]; then
  echo "==> Starting Lain federation server on port 9999..."
  cd /repos
  /usr/local/bin/lain server --config /repos/repos.yaml --transport http --port 9999 > /var/log/lain.log 2>&1 &
  LAIN_PID=$!
  echo "    Lain started with PID $LAIN_PID"

  echo "==> Waiting for Lain MCP endpoint to become responsive..."
  READY=0
  for i in $(seq 1 45); do
    if node -e "fetch('http://127.0.0.1:9999/mcp').then(r => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
      echo "    Lain federation server is ready on port 9999!"
      READY=1
      break
    fi
    sleep 1
  done

  if [ "$READY" -eq 0 ]; then
    echo "Warning: Lain did not respond within 45s. Log output:"
    cat /var/log/lain.log || true
  fi
else
  echo "==> Running with external or mock Lain."
fi

# 2. Seed database with EXACTLY the two NVIDIA workspaces (ws_cluster_a & ws_cluster_b)
cd /app
export LAIN_URL="${LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_A_LAIN_URL="${CLUSTER_A_LAIN_URL:-http://127.0.0.1:9999/mcp}"
export CLUSTER_B_LAIN_URL="${CLUSTER_B_LAIN_URL:-http://127.0.0.1:9999/mcp}"

if [ ! -f "/data/parallax.db" ]; then
  echo "==> Initializing and seeding database at /data/parallax.db..."
  pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts || {
    echo "Warning: workspace seeding returned non-zero."
  }
else
  echo "==> Database already present at /data/parallax.db."
fi

# 3. Start Parallax web & API server
echo "==> Starting Parallax server on port ${PORT:-8080}..."
exec pnpm --filter @parallax/api exec tsx src/index.ts
