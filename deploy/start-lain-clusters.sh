#!/usr/bin/env bash
# start-lain-clusters.sh — Start Lain servers for Cluster A (port 9991) and Cluster B (port 9992).
#
# Usage:
#   ./deploy/start-lain-clusters.sh [LAIN_BIN]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAIN_BIN="${1:-$HOME/lain/lain}"

if [ ! -x "$LAIN_BIN" ]; then
  echo "Error: Lain binary not found or not executable at $LAIN_BIN" >&2
  echo "Compile or install it first using: ./deploy/build-lain.sh dev" >&2
  exit 1
fi

echo "=========================================="
echo "  Starting Lain Server Clusters"
echo "  Binary: $LAIN_BIN"
echo "=========================================="

echo "==> Starting Cluster A (OpenShell RPC Stack) on port 9991..."
"$LAIN_BIN" server --config "$SCRIPT_DIR/cluster-a.yaml" --transport http --port 9991 > /tmp/lain-cluster-a.log 2>&1 &
PID_A=$!
echo "    PID: $PID_A | Log: /tmp/lain-cluster-a.log"

echo "==> Starting Cluster B (NeMo Agent Toolkit HTTP Stack) on port 9992..."
"$LAIN_BIN" server --config "$SCRIPT_DIR/cluster-b.yaml" --transport http --port 9992 > /tmp/lain-cluster-b.log 2>&1 &
PID_B=$!
echo "    PID: $PID_B | Log: /tmp/lain-cluster-b.log"

echo "=========================================="
echo "  Both clusters running in background."
echo "  Cluster A URL: http://localhost:9991/mcp"
echo "  Cluster B URL: http://localhost:9992/mcp"
echo "=========================================="
