#!/usr/bin/env bash
# clone-nvidia-repos.sh — Clone or update the NVIDIA stack repositories for Lain indexing.
#
# Usage:
#   ./deploy/clone-nvidia-repos.sh [TARGET_DIR]
#
# Defaults to $HOME/nvidia

set -euo pipefail

TARGET_DIR="${1:-$HOME/nvidia}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

echo "=========================================="
echo "  Cloning NVIDIA Stack Repositories"
echo "  Target: $TARGET_DIR"
echo "=========================================="

REPOS=(
  "https://github.com/NVIDIA/NeMo-Agent-Toolkit.git"
  "https://github.com/NVIDIA/NeMo-Agent-Toolkit-UI.git"
  "https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples.git"
  "https://github.com/NVIDIA/OpenShell.git"
  "https://github.com/NVIDIA/NeMo-Fabric.git"
  "https://github.com/NVIDIA/NemoClaw.git"
)

for repo in "${REPOS[@]}"; do
  dir="$(basename "$repo" .git)"
  if [ -d "$dir/.git" ]; then
    echo "  [UPDATE] $dir already exists, pulling..."
    git -C "$dir" pull --ff-only || true
  else
    echo "  [CLONE]  Cloning $dir..."
    git clone --depth 1 "$repo" "$dir"
  fi
done

echo "=========================================="
echo "  All 6 NVIDIA repos ready in $TARGET_DIR"
echo "=========================================="
