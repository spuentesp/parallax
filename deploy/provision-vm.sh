#!/usr/bin/env bash
# provision-vm.sh — Provision a Nebius AI Cloud VM for the Parallax demo.
#
# Usage:
#   ./deploy/provision-vm.sh [INSTANCE_NAME] [PRESET]
#
# Defaults:
#   INSTANCE_NAME: parallax-demo
#   PRESET:        4vcpu-16gb (on platform cpu-d3)

set -euo pipefail

INSTANCE_NAME="${1:-parallax-demo}"
PRESET="${2:-4vcpu-16gb}"
PLATFORM="cpu-d3"
IMAGE_FAMILY="ubuntu24.04-driverless"
DISK_SIZE_GIB="50"

PROJECT_ID="$(nebius config get parent-id 2>/dev/null || echo "project-e00z9ct1pr00hznr65wms0")"
SUBNET_ID="$(nebius vpc subnet list --parent-id "$PROJECT_ID" --format json 2>/dev/null | grep -o '"id": "vpcsubnet-[^"]*"' | head -n1 | cut -d'"' -f4 || echo "vpcsubnet-e00fe2h5jazzbvwz12")"

SSH_KEY_FILE="$HOME/.ssh/id_ed25519.pub"
if [ ! -f "$SSH_KEY_FILE" ]; then
  echo "Error: SSH public key not found at $SSH_KEY_FILE" >&2
  exit 1
fi
SSH_PUB_KEY="$(cat "$SSH_KEY_FILE")"

echo "=========================================="
echo "  Provisioning Nebius Cloud VM"
echo "  Instance:   $INSTANCE_NAME"
echo "  Project:    $PROJECT_ID"
echo "  Subnet:     $SUBNET_ID"
echo "  Platform:   $PLATFORM ($PRESET)"
echo "  OS Image:   $IMAGE_FAMILY"
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

echo "==> Creating instance via nebius CLI..."
CREATE_SPEC="{
  \"metadata\": {
    \"parent_id\": \"${PROJECT_ID}\",
    \"name\": \"${INSTANCE_NAME}\"
  },
  \"spec\": {
    \"resources\": {
      \"platform\": \"${PLATFORM}\",
      \"preset\": \"${PRESET}\"
    },
    \"boot_disk\": {
      \"attach_mode\": \"read_write\",
      \"existing_disk\": null,
      \"managed_disk\": {
        \"name\": \"${INSTANCE_NAME}-boot\",
        \"size_gibibytes\": ${DISK_SIZE_GIB},
        \"source_image_family\": {
          \"image_family\": \"${IMAGE_FAMILY}\",
          \"parent_id\": \"project-e00public-images\"
        }
      }
    },
    \"network_interfaces\": [
      {
        \"subnet_id\": \"${SUBNET_ID}\",
        \"public_ip_address\": {}
      }
    ],
    \"cloud_init_user_data\": $(jq -Rs . < "$CLOUD_INIT_FILE")
  }
}"

rm -f "$CLOUD_INIT_FILE"

OPERATION_OUTPUT="$(echo "$CREATE_SPEC" | nebius compute instance create --file -)"
echo "$OPERATION_OUTPUT"

echo "==> Waiting for instance to become READY..."
sleep 5

INSTANCE_INFO="$(nebius compute instance get-by-name --name "$INSTANCE_NAME" --parent-id "$PROJECT_ID" 2>/dev/null || true)"
echo "$INSTANCE_INFO"

echo "=========================================="
echo "  Instance created successfully!"
echo "=========================================="
