#!/usr/bin/env bash
# provision-vultr-vm.sh — Provision a Vultr Cloud VM for the Parallax demo.
#
# Prerequisites:
#   - vultr-cli installed (in PATH)
#   - VULTR_API_KEY set in environment or in ~/.vultr-cli.yaml
#
# Usage:
#   ./deploy/provision-vultr-vm.sh [PLAN] [REGION] [LABEL]
#
# Defaults:
#   PLAN:   vc2-4c-8gb   (4 vCPU / 8 GB RAM / 160 GB SSD / $40/mo / ~$0.06/hr)
#   REGION: ewr          (New Jersey; other popular: ord, fra, ams, lhr, sjc)
#   LABEL:  parallax-demo

set -euo pipefail

PLAN="${1:-vc2-4c-8gb}"
REGION="${2:-ewr}"
LABEL="${3:-parallax-demo}"
OS_ID="2284" # Ubuntu 24.04 LTS x64

if ! command -v vultr-cli >/dev/null 2>&1; then
  echo "Error: vultr-cli is not installed or not in PATH." >&2
  exit 1
fi

if [ -z "${VULTR_API_KEY:-}" ] && [ ! -f "$HOME/.vultr-cli.yaml" ]; then
  echo "Error: VULTR_API_KEY is not set." >&2
  echo "Please set your API key:" >&2
  echo "  export VULTR_API_KEY=\"your-vultr-api-key\"" >&2
  echo "or configure ~/.vultr-cli.yaml with:" >&2
  echo "  api-key: your-vultr-api-key" >&2
  exit 1
fi

SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/id_ed25519.pub}"
if [ ! -f "$SSH_KEY_FILE" ]; then
  SSH_KEY_FILE="$HOME/.ssh/id_rsa.pub"
fi

if [ ! -f "$SSH_KEY_FILE" ]; then
  echo "Error: No SSH public key found at $HOME/.ssh/id_ed25519.pub or $HOME/.ssh/id_rsa.pub" >&2
  exit 1
fi
SSH_PUB_KEY="$(cat "$SSH_KEY_FILE")"

echo "=========================================="
echo "  Provisioning Vultr Cloud Compute VM"
echo "  Label:    $LABEL"
echo "  Plan:     $PLAN"
echo "  Region:   $REGION"
echo "  OS:       Ubuntu 24.04 LTS ($OS_ID)"
echo "  SSH Key:  $SSH_KEY_FILE"
echo "=========================================="

# 1. Register or find SSH key on Vultr
SSH_KEY_NAME="parallax-deploy-key"
SSH_KEY_ID="$(vultr-cli ssh-key list -o json 2>/dev/null | grep -B 2 "$SSH_KEY_NAME" | grep -o '"id": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "")"

if [ -z "$SSH_KEY_ID" ]; then
  echo "==> Registering SSH key '$SSH_KEY_NAME' on Vultr..."
  SSH_KEY_ID="$(vultr-cli ssh-key create --name="$SSH_KEY_NAME" --key="$SSH_PUB_KEY" -o json | grep -o '"id": "[^"]*"' | head -n1 | cut -d'"' -f4)"
fi
echo "==> Using Vultr SSH Key ID: $SSH_KEY_ID"

# 2. Check if instance with this label already exists
EXISTING_ID="$(vultr-cli instance list -o json 2>/dev/null | grep -B 2 "\"label\": \"$LABEL\"" | grep -o '"id": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "")"

if [ -n "$EXISTING_ID" ]; then
  echo "==> Found existing instance '$LABEL' (ID: $EXISTING_ID)"
  INSTANCE_ID="$EXISTING_ID"
else
  echo "==> Creating new Vultr instance..."
  CREATE_OUT="$(vultr-cli instance create \
    --region="$REGION" \
    --plan="$PLAN" \
    --os="$OS_ID" \
    --host="$LABEL" \
    --label="$LABEL" \
    --ssh-keys="$SSH_KEY_ID" \
    -o json)"
  INSTANCE_ID="$(echo "$CREATE_OUT" | grep -o '"id": "[^"]*"' | head -n1 | cut -d'"' -f4)"
  echo "==> Instance creation requested (ID: $INSTANCE_ID)"
fi

# 3. Wait for instance to become active and obtain main IP
echo "==> Waiting for instance to become active and obtain IP..."
MAIN_IP=""
for i in $(seq 1 40); do
  INFO="$(vultr-cli instance get "$INSTANCE_ID" -o json 2>/dev/null || true)"
  STATUS="$(echo "$INFO" | grep -o '"status": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "pending")"
  SERVER_STATUS="$(echo "$INFO" | grep -o '"server_status": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "none")"
  MAIN_IP="$(echo "$INFO" | grep -o '"main_ip": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "")"

  echo "    Status: $STATUS | Server: $SERVER_STATUS | IP: ${MAIN_IP:-pending} (attempt $i/40)..."

  if [ "$STATUS" = "active" ] && [ -n "$MAIN_IP" ] && [ "$MAIN_IP" != "0.0.0.0" ]; then
    break
  fi
  sleep 6
done

if [ -z "$MAIN_IP" ] || [ "$MAIN_IP" = "0.0.0.0" ]; then
  echo "Error: Instance did not obtain an active public IP in time." >&2
  exit 1
fi

echo "=========================================="
echo "  Vultr VM Ready!"
echo "  Instance ID: $INSTANCE_ID"
echo "  Public IP:   $MAIN_IP"
echo "  Default SSH: root@$MAIN_IP"
echo "=========================================="
echo "Deploy Parallax now with:"
echo "  ./deploy/deploy-to-vm.sh $MAIN_IP root"
