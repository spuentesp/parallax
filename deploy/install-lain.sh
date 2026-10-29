#!/usr/bin/env bash
# install-lain.sh — Download release binary OR compile from a branch tip.
#
# Usage:
#   ./deploy/install-lain.sh [TARGET_DIR] [VERSION_TAG]
#   ./deploy/install-lain.sh --branch dev [TARGET_DIR]
#   ./deploy/install-lain.sh --dev [TARGET_DIR]
#
# Examples:
#   ./deploy/install-lain.sh ~/lain          # downloads latest GitHub release binary
#   ./deploy/install-lain.sh --dev ~/lain    # compiles preview dev branch tip from source
#   ./deploy/install-lain.sh --branch dev    # compiles specified branch tip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if compile mode is requested
if [ "${1:-}" = "--dev" ]; then
  exec "$SCRIPT_DIR/build-lain.sh" "dev" "${2:-$HOME/lain}"
elif [ "${1:-}" = "--branch" ]; then
  exec "$SCRIPT_DIR/build-lain.sh" "${2:-dev}" "${3:-$HOME/lain}"
elif [ "${1:-}" = "--compile" ]; then
  exec "$SCRIPT_DIR/build-lain.sh" "${2:-dev}" "${3:-$HOME/lain}"
fi

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
