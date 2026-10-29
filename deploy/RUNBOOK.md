# Deploying & Updating the Parallax Demo (Vultr / Nebius Cloud)

Goal: A live, public, **token-protected** Parallax demo on Cloud Compute (Vultr or Nebius) showcasing two distinct NVIDIA agent architecture workspaces:
- **Cluster A (`ws_cluster_a`)**: OpenShell gRPC proto surface + Python SDK client + NeMo-Fabric / NemoClaw cross-repo consumers.
- **Cluster B (`ws_cluster_b`)**: NeMo Agent Toolkit HTTP & WebSocket runtime endpoints + Next.js API routes + UI reverse proxy.

Everything runs on one VM:
- A single Lain server running on the host in federation mode on port 9999 (compiled from `dev` tip).
- A single Parallax instance + automatic HTTPS (Caddy) in Docker serving both workspaces in the same UI.
- Models (Nemotron) run via **Nebius Token Factory** (`NEBIUS_TOKEN`).

---

## ⚡ Option A: Vultr Cloud Compute (Recommended)

### 1. Configure Vultr API Key
```bash
export VULTR_API_KEY="your-vultr-api-key"
```

### 2. Provision the VM
```bash
./deploy/provision-vultr-vm.sh vc2-4c-8gb ewr
```
*(4 vCPU / 8 GB RAM / Ubuntu 24.04 in New Jersey; prints the assigned `$PUBLIC_IP`)*.

### 3. Deploy Parallax & Lain
```bash
./deploy/deploy-to-vm.sh <PUBLIC_IP> root
```

---

## ⚡ Option B: Nebius AI Cloud

### 1. Provision the Nebius VM
```bash
./deploy/provision-vm.sh parallax-demo 4vcpu-16gb
```
*(Outputs the assigned `PUBLIC_IP`)*.

> [!NOTE]
> If you encounter `PermissionDenied` from the Nebius compute service, ensure billing/credits are active on https://console.nebius.com.

### 2. Deploy Parallax & Lain
```bash
./deploy/deploy-to-vm.sh <PUBLIC_IP> ubuntu
```
This script handles the entire lifecycle end-to-end:
1. Validates SSH connectivity to `ubuntu@<PUBLIC_IP>`.
2. Syncs the Parallax codebase via `rsync`.
3. Installs Docker & Docker Compose if missing.
4. Compiles the latest preview tip of `lain` from branch `dev` (`cargo build --release`).
5. Clones / updates all 6 NVIDIA repositories into `~/nvidia`.
6. Configures a persistent `systemd` daemon (`lain.service`) on host port 9999.
7. Generates persistent looking & judge tokens and saves `.env`.
8. Builds and starts the Docker Compose stack (Parallax + Caddy HTTPS on `<PUBLIC_IP>.nip.io`).
9. Seeds the SQLite database with `ws_cluster_a` and `ws_cluster_b`.
10. Runs automated health and token verification tests.
11. Outputs the live demo URLs!

---

## 🔄 Repeat Updates (In-Place / Zero Breakage)

When you make changes to Parallax code or Lain contracts, simply re-run:
```bash
./deploy/deploy-to-vm.sh <PUBLIC_IP>
```
The script is **100% idempotent**:
- It pulls/syncs your latest changes.
- It rebuilds the Docker container in-place.
- It **retains the exact same domain URL, database state, and access tokens**.
- Any links you already shared with judges or viewers **will continue working without interruption**.

---

## 🔑 Demo Access URLs Structure

Once deployed, the script provides persistent URLs for both clusters:

### Cluster A (OpenShell gRPC + NeMo-Fabric)
- **👀 Looking Token (Read-only for viewers/video):**
  `https://<IP>.nip.io/orgs/ws_cluster_a?token=px_look_...`
- **⚖️ Judges Token (Interactive testing for evaluators):**
  `https://<IP>.nip.io/orgs/ws_cluster_a?token=px_judge_...`

### Cluster B (NeMo Agent Toolkit HTTP & WebSocket)
- **👀 Looking Token (Read-only for viewers/video):**
  `https://<IP>.nip.io/orgs/ws_cluster_b?token=px_look_...`
- **⚖️ Judges Token (Interactive testing for evaluators):**
  `https://<IP>.nip.io/orgs/ws_cluster_b?token=px_judge_...`

---

## 🧪 Manual Verification & SSE Streaming Check

Verify that Caddy does not buffer the assistant's Server-Sent Events stream:
```bash
curl -N -sS -H "Authorization: Bearer <JUDGE_TOKEN>" \
  -H 'content-type: application/json' \
  -d '{"question":"Which services call OpenShell?","orgId":"ws_cluster_a"}' \
  https://<IP>.nip.io/api/query/stream
```
You should observe live `event: progress` chunks streamed immediately over several seconds, followed by `event: result`.
