#!/usr/bin/env bash
# build-lain.sh — Fetch and compile Lain from a git branch tip (e.g. dev).
#
# Usage:
#   ./deploy/build-lain.sh [BRANCH] [TARGET_DIR] [REPO_URL] [BUILD_DIR]
#
# Examples:
#   ./deploy/build-lain.sh                  # builds 'dev' branch to ~/lain/lain
#   ./deploy/build-lain.sh dev ~/lain       # builds 'dev' branch to ~/lain/lain
#   ./deploy/build-lain.sh main /usr/local/bin

set -euo pipefail

BRANCH="${1:-${LAIN_BRANCH:-dev}}"
TARGET_DIR="${2:-${LAIN_DIR:-$HOME/lain}}"
REPO_URL="${3:-${LAIN_REPO:-https://github.com/spuentesp/lain.git}}"
BUILD_DIR="${4:-${LAIN_BUILD_DIR:-$HOME/src/lain-build}}"

echo "=========================================="
echo "  Compiling Lain from branch tip"
echo "  Repository: $REPO_URL"
echo "  Branch:     $BRANCH"
echo "  Target dir: $TARGET_DIR"
echo "  Build dir:  $BUILD_DIR"
echo "=========================================="

# 1. Ensure Rust & Cargo are available
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "==> Cargo not found in PATH. Checking $HOME/.cargo/bin..."
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
  else
    echo "==> Installing Rust toolchain via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
  fi
fi

echo "==> Rust toolchain: $(cargo --version)"

# 2. Check system build tools (if apt is available)
if command -v apt-get >/dev/null 2>&1 && [ "${SKIP_DEPS:-0}" != "1" ]; then
  MISSING_PKGS=()
  for pkg in build-essential pkg-config libssl-dev cmake git; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      MISSING_PKGS+=("$pkg")
    fi
  done
  if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    echo "==> Missing system packages: ${MISSING_PKGS[*]}"
    if [ "$(id -u)" -eq 0 ]; then
      apt-get update && apt-get install -y --no-install-recommends "${MISSING_PKGS[@]}"
    elif command -v sudo >/dev/null 2>&1; then
      echo "==> Running sudo apt-get to install build dependencies..."
      sudo apt-get update && sudo apt-get install -y --no-install-recommends "${MISSING_PKGS[@]}"
    else
      echo "Warning: cannot install packages automatically (no root/sudo). Continuing anyway..."
    fi
  fi
fi

# 3. Clone or update repository
mkdir -p "$(dirname "$BUILD_DIR")"
if [ -d "$BUILD_DIR/.git" ]; then
  echo "==> Updating existing repository in $BUILD_DIR..."
  cd "$BUILD_DIR"
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
  git fetch origin "$BRANCH" --depth 1
  git checkout -B "$BRANCH" "origin/$BRANCH"
else
  echo "==> Cloning $REPO_URL ($BRANCH) into $BUILD_DIR..."
  rm -rf "$BUILD_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$BUILD_DIR"
  cd "$BUILD_DIR"
fi

COMMIT_SHA="$(git rev-parse HEAD)"
echo "==> Checked out $BRANCH at commit $COMMIT_SHA"

# 4. Build Lain release binary
echo "==> Compiling Lain (cargo build --release --bin lain)..."
cargo build --release --bin lain

RELEASE_BIN="$BUILD_DIR/target/release/lain"
if [ ! -f "$RELEASE_BIN" ]; then
  echo "Error: expected build artifact not found at $RELEASE_BIN" >&2
  exit 1
fi

# 5. Install to target directory
mkdir -p "$TARGET_DIR"
cp "$RELEASE_BIN" "$TARGET_DIR/lain"
chmod +x "$TARGET_DIR/lain"

echo "=========================================="
echo "  Lain successfully built and installed!"
echo "  Location: ${TARGET_DIR}/lain"
echo "  Version:"
"${TARGET_DIR}/lain" --version || true
echo "  Built from commit: $COMMIT_SHA ($BRANCH)"
echo "=========================================="
