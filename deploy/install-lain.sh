#!/usr/bin/env bash
# install-lain.sh — Download and verify the latest (or specified) Lain binary.
#
# Usage:
#   ./deploy/install-lain.sh [TARGET_DIR] [VERSION_TAG]
#
# Examples:
#   ./deploy/install-lain.sh ~/lain          # downloads latest release
#   ./deploy/install-lain.sh ~/lain v0.13.0  # downloads specific version

set -euo pipefail

TARGET_DIR="${1:-$HOME/lain}"
REQUESTED_TAG="${2:-}"

mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

echo "==> Determining Lain version..."
if [ -n "$REQUESTED_TAG" ]; then
  TAG="$REQUESTED_TAG"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  TAG="$(gh release view -R spuentesp/lain --json tagName -q .tagName)"
else
  # Fallback to GitHub API
  TAG="$(curl -sSL -H 'Accept: application/vnd.github.v3+json' https://api.github.com/repos/spuentesp/lain/releases/latest | grep '"tag_name":' | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
fi

if [ -z "$TAG" ]; then
  echo "Warning: Could not fetch latest tag from GitHub; defaulting to v0.13.0"
  TAG="v0.13.0"
fi

VERSION="${TAG#v}"
TARBALL="lain-${VERSION}-x86_64-unknown-linux-gnu.tar.gz"

echo "==> Downloading Lain $TAG ($TARBALL)..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh release download "$TAG" -R spuentesp/lain -p "$TARBALL" -p SHA256SUMS --clobber
else
  curl -fsSL -O "https://github.com/spuentesp/lain/releases/download/${TAG}/${TARBALL}"
  curl -fsSL -O "https://github.com/spuentesp/lain/releases/download/${TAG}/SHA256SUMS"
fi

echo "==> Verifying SHA256..."
grep "${TARBALL}$" SHA256SUMS | sha256sum -c -

echo "==> Extracting binary..."
tar xzf "$TARBALL"

if [ -x "./lain" ]; then
  echo "==> Successfully installed Lain:"
  ./lain --version || true
  echo "Installed location: ${TARGET_DIR}/lain"
else
  echo "Error: lain binary not found or not executable after extraction" >&2
  exit 1
fi
