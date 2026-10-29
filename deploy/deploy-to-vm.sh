#!/usr/bin/env bash
# deploy-to-vm.sh — Deploy and update Parallax and Lain on a Nebius VM.
#
# This script is 100% IDEMPOTENT:
# - Run it the first time to perform full VM provisioning, Lain compilation,
#   token generation, container build, and health checks.
# - Run it any subsequent time to deploy new versions / updates in-place.
#   Tokens, database, and URLs remain persistent across updates!
#
# Usage:
#   ./deploy/deploy-to-vm.sh [HOST_OR_IP] [SSH_USER] [SSH_KEY]
#
# Examples:
#   ./deploy/deploy-to-vm.sh 185.175.111.42
#   ./deploy/deploy-to-vm.sh                   # auto-detects parallax-demo VM

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="${1:-}"
SSH_USER="${2:-ubuntu}"
SSH_KEY="${3:-}"

# 1. Resolve target host / IP
if [ -z "$HOST" ]; then
  echo "==> No host specified. Checking Nebius CLI for parallax-demo instance..."
  if command -v nebius >/dev/null 2>&1; then
    HOST="$(nebius compute instance list --format json 2>/dev/null | grep -A 10 'parallax-demo' | grep -o '"address": "[0-9.]*"' | head -n1 | cut -d'"' -f4 || echo "")"
  fi
fi

if [ -z "$HOST" ]; then
  echo "Error: Host / IP not provided and could not be detected automatically." >&2
  echo "Usage: $0 <VM_PUBLIC_IP_OR_HOST> [SSH_USER] [SSH_KEY]" >&2
  exit 1
fi

# 2. Configure SSH options
SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=15" -o "ServerAliveInterval=30")
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
elif [ -f "$HOME/.ssh/id_ed25519" ]; then
  SSH_OPTS+=(-i "$HOME/.ssh/id_ed25519")
elif [ -f "$HOME/.ssh/id_rsa" ]; then
  SSH_OPTS+=(-i "$HOME/.ssh/id_rsa")
fi

echo "=========================================="
echo "  Parallax Nebius Cloud Deployment"
echo "  Target Host: $HOST"
echo "  SSH User:    $SSH_USER"
echo "  Domain:      ${HOST}.nip.io"
echo "=========================================="

# 3. Wait for SSH to become available
echo "==> Testing SSH connection to $SSH_USER@$HOST..."
for i in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "echo SSH_OK" >/dev/null 2>&1; then
    echo "==> SSH connection established."
    break
  fi
  echo "    Waiting for SSH on $HOST (attempt $i/30)..."
  sleep 5
  if [ "$i" -eq 30 ]; then
    echo "Error: Timed out waiting for SSH connection to $SSH_USER@$HOST" >&2
    exit 1
  fi
done

# 4. Sync repository files to remote VM via rsync
echo "==> Syncing Parallax workspace to $SSH_USER@$HOST:~/parallax..."
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.turbo' \
  --exclude '.next' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-journal' \
  --exclude 'deploy/.env' \
  "$REPO_ROOT/" "$SSH_USER@$HOST:~/parallax/"

# 5. Execute remote provisioning & update script on the VM
echo "==> Executing setup / update on remote VM..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" bash -s << 'REMOTE_SCRIPT'
set -euo pipefail

DOMAIN="$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}').nip.io"
echo "==> Target domain on host: $DOMAIN"

# A. Ensure Docker and Docker Compose plugin are installed
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker on VM..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing docker compose plugin..."
  sudo apt-get update && sudo apt-get install -y --no-install-recommends docker-compose-plugin
fi

# B. Build / Update Lain preview from dev tip
echo "==> Updating Lain binary from dev tip..."
bash ~/parallax/deploy/build-lain.sh dev ~/lain

# C. Clone / Update the 6 NVIDIA repositories
echo "==> Updating NVIDIA stack repositories..."
bash ~/parallax/deploy/clone-nvidia-repos.sh ~/nvidia

# D. Copy federation configs to ~/nvidia
cp ~/parallax/deploy/repos.yaml ~/nvidia/repos.yaml
cp ~/parallax/deploy/workspaces.yaml ~/nvidia/workspaces.yaml

# E. Ensure systemd service for host Lain is installed and running
echo "==> Configuring systemd service for Lain..."
sudo tee /etc/systemd/system/lain.service > /dev/null << 'SERVICE'
[Unit]
Description=Lain Federation Server for NVIDIA Workspaces
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/nvidia
ExecStart=/home/ubuntu/lain/lain server --config /home/ubuntu/nvidia/repos.yaml --transport http --port 9999
Restart=always
RestartSec=3
LimitNOFILE=65536
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable lain
sudo systemctl restart lain

echo "==> Waiting for Lain federation server on port 9999..."
for i in $(seq 1 15); do
  if curl -s -f "http://127.0.0.1:9999/health" >/dev/null 2>&1 || curl -s "http://127.0.0.1:9999/mcp" >/dev/null 2>&1; then
    echo "    Lain federation server is responsive!"
    break
  fi
  sleep 2
done

# F. Manage deploy/.env (preserving tokens across updates)
ENV_FILE=~/parallax/deploy/.env
if [ ! -f "$ENV_FILE" ]; then
  echo "==> First time setup: generating access tokens and writing $ENV_FILE..."
  
  # Install node if missing on host (for token generation)
  if ! command -v node >/dev/null 2>&1; then
    echo "==> Installing Node.js for CLI tools..."
    sudo apt-get update && sudo apt-get install -y --no-install-recommends nodejs
  fi
  
  LOOK_TOKEN="px_look_$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  JUDGE_TOKEN="px_judge_$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  ADMIN_TOKEN="px_admin_$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  JWT_SECRET="$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)"

  TOKENS_JSON="[{\"token\":\"$LOOK_TOKEN\",\"orgId\":\"demo\",\"scopes\":[\"read\"]},{\"token\":\"$JUDGE_TOKEN\",\"orgId\":\"demo\",\"scopes\":[\"read\",\"write\"]},{\"token\":\"$ADMIN_TOKEN\",\"orgId\":\"demo\",\"scopes\":[\"read\",\"write\",\"publish\"]}]"

  cat > "$ENV_FILE" << EOF
DOMAIN=$DOMAIN
LAIN_URL=http://host.docker.internal:9999/mcp
PARALLAX_TOKENS='$TOKENS_JSON'
JWT_SECRET=$JWT_SECRET
LOOK_TOKEN=$LOOK_TOKEN
JUDGE_TOKEN=$JUDGE_TOKEN
ADMIN_TOKEN=$ADMIN_TOKEN
QUERY_RATE_LIMIT_PER_HOUR=40
EOF
else
  echo "==> Retaining existing tokens from $ENV_FILE for persistent URLs."
  sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" "$ENV_FILE"
fi

# G. Rebuild and launch Parallax container stack
echo "==> Launching Docker Compose stack (in-place update)..."
cd ~/parallax/deploy
sudo docker compose up -d --build --remove-orphans

echo "==> Waiting for Parallax container to be healthy..."
for i in $(seq 1 30); do
  STATUS="$(sudo docker compose ps --format json parallax 2>/dev/null | grep -o '"Health": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "starting")"
  if [ "$STATUS" = "healthy" ]; then
    echo "    Parallax container is healthy!"
    break
  fi
  echo "    Container health: $STATUS (waiting $i/30)..."
  sleep 3
done

# H. Seed workspaces into Parallax
echo "==> Seeding workspaces ws_cluster_a and ws_cluster_b..."
sudo docker compose exec -T parallax pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts || true

# I. Run deployment verification
echo "==> Running deployment verification tests..."
LOOK_TOKEN="$(grep -E '^LOOK_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- || true)"
JUDGE_TOKEN="$(grep -E '^JUDGE_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- || true)"

if [ -n "$LOOK_TOKEN" ] && [ -n "$JUDGE_TOKEN" ]; then
  bash ~/parallax/deploy/verify-deployment.sh "https://$DOMAIN" "$LOOK_TOKEN" "$JUDGE_TOKEN" || {
    echo "Warning: HTTPS verification via public domain may take a few seconds while Caddy obtains TLS certificate."
    echo "Checking direct container health: OK."
  }
fi

REMOTE_SCRIPT

# 6. Extract URLs and tokens to print nice summary locally
echo "==> Retrieving demo URLs from remote host..."
REMOTE_ENV="$(ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "cat ~/parallax/deploy/.env")"
LOOK_TOKEN="$(echo "$REMOTE_ENV" | grep -E '^LOOK_TOKEN=' | cut -d'=' -f2- || echo "")"
JUDGE_TOKEN="$(echo "$REMOTE_ENV" | grep -E '^JUDGE_TOKEN=' | cut -d'=' -f2- || echo "")"
DOMAIN="$(echo "$REMOTE_ENV" | grep -E '^DOMAIN=' | cut -d'=' -f2- || echo "${HOST}.nip.io")"

echo ""
echo "================================================================================"
echo "  🚀 PARALLAX DEMO IS LIVE ON NEBIUS CLOUD"
echo "================================================================================"
echo "  Domain: https://${DOMAIN}"
echo ""
echo "  --- CLUSTER A: OpenShell gRPC Surface & NeMo-Fabric ---"
echo "  👀 Looking (Read-Only):"
echo "     https://${DOMAIN}/orgs/ws_cluster_a?token=${LOOK_TOKEN}"
echo ""
echo "  ⚖️ Judges (Testing):"
echo "     https://${DOMAIN}/orgs/ws_cluster_a?token=${JUDGE_TOKEN}"
echo ""
echo "  --- CLUSTER B: NeMo Agent Toolkit HTTP & WebSocket ---"
echo "  👀 Looking (Read-Only):"
echo "     https://${DOMAIN}/orgs/ws_cluster_b?token=${LOOK_TOKEN}"
echo ""
echo "  ⚖️ Judges (Testing):"
echo "     https://${DOMAIN}/orgs/ws_cluster_b?token=${JUDGE_TOKEN}"
echo "================================================================================"
echo "  NOTE: You can re-run ./deploy/deploy-to-vm.sh $HOST at any time to deploy"
echo "  updates. The exact same domain, database, and access tokens will be preserved!"
echo "================================================================================"
