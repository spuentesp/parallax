#!/usr/bin/env bash
# provision-vm.sh — Provision a Nebius AI Cloud VM for the Parallax demo.
#
# Usage:
#   ./deploy/provision-vm.sh [INSTANCE_NAME] [PRESET] [PROJECT_ID]
#
# Defaults:
#   INSTANCE_NAME: parallax-demo
#   PRESET:        4vcpu-16gb (on platform cpu-d3)
#   PROJECT_ID:    Auto-detected or default-project-eu-west1 (has 200 non-GPU vCPU quota)

set -euo pipefail

INSTANCE_NAME="${1:-parallax-demo}"
PRESET="${2:-4vcpu-16gb}"
PLATFORM="${PLATFORM:-cpu-d3}"
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu24.04-driverless}"
DISK_SIZE_GIB="${DISK_SIZE_GIB:-50}"

# Allow explicit override via CLI arg or NEBIUS_PROJECT_ID
PROJECT_ID="${3:-${NEBIUS_PROJECT_ID:-}}"

# If not provided, try to find a project with active non-GPU vCPU quota or fall back to eu-west1
if [ -z "$PROJECT_ID" ]; then
  # eu-west1 has 200 non-gpu vCPU quota in this tenant
  PROJECT_ID="project-e01yvp5npa00w00495h16j"
fi

# Detect region prefix from project id (e.g., project-e01... -> project-e01public-images)
REGION_PREFIX="$(echo "$PROJECT_ID" | cut -d'-' -f2 | cut -c1-3)"
PUBLIC_IMAGES_PROJECT="project-${REGION_PREFIX}public-images"

# Query or detect subnet in the target project
SUBNET_ID="${NEBIUS_SUBNET_ID:-}"
if [ -z "$SUBNET_ID" ]; then
  SUBNET_ID="$(nebius vpc subnet list --parent-id "$PROJECT_ID" --format json 2>/dev/null | grep -o '"id": "vpcsubnet-[^"]*"' | head -n1 | cut -d'"' -f4 || echo "")"
fi

if [ -z "$SUBNET_ID" ]; then
  # Fallback for eu-west1 default subnet
  if [ "$PROJECT_ID" = "project-e01yvp5npa00w00495h16j" ]; then
    SUBNET_ID="vpcsubnet-e01dej05mk3fz85a97"
  else
    echo "Error: Could not automatically detect a VPC subnet for project $PROJECT_ID." >&2
    echo "Please set NEBIUS_SUBNET_ID=<subnet_id>." >&2
    exit 1
  fi
fi

SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/id_ed25519.pub}"
if [ ! -f "$SSH_KEY_FILE" ]; then
  SSH_KEY_FILE="$HOME/.ssh/id_rsa.pub"
fi

if [ ! -f "$SSH_KEY_FILE" ]; then
  echo "Error: SSH public key not found at $HOME/.ssh/id_ed25519.pub or $HOME/.ssh/id_rsa.pub" >&2
  exit 1
fi
SSH_PUB_KEY="$(cat "$SSH_KEY_FILE")"

echo "=========================================="
echo "  Provisioning Nebius Cloud VM"
echo "  Instance:       $INSTANCE_NAME"
echo "  Project:        $PROJECT_ID"
echo "  Public Images:  $PUBLIC_IMAGES_PROJECT"
echo "  Subnet:         $SUBNET_ID"
echo "  Platform:       $PLATFORM ($PRESET)"
echo "  OS Image:       $IMAGE_FAMILY"
echo "  SSH Key:        $SSH_KEY_FILE"
echo "=========================================="

CLOUD_INIT_FILE="$(mktemp /tmp/cloud-init-XXXXXX.yaml)"
cat > "$CLOUD_INIT_FILE" <<EOF
#cloud-config
users:
  - name: ubuntu
    groups: sudo, docker
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${SSH_PUB_KEY}
package_update: true
packages:
  - git
  - curl
  - build-essential
  - pkg-config
  - libssl-dev
  - cmake
EOF

CLOUD_INIT_CONTENT="$(cat "$CLOUD_INIT_FILE")"
rm -f "$CLOUD_INIT_FILE"

echo "==> Creating instance via nebius CLI..."
set +e
OPERATION_OUTPUT="$(nebius compute instance create \
  --name "$INSTANCE_NAME" \
  --parent-id "$PROJECT_ID" \
  --resources-platform "$PLATFORM" \
  --resources-preset "$PRESET" \
  --boot-disk-managed-disk-name "${INSTANCE_NAME}-boot" \
  --boot-disk-managed-disk-type network_ssd \
  --boot-disk-managed-disk-size-gibibytes "$DISK_SIZE_GIB" \
  --boot-disk-managed-disk-source-image-family-image-family "$IMAGE_FAMILY" \
  --boot-disk-managed-disk-source-image-family-parent-id "$PUBLIC_IMAGES_PROJECT" \
  --boot-disk-attach-mode READ_WRITE \
  --network-interfaces "[{\"name\": \"eth0\", \"ip_address\": {}, \"public_ip_address\": {}, \"subnet_id\": \"${SUBNET_ID}\"}]" \
  --cloud-init-user-data "$CLOUD_INIT_CONTENT" 2>&1)"
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -ne 0 ]; then
  echo "Error creating instance:"
  echo "$OPERATION_OUTPUT"
  echo ""
  if echo "$OPERATION_OUTPUT" | grep -q "PermissionDenied"; then
    echo "================================================================================"
    echo "ACTION REQUIRED: Nebius Cloud account activation / billing required."
    echo "The Nebius IAM service returned PermissionDenied on the compute service."
    echo "Please visit https://console.nebius.com to link a billing method or activate"
    echo "trial credits for tenant."
    echo "================================================================================"
  fi
  exit $EXIT_CODE
fi

echo "$OPERATION_OUTPUT"

echo "==> Waiting for instance to become READY..."
for i in $(seq 1 12); do
  STATUS="$(nebius compute instance get-by-name --name "$INSTANCE_NAME" --parent-id "$PROJECT_ID" --format json 2>/dev/null | grep -o '"status": "[^"]*"' | head -n1 | cut -d'"' -f4 || echo "PENDING")"
  echo "    Status: $STATUS (attempt $i/12)..."
  if [ "$STATUS" = "READY" ] || [ "$STATUS" = "RUNNING" ]; then
    break
  fi
  sleep 5
done

PUBLIC_IP="$(nebius compute instance get-by-name --name "$INSTANCE_NAME" --parent-id "$PROJECT_ID" --format json 2>/dev/null | grep -o '"address": "[0-9.]*"' | head -n1 | cut -d'"' -f4 || echo "")"

echo "=========================================="
echo "  Instance created successfully!"
echo "  Name:      $INSTANCE_NAME"
echo "  Public IP: ${PUBLIC_IP:-Pending (check with nebius compute instance list)}"
echo "=========================================="
if [ -n "$PUBLIC_IP" ]; then
  echo "Next step: Deploy Parallax using:"
  echo "  ./deploy/deploy-to-vm.sh $PUBLIC_IP"
fi
