#!/usr/bin/env bash
#
# install.sh — one-command install of the Parallax demo stack on a fresh
# Linux machine (Ubuntu/Debian).
#
# What it puts on the box:
#   1. System packages: git, build toolchain (for the Rust engine), socat.
#   2. Docker, if the machine has none.
#   3. Lain — built from the `dev` branch of spuentesp/lain (not `main`).
#   4. The Saleor demo repos (shallow clones) + the federation config.
#   5. The engine as a service on 127.0.0.1:9999, plus a loopback relay so
#      the Parallax container can reach it without exposing it to the world.
#   6. deploy/.env with generated tokens, and the Parallax stack
#      (docker compose: api + web bundle + Caddy for HTTPS).
#   7. The demo workspace (Saleor) seeded in the database.
#
# Usage:
#   sudo ./install.sh --domain demo.example.com --nebius-token ntb_...
#
# Re-running the script is safe: it skips finished steps and keeps whatever
# is already in deploy/.env (it backs the file up before rewriting it).

set -euo pipefail

# Kept so the script can re-execute itself under sudo without losing flags.
ORIGINAL_ARGS=("$@")

# --------------------------------------------------------------------------
# Configuration (every value can be overridden from the environment)
# --------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"

LAIN_REPO_URL="${LAIN_REPO_URL:-https://github.com/spuentesp/lain.git}"
LAIN_BRANCH="${LAIN_BRANCH:-dev}"
LAIN_SRC_DIR="${LAIN_SRC_DIR:-/opt/lain/src}"
LAIN_BIN_DIR="${LAIN_BIN_DIR:-/usr/local/bin}"
LAIN_PORT="${LAIN_PORT:-9999}"
LAIN_HOST="${LAIN_HOST:-127.0.0.1}"
LAIN_DISABLE_LSP="${LAIN_DISABLE_LSP:-0}"
LAIN_LSP_LEAN="${LAIN_LSP_LEAN:-0}"
LAIN_INDEX_TIMEOUT="${LAIN_INDEX_TIMEOUT:-60}"
# Independent operator wait for the whole demo, not Lain's per-repo pipeline budget.
LAIN_INDEX_TIMEOUT_SEC="${LAIN_INDEX_TIMEOUT_SEC:-1800}"

PREFIX="${PREFIX:-/opt/parallax}"
ENGINE_DIR="$PREFIX/lain"
ENGINE_CONFIG="$ENGINE_DIR/repos.yaml"
ENGINE_DATA_DIR="$ENGINE_DIR/data"
ENGINE_LOG="${ENGINE_LOG:-/var/log/lain.log}"
ENGINE_UNIT_DIR="${ENGINE_UNIT_DIR:-/etc/systemd/system}"
CONTROL_BIN="${CONTROL_BIN:-/usr/local/bin/parallax-stack}"

DEMO_DIR="${DEMO_DIR:-$REPO_ROOT/test-repos}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_saleor}"

DOMAIN="${DOMAIN:-}"
NEBIUS_TOKEN="${NEBIUS_TOKEN:-}"
LAIN_BIN="${LAIN_BIN:-}"      # path to a prebuilt lain binary (skips the Rust build)
SKIP_DOCKER=0
SKIP_LAIN_BUILD=0
SKIP_DEMO=0
SKIP_BUILD=0
KEEP_EXTRA_WORKSPACES=0
ASSUME_YES=0

# --------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''
fi

STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d/%d] %s%s\n' "$C_BLUE" "$STEP" "$TOTAL_STEPS" "$1" "$C_RESET"; }
info() { printf '      %s\n' "$1"; }
dim()  { printf '      %s%s%s\n' "$C_DIM" "$1" "$C_RESET"; }
ok()   { printf '      %s✓ %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
warn() { printf '      %s! %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
die()  { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

on_error() {
  local code=$?
  printf '\n%serror:%s install failed at line %s (exit %s).\n' \
    "$C_RED" "$C_RESET" "${BASH_LINENO[0]:-?}" "$code" >&2
  printf 'Re-run the script; finished steps are skipped.\n' >&2
  exit "$code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
Install Parallax + Lain (dev branch) + the Saleor demo on a fresh Linux box.

  sudo ./install.sh --domain <name> [--nebius-token <token>]

Options:
  --domain <name>          Public DNS name for the demo (or an IP.nip.io name).
                           Caddy gets the TLS certificate for it.
  --nebius-token <token>   Nebius Token Factory key. Without it the structural
                           analysis still works; the investigator does not.
  --lain-bin <path>        Use this lain binary instead of building from source.
  --keep-extra-workspaces  Keep the seed's Online Boutique / Contracts Fixture
                           workspaces (they need their own engines to work).
  --skip-docker            Do not install Docker (assume it is there).
  --skip-lain-build        Do not build lain (assume `lain` is on PATH).
  --skip-demo              Do not clone the Saleor demo repos.
  --skip-build             Do not rebuild the container image.
  -y, --yes                Never prompt; use the values from the environment.

Environment overrides: DOMAIN, NEBIUS_TOKEN, LAIN_BRANCH, LAIN_PORT,
LAIN_REPO_URL, LAIN_BIN, LAIN_DISABLE_LSP, LAIN_LSP_LEAN, LAIN_INDEX_TIMEOUT,
LAIN_INDEX_TIMEOUT_SEC, PREFIX, DEMO_DIR, WORKSPACE_ID.
EOF
}

# --------------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --nebius-token) NEBIUS_TOKEN="${2:-}"; shift 2 ;;
    --lain-bin) LAIN_BIN="${2:-}"; shift 2 ;;
    --keep-extra-workspaces) KEEP_EXTRA_WORKSPACES=1; shift ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    --skip-lain-build) SKIP_LAIN_BUILD=1; shift ;;
    --skip-demo) SKIP_DEMO=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ "$LAIN_INDEX_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die "LAIN_INDEX_TIMEOUT must be positive seconds"
[[ "$LAIN_INDEX_TIMEOUT_SEC" =~ ^[1-9][0-9]*$ ]] || die "LAIN_INDEX_TIMEOUT_SEC must be positive seconds"

TOTAL_STEPS=12

# --------------------------------------------------------------------------
# Small utilities
# --------------------------------------------------------------------------

require_root() {
  if [[ $EUID -eq 0 ]]; then
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    die "run this script as root (sudo ./install.sh)"
  fi
  printf 'need root: re-running under sudo...\n'
  exec sudo env \
    DOMAIN="$DOMAIN" NEBIUS_TOKEN="$NEBIUS_TOKEN" LAIN_BRANCH="$LAIN_BRANCH" \
    LAIN_PORT="$LAIN_PORT" LAIN_REPO_URL="$LAIN_REPO_URL" LAIN_BIN="$LAIN_BIN" \
    LAIN_DISABLE_LSP="$LAIN_DISABLE_LSP" LAIN_LSP_LEAN="$LAIN_LSP_LEAN" \
    LAIN_INDEX_TIMEOUT="$LAIN_INDEX_TIMEOUT" LAIN_INDEX_TIMEOUT_SEC="$LAIN_INDEX_TIMEOUT_SEC" \
    PREFIX="$PREFIX" DEMO_DIR="$DEMO_DIR" WORKSPACE_ID="$WORKSPACE_ID" \
    bash "${BASH_SOURCE[0]}" "${ORIGINAL_ARGS[@]}"
}

ask() { # ask <prompt> <default> -> echoes the answer
  local prompt="$1" default="${2:-}" answer
  if [[ $ASSUME_YES -eq 1 ]] || ! { : >/dev/tty; } 2>/dev/null; then
    printf '%s' "$default"
    return
  fi
  if ! read -r -p "$prompt" answer </dev/tty; then
    printf '%s' "$default"
    return
  fi
  printf '%s' "${answer:-$default}"
}

random_token() { # same shape as deploy/gen-tokens.mjs: px_<24 random bytes, base64url>
  printf 'px_%s' "$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')"
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  info "apt-get install $*"
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends "$@" >/dev/null
}

has_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; }

wait_for() { # wait_for <seconds> <command...>
  local timeout="$1"; shift
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

compose() { ( cd "$DEPLOY_DIR" && docker compose "$@" ); }

# --------------------------------------------------------------------------
# 1. Preflight
# --------------------------------------------------------------------------

step "Preflight"

require_root

if [[ ! -r /etc/os-release ]]; then
  die "cannot identify the OS (/etc/os-release missing)"
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
  die "this script targets Ubuntu/Debian (found ${ID:-unknown} ${VERSION_ID:-})"
fi
ok "${PRETTY_NAME:-Linux} $(uname -m)"
dim "repository: $REPO_ROOT"

for cmd in curl git; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd is missing and cannot be installed automatically"
done

avail_gb=$(df -Pk / | awk 'NR==2 {printf "%d", $4/1024/1024}')
if [[ "${avail_gb:-0}" -lt 20 ]]; then
  warn "only ${avail_gb} GB free on / — the Rust build and the demo repos need ~25 GB"
else
  ok "${avail_gb} GB free on /"
fi

for port in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    warn "port $port is already in use — Caddy may fail to start"
  fi
done

if [[ -z "$DOMAIN" ]]; then
  DOMAIN="$(ask 'Public domain for the demo (DNS name or IP.nip.io): ' '')"
fi
if [[ -z "$DOMAIN" ]]; then
  die "a domain is required: re-run with --domain <name>"
fi
ok "domain: $DOMAIN"

# Caddy gets the certificate for this name, so it has to point at this
# machine. Warn early: the build below takes a long time.
resolved_ip="$(getent hosts "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
if [[ -z "$resolved_ip" ]]; then
  warn "$DOMAIN does not resolve yet — Caddy will not get a certificate until it does"
else
  public_ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  if [[ -n "$public_ip" ]] && [[ "$resolved_ip" != "$public_ip" ]]; then
    warn "$DOMAIN resolves to $resolved_ip but this machine's public IP is $public_ip"
  else
    ok "$DOMAIN resolves to $resolved_ip"
  fi
fi

if [[ -z "$NEBIUS_TOKEN" ]]; then
  NEBIUS_TOKEN="$(ask 'Nebius Token Factory key (blank to skip the model): ' '')"
fi
if [[ -n "$NEBIUS_TOKEN" ]]; then
  ok "Nebius token: set"
else
  warn "no Nebius token: the investigator will report failed:no_model_configured"
fi

# --------------------------------------------------------------------------
# 2. System packages
# --------------------------------------------------------------------------

step "System packages"

apt_install ca-certificates curl git build-essential pkg-config cmake libssl-dev socat
ok "toolchain, git and socat installed"

# --------------------------------------------------------------------------
# 3. Docker
# --------------------------------------------------------------------------

step "Docker"

if ! command -v docker >/dev/null 2>&1; then
  if [[ $SKIP_DOCKER -eq 1 ]]; then
    die "--skip-docker was given but docker is not installed"
  fi
  info "installing Docker from get.docker.com"
  curl -fsSL https://get.docker.com | sh >/dev/null
  ok "Docker installed"
else
  info "Docker already present: $(docker --version)"
fi

if has_systemd; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
if ! docker info >/dev/null 2>&1; then
  # No systemd (or the daemon is not managed): start it by hand.
  if command -v dockerd >/dev/null 2>&1; then
    warn "the Docker daemon is not running — starting dockerd in the background"
    nohup dockerd >/var/log/dockerd.log 2>&1 &
    wait_for 60 docker info || die "dockerd did not come up (see /var/log/dockerd.log)"
  else
    die "the Docker daemon is not running and dockerd is not available"
  fi
fi
ok "Docker daemon is up"

DOCKER_BRIDGE_GATEWAY="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
if [[ -z "$DOCKER_BRIDGE_GATEWAY" ]]; then
  die "could not read the default Docker bridge gateway (needed to reach the engine from the container)"
fi
ok "docker bridge gateway: $DOCKER_BRIDGE_GATEWAY"

# --------------------------------------------------------------------------
# 4. Lain, built from the dev branch
# --------------------------------------------------------------------------

step "Lain (${LAIN_BRANCH} branch)"

install_lain_binary() { # install_lain_binary <path-to-binary>
  install -m 0755 "$1" "$LAIN_BIN_DIR/lain"
  local sidecar
  sidecar="$(dirname "$1")/lain-git-sidecar"
  if [[ -f "$sidecar" ]]; then
    install -m 0755 "$sidecar" "$LAIN_BIN_DIR/lain-git-sidecar"
  else
    warn "no lain-git-sidecar next to $1 — the git sensor will fall back to the in-process one"
  fi
}

if [[ -n "$LAIN_BIN" ]]; then
  [[ -x "$LAIN_BIN" ]] || die "--lain-bin $LAIN_BIN is not executable"
  install_lain_binary "$LAIN_BIN"
  ok "installed the provided lain binary: $LAIN_BIN_DIR/lain"
elif [[ $SKIP_LAIN_BUILD -eq 1 ]]; then
  command -v lain >/dev/null 2>&1 || die "--skip-lain-build was given but lain is not on PATH"
  ok "using the lain already on PATH: $(command -v lain)"
else
  if ! command -v cargo >/dev/null 2>&1; then
    info "installing Rust (stable)"
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable >/dev/null
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  rustc --version
  rustc_version="$(rustc --version | awk '{print $2}')"
  if [[ "$(printf '%s\n1.89.0\n' "$rustc_version" | sort -V | head -n1)" != "1.89.0" ]]; then
    info "updating the Rust toolchain"
    rustup update stable >/dev/null
  fi

  mkdir -p "$LAIN_SRC_DIR"
  if [[ -d "$LAIN_SRC_DIR/.git" ]]; then
    info "updating the existing checkout at $LAIN_SRC_DIR"
    git -C "$LAIN_SRC_DIR" fetch --depth 1 origin "$LAIN_BRANCH"
    git -C "$LAIN_SRC_DIR" checkout -q FETCH_HEAD
  else
    info "cloning $LAIN_REPO_URL ($LAIN_BRANCH)"
    git clone --depth 1 --branch "$LAIN_BRANCH" "$LAIN_REPO_URL" "$LAIN_SRC_DIR"
  fi
  LAIN_COMMIT="$(git -C "$LAIN_SRC_DIR" rev-parse HEAD)"
  BUILD_MARKER="$LAIN_SRC_DIR/.installed-commit"

  if [[ -f "$BUILD_MARKER" ]] && [[ "$(cat "$BUILD_MARKER")" == "$LAIN_COMMIT" ]] \
     && [[ -x "$LAIN_BIN_DIR/lain" ]]; then
    ok "lain ${LAIN_COMMIT:0:12} is already built (skipping the Rust build)"
  else
    warn "building lain from source — this takes 15-40 minutes (Rust + ONNX runtime + tree-sitter)"
    # A release build of lain peaks at a few GB per rustc process; on a small
    # VM the default parallelism gets the box OOM-killed. Two jobs is the
    # safe default; CARGO_BUILD_JOBS raises it.
    build_jobs="${CARGO_BUILD_JOBS:-2}"
    if (( build_jobs > $(nproc) )); then build_jobs="$(nproc)"; fi
    info "cargo build with $build_jobs job(s) (override with CARGO_BUILD_JOBS)"
    ( cd "$LAIN_SRC_DIR" && cargo build --release --locked -j "$build_jobs" --bin lain --bin lain-git-sidecar )
    install_lain_binary "$LAIN_SRC_DIR/target/release/lain"
    printf '%s' "$LAIN_COMMIT" > "$BUILD_MARKER"
    ok "lain $LAIN_COMMIT built and installed in $LAIN_BIN_DIR"
  fi
fi

"$LAIN_BIN_DIR/lain" --version 2>/dev/null || true

# --------------------------------------------------------------------------
# 5. Demo repos + federation config
# --------------------------------------------------------------------------

step "Demo repos and federation config"

mkdir -p "$ENGINE_DIR" "$ENGINE_DATA_DIR" "$DEMO_DIR"

if [[ $SKIP_DEMO -eq 1 ]]; then
  warn "demo repos skipped — the config below points at whatever is in $DEMO_DIR"
else
  clone_demo_repo() { # clone_demo_repo <id> <url>
    local id="$1" url="$2" dest="$DEMO_DIR/$1"
    if [[ -d "$dest/.git" ]]; then
      info "$id: already cloned"
      return
    fi
    info "$id: cloning (depth 1)"
    git clone --depth 1 --quiet "$url" "$dest"
  }
  clone_demo_repo saleor https://github.com/saleor/saleor.git
  clone_demo_repo saleor-dashboard https://github.com/saleor/saleor-dashboard.git
  clone_demo_repo storefront https://github.com/saleor/storefront.git
  ok "Saleor repos in $DEMO_DIR"
fi

cat > "$ENGINE_CONFIG" <<EOF
# Federation config for the Parallax demo.
#
# The engine indexes the repos below and serves the federation tools over
# HTTP on $LAIN_HOST:$LAIN_PORT. This file is generated by install.sh;
# edit it and restart the engine to change the workspace.
data_dir: $ENGINE_DATA_DIR
# Private instance: it does not join the shared-daemon pool, so no other
# agent on this machine attaches to it.
share: false
repos:
  - id: saleor
    source: { type: workspace_dir, path: $DEMO_DIR/saleor }
  - id: saleor-dashboard
    source: { type: workspace_dir, path: $DEMO_DIR/saleor-dashboard }
  - id: storefront
    source: { type: workspace_dir, path: $DEMO_DIR/storefront }
services:
  - name: saleor-api
    repo: saleor
    env: [NEXT_PUBLIC_SALEOR_API_URL]
  - name: saleor-dashboard
    repo: saleor-dashboard
    # Schema copies only (codegen inputs) — not a GraphQL provider.
    provides_graphql: false
  - name: saleor-storefront
    repo: storefront
EOF
ok "wrote $ENGINE_CONFIG"

# --------------------------------------------------------------------------
# 6. The engine as a service
# --------------------------------------------------------------------------

step "Engine service"

ENGINE_UNIT="$ENGINE_UNIT_DIR/lain.service"

write_engine_unit() {
  cat > "$ENGINE_UNIT" <<EOF
[Unit]
Description=Parallax analysis engine (lain, $LAIN_BRANCH)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=LAIN_DISABLE_LSP=$LAIN_DISABLE_LSP
Environment=LAIN_LSP_LEAN=$LAIN_LSP_LEAN
Environment=LAIN_INDEX_TIMEOUT=$LAIN_INDEX_TIMEOUT
ExecStart=$LAIN_BIN_DIR/lain server --config $ENGINE_CONFIG --transport http --port $LAIN_PORT --bind $LAIN_HOST --workspace none
Restart=always
RestartSec=5
StandardOutput=append:$ENGINE_LOG
StandardError=append:$ENGINE_LOG

[Install]
WantedBy=multi-user.target
EOF
}

if has_systemd; then
  mkdir -p "$ENGINE_UNIT_DIR"
  write_engine_unit
  systemctl daemon-reload
  systemctl enable lain >/dev/null 2>&1 || true
  systemctl restart lain
  ok "systemd unit: lain.service"
else
  # No systemd: run it under nohup and keep the PID around.
  if [[ -f "$ENGINE_DIR/lain.pid" ]] && kill -0 "$(cat "$ENGINE_DIR/lain.pid")" 2>/dev/null; then
    kill "$(cat "$ENGINE_DIR/lain.pid")" 2>/dev/null || true
    sleep 2
  fi
  LAIN_DISABLE_LSP="$LAIN_DISABLE_LSP" LAIN_LSP_LEAN="$LAIN_LSP_LEAN" \
    LAIN_INDEX_TIMEOUT="$LAIN_INDEX_TIMEOUT" \
    nohup "$LAIN_BIN_DIR/lain" server --config "$ENGINE_CONFIG" --transport http \
    --port "$LAIN_PORT" --bind "$LAIN_HOST" --workspace none >>"$ENGINE_LOG" 2>&1 &
  printf '%s' "$!" > "$ENGINE_DIR/lain.pid"
  ok "engine started (no systemd): pid $(cat "$ENGINE_DIR/lain.pid"), log $ENGINE_LOG"
fi

info "waiting for the engine to answer on $LAIN_HOST:$LAIN_PORT"
if ! wait_for 120 bash -c "exec 3<>/dev/tcp/$LAIN_HOST/$LAIN_PORT"; then
  die "the engine did not open $LAIN_HOST:$LAIN_PORT — check $ENGINE_LOG"
fi

info "waiting for the repos to be indexed (timeout ${LAIN_INDEX_TIMEOUT_SEC}s)"
index_deadline=$((SECONDS + LAIN_INDEX_TIMEOUT_SEC))
index_poll=0
while (( SECONDS < index_deadline )); do
  body="$(curl -sS --max-time 10 "http://$LAIN_HOST:$LAIN_PORT/health/index-status" 2>/dev/null || true)"
  if [[ -n "$body" ]]; then
    summary="$(printf '%s' "$body" | grep -o '"id":"[^"]*","health":"[^"]*"' | tr '\n' ' ')"
    if [[ "$body" == *'"health":"ready"'* ]] && [[ "$body" != *'"health":"indexing"'* ]]; then
      ok "indexed: $summary"
      break
    fi
    index_poll=$((index_poll + 1))
    if (( index_poll % 6 == 1 )); then
      info "status: $summary"
    fi
  fi
  sleep 10
done
if (( SECONDS >= index_deadline )); then
  warn "indexing did not finish within ${LAIN_INDEX_TIMEOUT_SEC}s — the demo may show partial data"
  warn "check the engine log: $ENGINE_LOG"
fi

# --------------------------------------------------------------------------
# 7. Loopback relay (container -> engine)
# --------------------------------------------------------------------------

step "Engine relay"

# The engine refuses to bind a non-loopback address without API keys, and
# Parallax does not send an Authorization header. So the engine stays on
# 127.0.0.1 and this relay forwards the Docker bridge address to it. The
# relay is bound to the bridge IP only: the engine is not reachable from
# the internet.
RELAY_UNIT="$ENGINE_UNIT_DIR/lain-relay.service"

if ! command -v socat >/dev/null 2>&1; then
  die "socat is missing (it is needed to reach the engine from the container)"
fi
SOCAT_BIN="$(command -v socat)"

if has_systemd; then
  mkdir -p "$ENGINE_UNIT_DIR"
  cat > "$RELAY_UNIT" <<EOF
[Unit]
Description=Relay the Docker bridge to the Parallax engine on $LAIN_HOST:$LAIN_PORT
After=docker.service lain.service
Wants=docker.service

[Service]
Type=simple
ExecStart=$SOCAT_BIN TCP-LISTEN:$LAIN_PORT,fork,reuseaddr,bind=$DOCKER_BRIDGE_GATEWAY TCP:$LAIN_HOST:$LAIN_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable lain-relay >/dev/null 2>&1 || true
  systemctl restart lain-relay
  ok "systemd unit: lain-relay.service ($DOCKER_BRIDGE_GATEWAY:$LAIN_PORT -> $LAIN_HOST:$LAIN_PORT)"
else
  nohup socat "TCP-LISTEN:$LAIN_PORT,fork,reuseaddr,bind=$DOCKER_BRIDGE_GATEWAY" \
    "TCP:$LAIN_HOST:$LAIN_PORT" >>"$ENGINE_LOG" 2>&1 &
  printf '%s' "$!" > "$ENGINE_DIR/lain-relay.pid"
  ok "relay started (no systemd): pid $(cat "$ENGINE_DIR/lain-relay.pid")"
fi

if ! wait_for 30 bash -c "exec 3<>/dev/tcp/$DOCKER_BRIDGE_GATEWAY/$LAIN_PORT"; then
  die "the relay is not answering on $DOCKER_BRIDGE_GATEWAY:$LAIN_PORT"
fi
ok "the engine is reachable from containers at http://host.docker.internal:$LAIN_PORT/mcp"

# --------------------------------------------------------------------------
# 8. deploy/.env
# --------------------------------------------------------------------------

step "Environment file"

ENV_FILE="$DEPLOY_DIR/.env"

# A re-run must not invalidate the links that were already handed out: reuse
# the tokens and the model credential from the existing .env when they are
# there, and only generate what is missing.
existing_env_value() { # existing_env_value <KEY>
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1
}

TOKENS_JSON="$(existing_env_value PARALLAX_TOKENS)"
if [[ -n "$TOKENS_JSON" ]]; then
  TOKENS_JSON="${TOKENS_JSON%\'}"; TOKENS_JSON="${TOKENS_JSON#\'}"
  TOKENS_JSON="${TOKENS_JSON%\"}"; TOKENS_JSON="${TOKENS_JSON#\"}"
  if [[ "$TOKENS_JSON" == \[*\] ]]; then
    ok "reusing the access tokens from the existing $ENV_FILE"
  else
    TOKENS_JSON=""
  fi
fi
if [[ -z "$TOKENS_JSON" ]]; then
  TOKENS_JSON="[{\"token\":\"$(random_token)\",\"orgId\":\"$WORKSPACE_ID\",\"scopes\":[\"read\",\"write\"]},{\"token\":\"$(random_token)\",\"orgId\":\"$WORKSPACE_ID\",\"scopes\":[\"read\"]}]"
fi
ADMIN_TOKEN="$(printf '%s' "$TOKENS_JSON" | sed -n 's/.*"token":"\([^"]*\)".*"scopes":\["read","write"\].*/\1/p')"
JUDGE_TOKEN="$(printf '%s' "$TOKENS_JSON" | sed -n 's/.*"token":"\([^"]*\)".*"scopes":\["read"\].*/\1/p')"

if [[ -z "$NEBIUS_TOKEN" ]]; then
  NEBIUS_TOKEN="$(existing_env_value NEBIUS_TOKEN)"
  if [[ -n "$NEBIUS_TOKEN" ]]; then
    ok "reusing the Nebius token from the existing $ENV_FILE"
  fi
fi

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  warn "backed up the previous $ENV_FILE"
fi

cat > "$ENV_FILE" <<EOF
# Generated by install.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC').
#
# These values are read by the compose stack in this directory:
#   - DOMAIN           the public name Caddy serves (and gets a cert for)
#   - PARALLAX_TOKENS  the access tokens (JSON array)
#   - LAIN_URL         the analysis engine, reached through the Docker relay
# The rest are container-side paths: the app runs in the parallax container.

DOMAIN=$DOMAIN

# Admin token (read + write) and read-only token for visitors.
PARALLAX_TOKENS='$TOKENS_JSON'

# Nebius Token Factory credential (the investigator). Empty means the model
# features are off and the investigator reports failed:no_model_configured.
NEBIUS_TOKEN=$NEBIUS_TOKEN

LAIN_ADAPTER=real
LAIN_URL=http://host.docker.internal:$LAIN_PORT/mcp
PARALLAX_MCP_TRANSPORT=http-sse
PORT=8080

# Container paths: the database lives in the parallax-data volume.
DATABASE_PATH=/data/parallax.db
WEB_BUNDLE_PATH=/app/packages/web/dist

NEMOTRON_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEMOTRON_PLANNER_MODEL=nvidia/nemotron-3-super-120b-a12b
NEMOTRON_WORKER_MODEL=nvidia/Nemotron-3_5-Lightning
INVESTIGATOR_MAX_TOOL_CALLS=10
INVESTIGATOR_MAX_MODEL_MS=180000

# Cap on questions per token and hour, so a shared link cannot drain the
# Token Factory credits.
QUERY_RATE_LIMIT_PER_HOUR=60
EOF
chmod 600 "$ENV_FILE"
ok "wrote $ENV_FILE (chmod 600)"

# --------------------------------------------------------------------------
# 9. The stack
# --------------------------------------------------------------------------

step "Parallax stack"

if [[ $SKIP_BUILD -eq 1 ]]; then
  compose up -d || die "docker compose up failed"
  ok "containers started (image not rebuilt)"
else
  info "building the image (pnpm install + web bundle)"
  compose build || die "the image build failed"
  compose up -d || die "docker compose up failed"
  ok "image built and containers started"
fi

compose ps || true

info "waiting for the parallax container to be up"
for _ in $(seq 1 60); do
  if compose ps --status running --services 2>/dev/null | grep -qx parallax; then
    break
  fi
  sleep 2
done
if ! compose ps --status running --services 2>/dev/null | grep -qx parallax; then
  die "the parallax container is not running — check 'docker compose logs' in $DEPLOY_DIR"
fi
ok "the parallax container is running"

# --------------------------------------------------------------------------
# 10. Seed the workspace
# --------------------------------------------------------------------------

step "Demo workspace"

info "seeding the database (this runs inside the container)"
if compose exec -T \
      -e "SALEOR_LAIN_URL=http://host.docker.internal:$LAIN_PORT/mcp" \
      -e "DATABASE_PATH=/data/parallax.db" \
      parallax pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts; then
  ok "workspace $WORKSPACE_ID seeded"
else
  compose logs --tail=50 parallax || true
  die "the seed script failed (see the container logs above)"
fi

# Point the seeded repos at the paths on this machine and drop the demo
# workspaces that have no engine of their own.
if [[ $KEEP_EXTRA_WORKSPACES -eq 0 ]]; then
  info "pointing the repos at $DEMO_DIR and removing the workspaces without an engine"
  cleanup_js="$(mktemp)"
  cat > "$cleanup_js" <<EOF
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH);
const paths = {
  repo_saleor_api: '$DEMO_DIR/saleor',
  repo_saleor_dashboard: '$DEMO_DIR/saleor-dashboard',
  repo_saleor_storefront: '$DEMO_DIR/storefront',
};
const update = db.prepare('UPDATE repo SET local = ? WHERE id = ?');
for (const [id, path] of Object.entries(paths)) update.run(path, id);
if (process.env.KEEP_EXTRA !== '1') {
  db.prepare("DELETE FROM repo WHERE workspace_id IN ('ws_boutique', 'ws_fixture')").run();
  db.prepare("DELETE FROM workspace WHERE id IN ('ws_boutique', 'ws_fixture')").run();
}
const n = db.prepare('SELECT COUNT(*) AS n FROM workspace').get().n;
console.log('workspaces in the database: ' + n);
db.close();
EOF
  if compose exec -T -e "DATABASE_PATH=/data/parallax.db" -e "KEEP_EXTRA=$KEEP_EXTRA_WORKSPACES" \
      -w /app/packages/api parallax node --input-type=commonjs < "$cleanup_js"; then
    ok "database cleaned up"
  else
    warn "the database cleanup failed — the extra demo workspaces may still be listed"
  fi
  rm -f "$cleanup_js"
else
  warn "extra workspaces kept as asked"
fi

# --------------------------------------------------------------------------
# 11. Control script
# --------------------------------------------------------------------------

step "Control script"

CONTROL="$CONTROL_BIN"
cat > "$CONTROL" <<EOF
#!/usr/bin/env bash
# Control the Parallax demo stack installed by install.sh.
set -euo pipefail

REPO_ROOT="$REPO_ROOT"
DEPLOY_DIR="$DEPLOY_DIR"
ENGINE_CONFIG="$ENGINE_CONFIG"
ENGINE_LOG="$ENGINE_LOG"
LAIN_PORT="$LAIN_PORT"

compose() { ( cd "\$DEPLOY_DIR" && docker compose "\$@" ); }

case "\${1:-status}" in
  start)
    if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl start lain lain-relay
    fi
    compose up -d
    ;;
  stop)
    compose down
    if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl stop lain lain-relay
    fi
    ;;
  restart)
    "\$0" stop || true
    "\$0" start
    ;;
  status)
    if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl --no-pager status lain lain-relay || true
    fi
    compose ps || true
    ;;
  logs)
    compose logs -f --tail=100
    ;;
  engine-logs)
    tail -f "\$ENGINE_LOG"
    ;;
  health)
    curl -fsS "http://127.0.0.1:\$LAIN_PORT/health" || true
    echo
    ;;
  *)
    echo "usage: parallax-stack {start|stop|restart|status|logs|engine-logs|health}" >&2
    exit 1
    ;;
esac
EOF
chmod 0755 "$CONTROL"
ok "wrote $CONTROL"

# --------------------------------------------------------------------------
# 12. Verify
# --------------------------------------------------------------------------

step "Verification"

info "waiting for the API to answer inside the container"
api_health=""
for _ in $(seq 1 60); do
  api_health="$(compose exec -T parallax node -e "
    fetch('http://127.0.0.1:8080/api/health')
      .then((r) => r.text())
      .then((t) => { console.log(t); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  " 2>/dev/null || true)"
  if [[ -n "$api_health" ]]; then
    break
  fi
  sleep 5
done
if [[ -z "$api_health" ]]; then
  warn "the API did not answer yet — check: parallax-stack logs"
else
  ok "API health: $api_health"
  if [[ "$api_health" != *'"lainAdapter":"real"'* ]]; then
    warn "the adapter is not 'real' — the map will not show the indexed repos"
  fi
fi

info "waiting for Caddy's certificate on https://$DOMAIN"
https_ready=0
for _ in $(seq 1 36); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    https_ready=1
    break
  fi
  sleep 5
done
if [[ $https_ready -eq 0 ]]; then
  warn "https://$DOMAIN did not answer — check that the DNS points at this machine"
  warn "and that the ports 80/443 are open: parallax-stack logs"
else
  ok "https://$DOMAIN/api/health: $(curl -fsS --max-time 10 "https://$DOMAIN/api/health")"
fi

printf '\n%s%s%s\n' "$C_GREEN" "────────────────────────────────────────────────────────────────" "$C_RESET"
printf '%sParallax is installed.%s\n\n' "$C_GREEN" "$C_RESET"
printf '  Admin (read + write)  https://%s/orgs/%s?token=%s\n' "$DOMAIN" "$WORKSPACE_ID" "$ADMIN_TOKEN"
printf '  Visitors (read only)  https://%s/orgs/%s?token=%s\n' "$DOMAIN" "$WORKSPACE_ID" "$JUDGE_TOKEN"
printf '\n  Engine                http://%s:%s/health (loopback only)\n' "$LAIN_HOST" "$LAIN_PORT"
printf '  Config                %s\n' "$ENGINE_CONFIG"
printf '  Tokens file           %s\n' "$ENV_FILE"
printf '\n  Commands              parallax-stack {status|logs|restart|engine-logs}\n'
printf '%s────────────────────────────────────────────────────────────────%s\n\n' "$C_GREEN" "$C_RESET"
